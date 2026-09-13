/**
 * TaskUpdateCoordinator provides a centralized, unified way to handle all task updates
 * from any view (editor, reader, task list, embedded lists).
 *
 * ARCHITECTURE:
 * - Unified entry point: updateTask(context) handles all update types
 * - Convenience methods: updateTaskState, updateTaskScheduledDate, updateTaskDeadlineDate,
 *   updateTaskPriority, updateTaskRecurrence, updateTaskByPath (all delegate to updateTask)
 * - Sync phase (always completes): optimistic update, DOM manipulation, UI refresh
 * - Async phase (background): file write, conditional recurrence scheduling (for state updates with repeating dates), state finalization
 * - Per-task locking prevents race conditions from rapid updates
 * - Per-file queueing ensures serialized writes to same file
 * - State updates re-read date/repeat metadata from the live source (open
 *   editor buffer, else the file) so an asynchronously-updated cache cannot
 *   drive recurrence or finalization from stale data
 *
 * This design ensures consistent behavior on both desktop and mobile.
 */
import { Task, DateRepeatInfo, WarningPeriodInfo } from '../types/task';
import { KeywordManager } from '../utils/keyword-manager';
import { getTaskKey } from '../utils/task-utils';
import { hasRepeatingDates } from '../utils/date-repeater';
import { isTaskMetadataLine } from '../utils/task-metadata';
import TodoTracker from '../main';
import { TaskStateManager } from './task-state-manager';
import { TaskWriter } from './task-writer';
import { TFile, MarkdownView, Editor } from 'obsidian';
import { EditorView } from '@codemirror/view';
import { ChangeTracker } from './change-tracker';
import {
  RecurrenceCoordinator,
  RECURRENCE_DELAY_MS,
} from './recurrence-coordinator';
import { TaskStateTransitionManager } from './task-state-transition-manager';
import {
  calculateTaskUrgency,
  getDefaultCoefficients,
  UrgencyContext,
  UrgencyCoefficients,
} from '../utils/task-urgency';
import type { StateTransitionSettings } from '../settings/settings-types';

/**
 * Types of task updates supported by the coordinator
 */
export type UpdateType =
  | 'state'
  | 'scheduled-date'
  | 'deadline-date'
  | 'priority'
  | 'closed-date'
  | 'recurrence';

/**
 * Source of the update (for debugging/tracking)
 */
export type UpdateSource =
  'editor' | 'reader' | 'task-list' | 'embedded' | 'api';

/**
 * Context object for a task update operation.
 * Contains all information needed to perform the update.
 */
export interface UpdateContext {
  /** The task to update */
  task: Task;
  /** Type of update being performed */
  type: UpdateType;
  /** Source of the update */
  source: UpdateSource;
  /** New state (for 'state' type updates) */
  newState?: string;
  /** New date (for date type updates) */
  newDate?: Date | null;
  /** New repeat info (for date type updates) */
  newRepeat?: DateRepeatInfo | null;
  /** New warning period (for date type updates) */
  newWarningPeriod?: WarningPeriodInfo | null;
  /** New priority (for 'priority' type updates) */
  newPriority?: 'high' | 'med' | 'low' | null;
  /** New scheduled date (for 'recurrence' type updates) */
  newScheduledDate?: Date | null;
  /** New deadline date (for 'recurrence' type updates) */
  newDeadlineDate?: Date | null;
  /** New scheduled repeat (for 'recurrence' type updates) */
  newScheduledRepeat?: DateRepeatInfo | null;
  /** New deadline repeat (for 'recurrence' type updates) */
  newDeadlineRepeat?: DateRepeatInfo | null;
  /** New scheduled warning period (for 'recurrence' type updates) */
  newScheduledWarningPeriod?: WarningPeriodInfo | null;
  /** New deadline warning period (for 'recurrence' type updates) */
  newDeadlineWarningPeriod?: WarningPeriodInfo | null;
  /** New state for recurrence (for 'recurrence' type updates) */
  newStateForRecurrence?: string;
}

/**
 * Internal context used during update processing
 */
interface ProcessingContext {
  task: Task;
  type: UpdateType;
  source: UpdateSource;
  /** The state to write to the file (may differ from requested for recurring tasks) */
  newState: string;
  /** The original requested state - used for recurrence checking */
  originalNewState: string;
  newDate?: Date | null;
  newRepeat?: DateRepeatInfo | null;
  newWarningPeriod?: WarningPeriodInfo | null;
  newPriority?: 'high' | 'med' | 'low' | null;
  /** New scheduled date (for 'recurrence' type updates) */
  newScheduledDate?: Date | null;
  /** New deadline date (for 'recurrence' type updates) */
  newDeadlineDate?: Date | null;
  /** New scheduled repeat (for 'recurrence' type updates) */
  newScheduledRepeat?: DateRepeatInfo | null;
  /** New deadline repeat (for 'recurrence' type updates) */
  newDeadlineRepeat?: DateRepeatInfo | null;
  /** New scheduled warning period (for 'recurrence' type updates) */
  newScheduledWarningPeriod?: WarningPeriodInfo | null;
  /** New deadline warning period (for 'recurrence' type updates) */
  newDeadlineWarningPeriod?: WarningPeriodInfo | null;
  /** New state for recurrence (for 'recurrence' type updates) */
  newStateForRecurrence?: string;
  /** Whether the write should stamp a CLOSED date for a completion (recurring roll-forward) */
  recordCompletion?: boolean;
  filePath: string;
  fileLine: number;
}

/**
 * Internal wrapper for tracking pending task updates with timestamps.
 */
interface PendingUpdate {
  /** The promise for the update operation */
  promise: Promise<void>;
  /** Timestamp when the update was queued */
  timestamp: number;
}

/**
 * Internal wrapper for tracking pending file update queues with timestamps.
 */
interface PendingFileQueue {
  /** The promise for the file update queue */
  promise: Promise<unknown>;
  /** Timestamp when the queue was created */
  timestamp: number;
}

export class TaskUpdateCoordinator {
  private recurrenceCoordinator: RecurrenceCoordinator;
  private urgencyCoefficients: UrgencyCoefficients = getDefaultCoefficients();
  private transitionSettings?: StateTransitionSettings;
  public stateTransitionManager: TaskStateTransitionManager;

  /** Per-task locking: prevents race conditions from rapid updates to same task */
  private pendingTaskUpdates = new Map<string, PendingUpdate>();

  /** Per-file queueing: ensures serialized writes to same file */
  private fileUpdateQueues = new Map<string, PendingFileQueue>();

  /** Cleanup interval for removing stale map entries */
  private cleanupInterval: number | null = null;

  /** Interval between cleanup runs (5 seconds) */
  private readonly CLEANUP_INTERVAL_MS = 5000;

  /** Timeout after which an entry is considered stale (30 seconds) */
  private readonly STALE_ENTRY_TIMEOUT_MS = 30000;

  constructor(
    private plugin: TodoTracker,
    private taskStateManager: TaskStateManager,
    private keywordManager: KeywordManager,
    private changeTracker: ChangeTracker,
  ) {
    this.recurrenceCoordinator = new RecurrenceCoordinator(
      this.plugin,
      this.taskStateManager,
      this.keywordManager,
    );

    // Initialize cached state transition manager
    this.transitionSettings = this.plugin.settings?.stateTransitions;
    this.stateTransitionManager = new TaskStateTransitionManager(
      this.keywordManager,
      this.transitionSettings,
    );

    // Set the TaskUpdateCoordinator reference to avoid circular dependency
    this.recurrenceCoordinator.setTaskUpdateCoordinator(this);

    // Start periodic cleanup of stale map entries
    this.startCleanup();
  }

  /**
   * Update the urgency coefficients (called when settings change).
   */
  setUrgencyCoefficients(coefficients: UrgencyCoefficients): void {
    this.urgencyCoefficients = coefficients;
  }

  /**
   * Update the keyword manager (called when settings change).
   */
  setKeywordManager(keywordManager: KeywordManager): void {
    this.keywordManager = keywordManager;
    this.recurrenceCoordinator.setKeywordManager(keywordManager);
    // Recreate state transition manager with new keyword manager but same transition settings
    this.stateTransitionManager = new TaskStateTransitionManager(
      keywordManager,
      this.transitionSettings,
    );
  }

  /**
   * Update the state transition manager (called when settings change).
   */
  setStateTransitionSettings(
    transitionSettings?: StateTransitionSettings,
  ): void {
    this.transitionSettings = transitionSettings;
    this.stateTransitionManager = new TaskStateTransitionManager(
      this.keywordManager,
      transitionSettings,
    );
  }

  /**
   * Get the state transition manager.
   * Returns the shared instance if available, otherwise creates a fallback.
   * This supports test environments where the coordinator may be partially initialized.
   */
  getStateTransitionManager(
    keywordManager: KeywordManager,
    transitionSettings?: StateTransitionSettings,
  ): TaskStateTransitionManager {
    if (this.stateTransitionManager) {
      return this.stateTransitionManager;
    }
    // Fallback for environments where the coordinator hasn't initialized the manager
    return new TaskStateTransitionManager(keywordManager, transitionSettings);
  }

  /**
   * UNIFIED ENTRY POINT: Update a task with any combination of changes.
   *
   * This is the SINGLE entry point for all task updates from any view.
   *
   * @param context - Update context containing task and change details
   * @returns Promise resolving when async phase is complete (for testing)
   */
  async updateTask(context: UpdateContext): Promise<void> {
    let effective = context;
    if (context.type === 'state') {
      // Refresh date/repeat metadata from the live source before deciding
      // recurrence and finalising state (see resolveLiveTaskFromEditor).
      const fromEditor = this.resolveLiveTaskFromEditor(context.task);
      if (fromEditor) {
        effective = { ...context, task: fromEditor };
      } else if (this.plugin.vaultScanner?.getParser()) {
        const fromVault = await this.resolveLiveStateTaskFromVault(
          context.task,
        );
        if (fromVault) {
          effective = { ...context, task: fromVault };
        }
      }
    }

    const procContext = this.buildProcessingContext(effective);
    this.performSyncPhase(procContext);
    return this.queueAsyncPhase(procContext);
  }

  /**
   * Convenience method for updating task state.
   */
  async updateTaskState(
    task: Task,
    newState: string,
    source: UpdateSource = 'editor',
  ): Promise<void> {
    return this.updateTask({
      task,
      type: 'state',
      source,
      newState,
    });
  }

  /**
   * Convenience method for updating scheduled date.
   */
  async updateTaskScheduledDate(
    task: Task,
    date: Date | null,
    repeat?: DateRepeatInfo | null,
    warningPeriod?: WarningPeriodInfo | null,
  ): Promise<void> {
    return this.updateTask({
      task,
      type: 'scheduled-date',
      source: 'task-list',
      newDate: date,
      newRepeat: repeat,
      newWarningPeriod: warningPeriod,
    });
  }

  /**
   * Convenience method for updating deadline date.
   */
  async updateTaskDeadlineDate(
    task: Task,
    date: Date | null,
    repeat?: DateRepeatInfo | null,
    warningPeriod?: WarningPeriodInfo | null,
  ): Promise<void> {
    return this.updateTask({
      task,
      type: 'deadline-date',
      source: 'task-list',
      newDate: date,
      newRepeat: repeat,
      newWarningPeriod: warningPeriod,
    });
  }

  /**
   * Convenience method for updating task priority.
   */
  async updateTaskPriority(
    task: Task,
    newPriority: 'high' | 'med' | 'low' | null,
    source: UpdateSource = 'task-list',
  ): Promise<void> {
    return this.updateTask({
      task,
      type: 'priority',
      source,
      newPriority,
    });
  }

  /**
   * Convenience method for updating task recurrence.
   * Updates scheduled date, deadline date, and state for recurring tasks.
   *
   * `source` must match the interaction that scheduled the roll-forward so the
   * write uses the same API (editor vs vault) as the completion that triggered
   * it — mixing the two on the same file races with Obsidian's auto-save.
   */
  async updateTaskRecurrence(
    task: Task,
    options: {
      newScheduledDate?: Date | null;
      newDeadlineDate?: Date | null;
      newScheduledRepeat?: DateRepeatInfo | null;
      newDeadlineRepeat?: DateRepeatInfo | null;
      newScheduledWarningPeriod?: WarningPeriodInfo | null;
      newDeadlineWarningPeriod?: WarningPeriodInfo | null;
      newStateForRecurrence?: string;
      source?: UpdateSource;
    },
  ): Promise<void> {
    const { source = 'task-list', ...rest } = options;
    return this.updateTask({
      task,
      type: 'recurrence',
      source,
      ...rest,
    });
  }

  /**
   * Schedule the delayed recurrence roll-forward for a task with repeating
   * dates that was completed outside of `updateTask` (e.g. by the Task Editor
   * modal). No-op when the task has no repeating dates. The caller is
   * responsible for having already written the RESET state and, where
   * applicable, a CLOSED date. `source` routes the roll-forward through the
   * same write API as the completion.
   */
  scheduleRecurrenceIfRecurring(
    task: Task,
    source: UpdateSource = 'task-list',
  ): void {
    if (!hasRepeatingDates(task)) {
      return;
    }
    this.recurrenceCoordinator.scheduleRecurrence(task, undefined, source);
  }

  /**
   * Convenience method: Update task state by path and line.
   * If the task is not found (e.g., was archived), re-parse it from the file
   * if the new state is non-archived.
   */
  async updateTaskByPath(
    taskPath: string,
    taskLine: number,
    newState: string,
    source: UpdateSource = 'editor',
    cellIndex?: number,
  ): Promise<void> {
    let task = this.taskStateManager.findTaskByPathAndLine(
      taskPath,
      taskLine,
      cellIndex,
    );

    if (!task && !this.keywordManager.isArchived(newState)) {
      task = await this.reAddTaskFromFile(taskPath, taskLine, cellIndex);
    }

    if (!task) {
      console.debug(
        `[TaskUpdateCoordinator] Task not found at path=${taskPath}, line=${taskLine}`,
      );
      return;
    }

    return this.updateTask({
      task,
      type: 'state',
      source,
      newState,
    });
  }

  /**
   * Re-parse a task from a file and add it to the state manager.
   * Used when a task transitions from archived back to a non-archived state.
   */
  private async reAddTaskFromFile(
    taskPath: string,
    taskLine: number,
    cellIndex?: number,
  ): Promise<Task | null> {
    const parser = this.plugin.vaultScanner?.getParser();
    if (!parser) {
      return null;
    }

    try {
      const file = this.plugin.app.vault.getAbstractFileByPath(taskPath);
      if (!(file instanceof TFile)) {
        return null;
      }

      const content = await this.plugin.app.vault.read(file);
      const lines = content.split('\n');

      if (taskLine < 0 || taskLine >= lines.length) {
        return null;
      }

      // Parse the whole file so the task carries its SCHEDULED/DEADLINE/
      // CLOSED/STARTED/DESCRIPTION lines. parseLine(AsTask) parses only the
      // task line and returns null dates, which would drop recurrence metadata
      // when a task is re-added after being un-archived.
      const parsedTask =
        parser
          .parseFile(content, taskPath, file)
          .find(
            (candidate) =>
              candidate.line === taskLine &&
              (cellIndex === undefined ||
                candidate.tableCell?.cellIndex === cellIndex),
          ) ?? null;

      if (parsedTask) {
        const existingTask = this.taskStateManager.findTaskByPathAndLine(
          taskPath,
          taskLine,
          cellIndex,
        );
        if (!existingTask) {
          this.taskStateManager.addTask(parsedTask);
        }
        return parsedTask;
      }
    } catch (error) {
      console.debug(`[TaskUpdateCoordinator] Failed to re-parse task:`, error);
    }

    return null;
  }

  /**
   * Build processing context with all required fields populated
   */
  private buildProcessingContext(context: UpdateContext): ProcessingContext {
    let newState = context.newState ?? '';
    // Preserve the original requested state for recurrence checking
    const originalNewState = context.newState ?? '';
    let recordCompletion = false;

    if (context.type === 'state' && context.newState) {
      // Only a genuine completion (DONE), not a cancellation, rolls a
      // recurring task forward.
      const isRecurrenceCompletion =
        this.keywordManager.isCompleted(context.newState) &&
        !this.keywordManager.isCanceled(context.newState);
      const repeats = hasRepeatingDates(context.task);

      // For recurring tasks being marked complete, the state is reset to the
      // next inactive state immediately (instant reopen) while still stamping
      // a CLOSED date so the completion is recorded. The delayed recurrence
      // update then advances the dates and preserves the CLOSED line.
      if (isRecurrenceCompletion && repeats) {
        // Use cached state transition manager instead of creating new instance
        newState = this.stateTransitionManager.getNextState(context.newState);
        recordCompletion = true;
      }
    }

    return {
      task: context.task,
      type: context.type,
      source: context.source,
      newState,
      originalNewState,
      newDate: context.newDate,
      newRepeat: context.newRepeat,
      newWarningPeriod: context.newWarningPeriod,
      newPriority: context.newPriority,
      newScheduledDate: context.newScheduledDate,
      newDeadlineDate: context.newDeadlineDate,
      newScheduledRepeat: context.newScheduledRepeat,
      newDeadlineRepeat: context.newDeadlineRepeat,
      newScheduledWarningPeriod: context.newScheduledWarningPeriod,
      newDeadlineWarningPeriod: context.newDeadlineWarningPeriod,
      newStateForRecurrence: context.newStateForRecurrence,
      recordCompletion,
      filePath: context.task.path,
      fileLine: context.task.line,
    };
  }

  /**
   * SYNC PHASE: Execute immediately, always completes.
   */
  private performSyncPhase(context: ProcessingContext): void {
    const newState =
      context.type === 'state'
        ? context.newState
        : (context.newStateForRecurrence ?? '');

    if (
      context.type === 'state' ||
      (context.type === 'recurrence' && context.newStateForRecurrence)
    ) {
      this.taskStateManager.optimisticUpdate(context.task, newState);

      if (this.keywordManager.isArchived(newState)) {
        this.removeTaskFromStateManager(context.task);
      }
    }

    if (context.type === 'state') {
      this.performDirectEmbedDOMUpdate(context.task, context.newState);
    }
  }

  /**
   * ASYNC PHASE: Queue for background execution.
   */
  private async queueAsyncPhase(context: ProcessingContext): Promise<void> {
    const taskKey = getTaskKey(context.task);
    const existingUpdate = this.pendingTaskUpdates.get(taskKey);

    const asyncWork = async (): Promise<void> => {
      if (existingUpdate) {
        try {
          await existingUpdate.promise;
        } catch (priorError) {
          // Swallow previous rejection: the new update must still run
          // even when the previous update threw, otherwise rapid edits to
          // the same task would silently drop the next update. Logged at
          // debug level for diagnosability without surfacing as error.
          console.debug(
            '[TaskUpdateCoordinator] Prior task-update rejected; continuing with queued update.',
            priorError,
          );
        }
      }
      await this.performAsyncPhase(context);
    };

    const promise = asyncWork();
    this.pendingTaskUpdates.set(taskKey, {
      promise,
      timestamp: Date.now(),
    });

    try {
      await promise;
    } finally {
      this.pendingTaskUpdates.delete(taskKey);
    }
  }

  /**
   * Resolve the stored task from the state manager, with content-based fallback.
   * Used for non-editor sources where the line number may have shifted.
   */
  private resolveStoredTask(context: ProcessingContext): Task {
    let storedTask = this.taskStateManager.findTaskByPathAndLine(
      context.filePath,
      context.fileLine,
      context.task.tableCell?.cellIndex,
    );

    if (!storedTask || storedTask.rawText !== context.task.rawText) {
      const validatedTask = this.taskStateManager.findTaskByContent(
        context.filePath,
        context.task,
      );
      if (validatedTask) {
        storedTask = validatedTask;
      }
    }

    return storedTask || context.task;
  }

  /**
   * Re-read a task's date/repeat/CLOSED metadata from its live source before a
   * state update.
   *
   * The {@link TaskStateManager} copy is updated asynchronously by the vault
   * scanner, so it can be stale right after the user edits a date line (or the
   * scanner's skip-own-writes window suppresses the change). Deciding recurrence
   * or finalising state from that stale copy is what previously left a repeat
   * status behind after the SCHEDULED line was deleted.
   *
   * The cached task is still used for identity: we locate it by its recorded
   * line (falling back to a unique raw-text match) and only refresh its fields.
   *
   * The editor case is synchronous (freshest and cheap) so optimistic UI is not
   * delayed; the file case is async because it needs a read.
   */
  private resolveLiveTaskFromEditor(task: Task): Task | null {
    const parser = this.plugin.vaultScanner?.getParser();
    if (!parser) {
      return null;
    }

    const editor = this.findEditorForPath(task.path);
    if (!editor) {
      return null;
    }

    try {
      const index = this.locateTaskLine(
        (i) => editor.getLine(i),
        editor.lineCount(),
        task,
      );
      if (index === null) {
        return null;
      }
      const block = this.readEditorTaskBlock(editor, index);
      const reparsed = parser.parseTaskBlock(
        block,
        index,
        task.path,
        undefined,
        task.tableCell?.cellIndex,
      );
      return this.preserveParentHeading(reparsed, task);
    } catch (error) {
      console.debug(
        '[TaskUpdateCoordinator] Failed to resolve task from editor',
        error,
      );
      return null;
    }
  }

  /** File-based counterpart of {@link resolveLiveTaskFromEditor}. */
  private async resolveLiveStateTaskFromVault(
    task: Task,
  ): Promise<Task | null> {
    const parser = this.plugin.vaultScanner?.getParser();
    if (!parser) {
      return null;
    }

    try {
      const file = this.plugin.app.vault.getAbstractFileByPath(task.path);
      if (!(file instanceof TFile)) {
        return null;
      }
      const content = await this.plugin.app.vault.read(file);
      const lines = content.split('\n');
      const index = this.locateTaskLine((i) => lines[i], lines.length, task);
      if (index === null) {
        return null;
      }
      const reparsed = parser.parseTaskBlock(
        lines,
        index,
        task.path,
        file,
        task.tableCell?.cellIndex,
      );
      return this.preserveParentHeading(reparsed, task);
    } catch (error) {
      console.debug(
        '[TaskUpdateCoordinator] Failed to resolve live task from file',
        error,
      );
      return null;
    }
  }

  /**
   * Carry the grouping context from the cached task onto a freshly re-parsed
   * copy. Single-block re-parses have no surrounding lines, so they cannot
   * recover the nearest heading themselves.
   */
  private preserveParentHeading(
    reparsed: Task | null,
    original: Task,
  ): Task | null {
    if (reparsed && reparsed.parentHeading === undefined) {
      reparsed.parentHeading = original.parentHeading;
    }
    return reparsed;
  }

  /** Find an open Markdown editor showing `path`, if any. */
  private findEditorForPath(path: string): Editor | null {
    const leaves = this.plugin.app.workspace.getLeavesOfType('markdown');
    for (const leaf of leaves) {
      const view = leaf.view;
      if (view instanceof MarkdownView && view.file?.path === path) {
        return view.editor;
      }
    }
    return null;
  }

  /**
   * Locate the task within a set of lines. Prefers the recorded line, then a
   * unique raw-text match, then the recorded line as a last resort (the caller
   * still validates the parsed result).
   */
  private locateTaskLine(
    getLine: (index: number) => string | undefined,
    length: number,
    task: Task,
  ): number | null {
    if (getLine(task.line) === task.rawText) {
      return task.line;
    }

    let match = -1;
    for (let i = 0; i < length; i++) {
      if (getLine(i) === task.rawText) {
        if (match >= 0) {
          // Ambiguous raw-text match; fall back to the recorded line.
          return task.line >= 0 && task.line < length ? task.line : null;
        }
        match = i;
      }
    }

    if (match >= 0) {
      return match;
    }
    return task.line >= 0 && task.line < length ? task.line : null;
  }

  /**
   * Read the task line and its contiguous date/DESCRIPTION lines from an
   * editor as a sparse array (only the task block is materialised).
   */
  private readEditorTaskBlock(editor: Editor, index: number): string[] {
    const block: string[] = [];
    block.length = index + 1;
    block[index] = editor.getLine(index);

    // Include the whole contiguous metadata block, including `[!repeats]` log
    // lines, so the re-parsed task keeps its repeatCount. Blank lines are
    // included rather than breaking, matching the parser (which skips blanks
    // and would otherwise hit an `undefined` hole in this sparse array).
    for (let i = index + 1; i < editor.lineCount(); i++) {
      const line = editor.getLine(i);
      if (line.trim() === '') {
        block[i] = line;
        continue;
      }
      if (!isTaskMetadataLine(line)) {
        break;
      }
      block[i] = line;
    }
    return block;
  }

  /**
   * ASYNC PHASE: Perform file write, recurrence, and state finalization.
   */
  private async performAsyncPhase(context: ProcessingContext): Promise<void> {
    const existingQueue = this.fileUpdateQueues.get(context.filePath);

    const doAsyncWork = async (): Promise<void> => {
      const taskEditor = this.plugin.taskEditor;
      if (!taskEditor) {
        throw new Error('TaskEditor is not initialized');
      }

      // When source is 'editor' use the editor-parsed task directly, and for
      // state updates updateTask() has already refreshed the task from the live
      // buffer/file (resolveLiveTaskFromEditor / resolveLiveStateTaskFromVault),
      // so use that too. Otherwise fall back to the stored copy.
      const currentTask =
        context.source === 'editor' || context.type === 'state'
          ? context.task
          : this.resolveStoredTask(context);

      let updatedTask: Task;
      try {
        this.plugin.vaultScanner?.addSkipIncrementalChange(context.filePath);
        updatedTask = await this.performFileWrite(
          taskEditor,
          currentTask,
          context,
        );
      } catch (error) {
        console.error(
          `[TODOseq] File write failed for ${context.type} at line ${context.fileLine}:`,
          error,
        );
        const file = this.plugin.app.vault.getAbstractFileByPath(
          context.filePath,
        );
        if (file instanceof TFile) {
          await this.plugin.vaultScanner?.processIncrementalChange(file);
        }
        return;
      }

      const lineDelta = (updatedTask as Task & { lineDelta?: number })
        .lineDelta;
      if (lineDelta !== undefined && lineDelta !== 0) {
        this.taskStateManager.adjustLineIndices(
          currentTask.path,
          currentTask.line + 1,
          lineDelta,
        );
      }

      this.finalizeTaskState(updatedTask, context);

      if (context.type === 'state') {
        this.handleRecurrence(updatedTask, context);

        // Update editor checkbox visual state after markdown has been updated
        // Only for editor updates to prevent Obsidian's re-render from overriding checkbox state
        if (context.source === 'editor') {
          this.performDirectEditorCheckboxUpdate(updatedTask, context.newState);
        }
      } else if (
        context.type === 'scheduled-date' ||
        context.type === 'deadline-date'
      ) {
        // Adding or changing a schedule/repeat on a task that is already
        // completed now rolls the occurrence forward (previously this was
        // silently inert). Archived tasks are intentionally excluded.
        this.handleRecurrenceForCompletedTask(updatedTask, context.source);
      }
    };

    // Run doAsyncWork regardless of whether the previous file update
    // fulfilled or rejected. Using .then(doAsyncWork, doAsyncWork) ensures
    // a transient error in one update (e.g., finalizeTaskState throwing)
    // cannot silently drop the very next queued update for this file.
    const queuePromise = existingQueue
      ? existingQueue.promise.then(doAsyncWork, (priorError: unknown) => {
          // Mirror the per-task queue: log the swallowed rejection at
          // debug level for diagnosability while still running the new work.
          console.debug(
            '[TaskUpdateCoordinator] Prior file-update rejected; continuing with queued update.',
            priorError,
          );
          return doAsyncWork();
        })
      : doAsyncWork();

    this.fileUpdateQueues.set(context.filePath, {
      promise: queuePromise,
      timestamp: Date.now(),
    });

    try {
      await queuePromise;
    } finally {
      if (
        this.fileUpdateQueues.get(context.filePath)?.promise === queuePromise
      ) {
        this.fileUpdateQueues.delete(context.filePath);
      }
    }
  }

  /**
   * Perform the appropriate file write based on update type
   */
  private async performFileWrite(
    taskEditor: TaskWriter,
    task: Task,
    context: ProcessingContext,
  ): Promise<Task> {
    // Only the editor's own commands should edit the live editor buffer.
    // Updates coming from the Task List, embedded code blocks or the reader go
    // through the vault so they do not move the cursor/scroll of an open note
    // (Obsidian re-renders the file for us).
    const forceVaultApi = context.source !== 'editor';

    switch (context.type) {
      case 'state':
        return taskEditor.updateTaskState(task, context.newState, {
          recordCompletion: context.recordCompletion,
          forceVaultApi,
        });

      case 'scheduled-date':
        if (!context.newDate) {
          return taskEditor.removeTaskScheduledDate(task, { forceVaultApi });
        }
        return taskEditor.updateTaskScheduledDate(
          task,
          context.newDate,
          context.newRepeat,
          context.newWarningPeriod,
          { forceVaultApi },
        );

      case 'deadline-date':
        if (!context.newDate) {
          return taskEditor.removeTaskDeadlineDate(task, { forceVaultApi });
        }
        return taskEditor.updateTaskDeadlineDate(
          task,
          context.newDate,
          context.newRepeat,
          context.newWarningPeriod,
          { forceVaultApi },
        );

      case 'priority':
        if (context.newPriority === null || context.newPriority === undefined) {
          return taskEditor.removeTaskPriority(task, { forceVaultApi });
        }
        return taskEditor.updateTaskPriority(task, context.newPriority, {
          forceVaultApi,
        });

      case 'closed-date':
        return task;

      case 'recurrence': {
        // Use atomic update to apply all recurrence changes in a single
        // vault.process call. This creates one undo entry instead of 2-3
        // separate ones, preventing partial-undo bugs where dates are
        // advanced but state is reverted (or vice versa).
        return taskEditor.applyRecurrenceUpdate(task, {
          newScheduledDate: context.newScheduledDate,
          newDeadlineDate: context.newDeadlineDate,
          newScheduledRepeat: context.newScheduledRepeat,
          newDeadlineRepeat: context.newDeadlineRepeat,
          newScheduledWarningPeriod: this.resolveRecurrenceWarningPeriod(
            context.newScheduledWarningPeriod,
            task.scheduledWarningPeriod,
          ),
          newDeadlineWarningPeriod: this.resolveRecurrenceWarningPeriod(
            context.newDeadlineWarningPeriod,
            task.deadlineWarningPeriod,
          ),
          newState: context.newStateForRecurrence,
          forceVaultApi,
        });
      }

      default: {
        const _exhaustiveCheck: never = context.type;
        throw new Error(`Unknown update type: ${String(_exhaustiveCheck)}`);
      }
    }
  }

  /**
   * Finalize task state in the state manager
   */
  private finalizeTaskState(
    updatedTask: Task,
    context: ProcessingContext,
  ): void {
    const isStateUpdate =
      context.type === 'state' || context.type === 'recurrence';
    const newState =
      context.type === 'state' ? context.newState : updatedTask.state;

    if (isStateUpdate && this.keywordManager.isArchived(newState)) {
      this.removeTaskFromStateManager(updatedTask);
      return;
    }

    const urgency = this.calculateUrgencyForTask(updatedTask);
    const cellIndex = updatedTask.tableCell?.cellIndex;

    switch (context.type) {
      case 'state':
        this.taskStateManager.updateTaskByPathAndLine(
          updatedTask.path,
          updatedTask.line,
          {
            rawText: updatedTask.rawText,
            state: updatedTask.state,
            completed: updatedTask.completed,
            scheduledDate: updatedTask.scheduledDate,
            deadlineDate: updatedTask.deadlineDate,
            scheduledDateRepeat: updatedTask.scheduledDateRepeat,
            deadlineDateRepeat: updatedTask.deadlineDateRepeat,
            scheduledWarningPeriod: updatedTask.scheduledWarningPeriod,
            deadlineWarningPeriod: updatedTask.deadlineWarningPeriod,
            closedDate: updatedTask.closedDate,
            startedDate: updatedTask.startedDate,
            createdDate: updatedTask.createdDate,
            urgency,
          },
          cellIndex,
        );
        break;

      case 'scheduled-date':
        this.taskStateManager.updateTaskByPathAndLine(
          updatedTask.path,
          updatedTask.line,
          {
            rawText: updatedTask.rawText,
            scheduledDate: updatedTask.scheduledDate,
            scheduledDateRepeat: updatedTask.scheduledDateRepeat,
            scheduledWarningPeriod: updatedTask.scheduledWarningPeriod,
            urgency,
          },
          cellIndex,
        );
        break;

      case 'deadline-date':
        this.taskStateManager.updateTaskByPathAndLine(
          updatedTask.path,
          updatedTask.line,
          {
            rawText: updatedTask.rawText,
            deadlineDate: updatedTask.deadlineDate,
            deadlineDateRepeat: updatedTask.deadlineDateRepeat,
            deadlineWarningPeriod: updatedTask.deadlineWarningPeriod,
            urgency,
          },
          cellIndex,
        );
        break;

      case 'priority':
        this.taskStateManager.updateTaskByPathAndLine(
          updatedTask.path,
          updatedTask.line,
          {
            rawText: updatedTask.rawText,
            text: updatedTask.text,
            state: updatedTask.state,
            completed: updatedTask.completed,
            priority: updatedTask.priority,
            urgency,
          },
          cellIndex,
        );
        break;

      case 'recurrence':
        this.taskStateManager.updateTaskByPathAndLine(
          updatedTask.path,
          updatedTask.line,
          {
            rawText: updatedTask.rawText,
            state: updatedTask.state,
            completed: updatedTask.completed,
            scheduledDate: updatedTask.scheduledDate,
            deadlineDate: updatedTask.deadlineDate,
            scheduledDateRepeat: updatedTask.scheduledDateRepeat,
            deadlineDateRepeat: updatedTask.deadlineDateRepeat,
            scheduledWarningPeriod: updatedTask.scheduledWarningPeriod,
            deadlineWarningPeriod: updatedTask.deadlineWarningPeriod,
            repeatCount: updatedTask.repeatCount,
            urgency,
          },
          cellIndex,
        );
        break;
    }

    this.taskStateManager.notifySubscribers();
  }

  /**
   * Calculate urgency for a task using current urgency coefficients.
   */
  private calculateUrgencyForTask(task: Task): number | null {
    if (task.completed) {
      return null;
    }

    const urgencyContext: UrgencyContext = {
      activeKeywordsSet: this.keywordManager.getActiveSet(),
      waitingKeywordsSet: this.keywordManager.getWaitingSet(),
    };

    return calculateTaskUrgency(task, this.urgencyCoefficients, urgencyContext);
  }

  /**
   * Handle recurrence scheduling for completed recurring tasks.
   * Receives the post-file-write task (inactive state written, not completed state).
   * Uses originalNewState to detect user's completion intent.
   */
  private handleRecurrence(
    updatedTask: Task,
    context: ProcessingContext,
  ): void {
    // Use originalNewState to check if user requested completion
    // This is the state they clicked (e.g., DONE), not what was written (e.g., TODO).
    // Cancellations are terminal and must not roll a recurring task forward.
    const isOriginalCompleted =
      this.keywordManager.isCompleted(context.originalNewState) &&
      !this.keywordManager.isCanceled(context.originalNewState);

    if (isOriginalCompleted && hasRepeatingDates(updatedTask)) {
      this.recurrenceCoordinator.scheduleRecurrence(
        updatedTask,
        RECURRENCE_DELAY_MS,
        context.source,
      );
    }
  }

  /**
   * Roll an already-completed recurring task forward after its schedule or
   * repeat was added/changed (e.g. the date picker applied a repeat to a DONE
   * task). Archived tasks are skipped: archiving is terminal.
   */
  private handleRecurrenceForCompletedTask(
    updatedTask: Task,
    source: UpdateSource,
  ): void {
    if (
      !this.keywordManager.isCompleted(updatedTask.state) ||
      this.keywordManager.isCanceled(updatedTask.state)
    ) {
      return;
    }

    if (hasRepeatingDates(updatedTask)) {
      this.recurrenceCoordinator.scheduleRecurrence(
        updatedTask,
        RECURRENCE_DELAY_MS,
        source,
      );
    }
  }

  /**
   * Perform direct DOM manipulation on embeds.
   */
  private performDirectEmbedDOMUpdate(task: Task, newState: string): void {
    const fileName = task.path.split('/').pop()?.replace('.md', '');
    if (!fileName) return;

    const embeds = window.activeDocument.querySelectorAll('.internal-embed');

    embeds.forEach((embed) => {
      const src = embed.getAttribute('src');
      if (!src || !src.includes(fileName)) return;

      if (task.embedReference) {
        const blockRef = task.embedReference.replace('^', '');
        if (!src.includes(blockRef)) return;
      }

      const keywordEl = embed.querySelector('[data-task-keyword]');
      if (!keywordEl) return;

      const oldState = keywordEl.getAttribute('data-task-keyword');
      if (!oldState || oldState === newState) return;

      keywordEl.textContent = newState;
      keywordEl.setAttribute('data-task-keyword', newState);
      keywordEl.setAttribute('aria-label', `Task keyword: ${newState}`);
      keywordEl.setAttribute('title', `Task keyword: ${newState}`);

      const wasCompleted = KeywordManager.isCompletedKeyword(
        oldState,
        this.plugin.settings,
      );
      const isNowCompleted = KeywordManager.isCompletedKeyword(
        newState,
        this.plugin.settings,
      );

      if (wasCompleted && !isNowCompleted) {
        const completedContainer = keywordEl.closest(
          '.todoseq-completed-task-text',
        );
        if (completedContainer && completedContainer.parentNode) {
          const parent = completedContainer.parentNode;
          parent.insertBefore(keywordEl, completedContainer.firstChild);
          while (completedContainer.firstChild) {
            parent.insertBefore(completedContainer.firstChild, keywordEl);
          }
          completedContainer.remove();
        }
      }
    });
  }

  /**
   * Perform direct DOM manipulation on editor checkboxes.
   * Updates the checkbox visual state after markdown has been updated.
   */
  private performDirectEditorCheckboxUpdate(
    task: Task,
    newState: string,
  ): void {
    const isCompleted = KeywordManager.isCompletedKeyword(
      newState,
      this.plugin.settings,
    );

    // Get the checkbox state character for the new state
    const newCheckboxState = KeywordManager.getCheckboxState(
      newState,
      this.plugin.settings,
    );

    const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);

    if (!view || !view.file || view.file.path !== task.path) {
      return;
    }

    const editorView = (view.editor as { cm?: EditorView })?.cm;
    if (!editorView) {
      return;
    }

    // Use requestAnimationFrame to wait for Obsidian's re-render to complete
    window.requestAnimationFrame(() => {
      try {
        // Find the line element by line number
        const linePos = editorView.state.doc.line(task.line + 1); // Convert to 1-indexed
        const domAtPos = editorView.domAtPos(linePos.from);

        if (!domAtPos) {
          return;
        }

        // Find the closest line element
        let lineElement: HTMLElement | null = domAtPos.node as HTMLElement;
        while (lineElement && !lineElement.classList.contains('cm-line')) {
          lineElement = lineElement.parentElement;
        }

        if (!lineElement) {
          return;
        }

        // Find the checkbox in this line
        const checkbox = lineElement.querySelector(
          '.task-list-item-checkbox',
        ) as HTMLInputElement;

        if (checkbox) {
          // Only update if the checkbox doesn't already match the expected state
          // This prevents double refresh when Obsidian has already set the correct state
          const currentCheckboxState = checkbox.getAttribute('data-task');
          const currentStateMatches =
            currentCheckboxState === newCheckboxState &&
            checkbox.checked === isCompleted;

          if (!currentStateMatches) {
            // Update checkbox to match the new state
            checkbox.checked = isCompleted;
            // Update data-task attribute to match the new checkbox state (Obsidian's checkbox metadata)
            checkbox.setAttribute('data-task', newCheckboxState);
          }
        }
      } catch {
        // Silently fail if we can't find or update the checkbox
        // This is a visual enhancement, not critical functionality
      }
    });
  }

  /**
   * Remove a task from the state manager and notify subscribers.
   * Used when a task transitions to an archived state.
   */
  private removeTaskFromStateManager(task: Task): void {
    this.taskStateManager.removeTasks(
      (t) =>
        t.path === task.path &&
        t.line === task.line &&
        (task.tableCell?.cellIndex === undefined
          ? true
          : t.tableCell?.cellIndex === task.tableCell.cellIndex),
    );
  }

  /**
   * Start the periodic cleanup interval.
   * Removes stale entries from pendingTaskUpdates and fileUpdateQueues maps.
   */
  private startCleanup(): void {
    this.cleanupInterval = window.setInterval(() => {
      this.cleanupStaleEntries();
    }, this.CLEANUP_INTERVAL_MS);
  }

  /**
   * Clean up stale entries from the pending maps.
   * Removes entries that have been pending longer than STALE_ENTRY_TIMEOUT_MS.
   */
  private cleanupStaleEntries(): void {
    const now = Date.now();
    const staleTaskKeys: string[] = [];
    const staleFilePaths: string[] = [];

    // Check pendingTaskUpdates for stale entries
    for (const [key, update] of this.pendingTaskUpdates.entries()) {
      if (now - update.timestamp > this.STALE_ENTRY_TIMEOUT_MS) {
        staleTaskKeys.push(key);
      }
    }

    // Check fileUpdateQueues for stale entries
    for (const [path, queue] of this.fileUpdateQueues.entries()) {
      if (now - queue.timestamp > this.STALE_ENTRY_TIMEOUT_MS) {
        staleFilePaths.push(path);
      }
    }

    // Remove stale entries
    for (const key of staleTaskKeys) {
      this.pendingTaskUpdates.delete(key);
    }

    for (const path of staleFilePaths) {
      this.fileUpdateQueues.delete(path);
    }
  }

  /**
   * Resolve the warning period for recurrence updates.
   * undefined = keep existing (no change requested)
   * null + existing is firstOnly = strip (first-only removed after first occurrence)
   * null + existing is regular = keep (regular periods persist across recurrences)
   * value = use the provided value
   */
  private resolveRecurrenceWarningPeriod(
    newWp: WarningPeriodInfo | null | undefined,
    existingWp: WarningPeriodInfo | null,
  ): WarningPeriodInfo | null {
    if (newWp === undefined) return existingWp;
    // null + regular (non-firstOnly) = keep existing (regular periods persist)
    if (newWp === null && existingWp && !existingWp.isFirstOnly)
      return existingWp;
    return newWp;
  }

  /**
   * Clean up resources.
   */
  destroy(): void {
    // Stop cleanup interval
    if (this.cleanupInterval) {
      window.clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    // Clear maps to prevent memory leaks
    this.pendingTaskUpdates.clear();
    this.fileUpdateQueues.clear();

    // Clean up recurrence coordinator to clear pending timeouts
    this.recurrenceCoordinator.destroy();

    // ChangeTracker is now owned by main.ts and destroyed there
  }
}

/**
 * Get the TaskStateTransitionManager from a coordinator, or create a fallback instance.
 * This centralizes the logic for accessing the manager in environments where the
 * coordinator may not be fully initialized (e.g., unit tests or minimal mocks).
 *
 * @param coordinator - The TaskUpdateCoordinator instance (may be undefined or mock)
 * @param keywordManager - The KeywordManager to use for fallback creation
 * @param transitionSettings - Optional transition settings for fallback creation
 * @returns The shared state transition manager or a new fallback instance
 */
type CoordinatorRef =
  | {
      stateTransitionManager?: TaskStateTransitionManager;
    }
  | null
  | undefined;
export function getStateTransitionManager(
  coordinator: CoordinatorRef,
  keywordManager: KeywordManager,
  transitionSettings?: StateTransitionSettings,
): TaskStateTransitionManager {
  if (coordinator?.stateTransitionManager) {
    return coordinator.stateTransitionManager;
  }
  // Fallback for test environments or incomplete initialization
  return new TaskStateTransitionManager(keywordManager, transitionSettings);
}
