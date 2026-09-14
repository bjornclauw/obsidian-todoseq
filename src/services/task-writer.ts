import { App, TFile, MarkdownView, EditorPosition, Editor } from 'obsidian';
import { Task, DateRepeatInfo, WarningPeriodInfo } from '../types/task';
import type { TaskListMarkerStyle } from '../settings/settings-types';
import { CHECKBOX_DETECTION_REGEX } from '../utils/patterns';
import { KeywordManager } from '../utils/keyword-manager';
import { DateUtils } from '../utils/date-utils';
import {
  buildWarningPeriodString,
  hasRepeatingDates,
} from '../utils/date-repeater';
import {
  REPEAT_LOG_ENTRY_RE,
  buildRepeatLogEntry,
  buildRepeatLogTitle,
  getLineIndent,
  parseRepeatLogTotal,
} from '../utils/repeat-log';
import {
  findDateLine,
  findDescriptionLine,
  findDescriptionLineIn,
  getTaskIndent,
  getDateLineIndent,
} from '../utils/task-line-utils';
import { isTaskMetadataLine } from '../utils/task-metadata';
import TodoTracker from '../main';
import { getStateTransitionManager } from './task-update-coordinator';

/** A SCHEDULED/DEADLINE/CLOSED/STARTED/CREATED date line kind. */
type DateLineType = 'SCHEDULED' | 'DEADLINE' | 'CLOSED' | 'STARTED' | 'CREATED';

export interface DateLineUpdateResult {
  task: Task;
  lineDelta: number;
}

/**
 * Editable fields used by the task editor modal to compose (create or edit) a
 * task. Date repeat and warning-period metadata is preserved when editing but
 * is intentionally not exposed in the mobile editor UI.
 */
export interface TaskComposeFields {
  text: string;
  state: string;
  priority: 'high' | 'med' | 'low' | null;
  scheduledDate: Date | null;
  scheduledRepeat: DateRepeatInfo | null;
  scheduledWarningPeriod: WarningPeriodInfo | null;
  deadlineDate: Date | null;
  deadlineRepeat: DateRepeatInfo | null;
  deadlineWarningPeriod: WarningPeriodInfo | null;
  description: string | null;
  /**
   * List prefix for a newly created task. Ignored when editing an existing
   * task (its own marker is preserved). Defaults to `checkbox`.
   */
  listMarker?: TaskListMarkerStyle;
}

/** Result of a compose operation: the updated task snapshot and line delta. */
export interface TaskComposeResult {
  task: Task;
  lineDelta: number;
}

/** Result of scanning a task's metadata block for repeat-log handling. */
interface ScannedRepeatLogBlock {
  metadata: string[];
  entries: string[];
  titleLine: string | null;
  start: number;
  endBefore: number;
}

/**
 * Handles writing task state changes to files.
 */
export class TaskWriter {
  /**
   * Prefer Editor API for the active file to preserve cursor/selection/folds and UX.
   * Prefer Vault.process for background edits to perform atomic writes.
   */
  constructor(
    private readonly plugin: TodoTracker,
    private keywordManager: KeywordManager,
  ) {}

  /**
   * Update the KeywordManager instance when settings change.
   */
  public updateKeywordManager(keywordManager: KeywordManager): void {
    this.keywordManager = keywordManager;
  }

  private get app(): App {
    return this.plugin.app;
  }

  private get settings() {
    return this.plugin.settings;
  }

  /**
   * Whether a CLOSED date should be written. `recordCompletion` forces one for
   * a recurring completion only when the repeat log is disabled; otherwise the
   * completion is recorded in the `[!repeats]` callout instead.
   */
  private shouldWriteClosed(state: string, recordCompletion: boolean): boolean {
    if (!this.settings?.trackClosedDate) {
      return false;
    }
    if (this.keywordManager.isCompleted(state)) {
      return true;
    }
    return recordCompletion && !this.settings?.trackRepeatHistory;
  }

  /** Whether an existing CLOSED date must be kept (archived or recurring task). */
  private preservesClosed(task: Task, newState: string): boolean {
    return this.keywordManager.isArchived(newState) || hasRepeatingDates(task);
  }

  /** Whether recurring completions are logged in a `[!repeats]` callout. */
  private isRepeatLogEnabled(): boolean {
    return !!this.settings?.trackRepeatHistory;
  }

  /** Configured maximum number of entries kept in a `[!repeats]` callout. */
  private repeatHistoryLimit(): number {
    const limit = this.settings?.repeatHistoryLimit ?? 50;
    return Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 50;
  }

  /**
   * Scan a task's metadata block for the date/DESCRIPTION lines and any
   * existing `[!repeats]` log. Works over a line accessor so the editor path can
   * scan only the block instead of materialising the whole buffer.
   *
   * Blank lines are skipped (matching the parser) so a stray blank left where a
   * date line was removed does not cause a duplicate log to be created.
   */
  private scanRepeatLogBlock(
    getLine: (index: number) => string | undefined,
    lineCount: number,
    taskLine: number,
  ): ScannedRepeatLogBlock {
    const start = taskLine + 1;
    let titleLine: string | null = null;
    let lastMetaIdx = taskLine;
    const metadata: string[] = [];
    let entries: string[] = [];

    for (let i = start; i < lineCount; i++) {
      const line = getLine(i);
      if (line === undefined || line.trim() === '') {
        continue;
      }
      if (!isTaskMetadataLine(line)) {
        break;
      }
      if (parseRepeatLogTotal(line) !== null) {
        titleLine = line;
        // Entries only ever belong to the most recent title.
        entries = [];
      } else if (REPEAT_LOG_ENTRY_RE.test(line)) {
        entries.push(line);
      } else {
        metadata.push(line);
      }
      lastMetaIdx = i;
    }

    return {
      metadata,
      entries,
      titleLine,
      start,
      endBefore: Math.max(start, lastMetaIdx + 1),
    };
  }

  /** Build the refreshed metadata + `[!repeats]` region for a scanned block. */
  private buildRepeatLogRegion(
    scanned: ScannedRepeatLogBlock,
    task: Task,
    total: number,
    limit: number,
    closedAt: Date,
    occurrence: Date | null,
  ): { region: string[]; lineDelta: number } {
    const { metadata, entries, titleLine, start, endBefore } = scanned;
    const indent = titleLine
      ? getLineIndent(titleLine)
      : getDateLineIndent(task);

    const combined = [
      buildRepeatLogEntry(total, closedAt, occurrence, indent),
      ...entries,
    ].slice(0, limit);
    const region = [
      ...metadata,
      buildRepeatLogTitle(total, limit, indent),
      ...combined,
    ];

    return { region, lineDelta: region.length - (endBefore - start) };
  }

  /**
   * Insert or refresh the `[!repeats]` callout for a recurring completion.
   * Mutates `lines` in place and returns the region that changed so the caller
   * can mirror the same edit through the editor API.
   */
  private applyRepeatLogToLines(
    lines: string[],
    task: Task,
    total: number,
    limit: number,
    closedAt: Date,
    occurrence: Date | null,
  ): { lineDelta: number; start: number; endBefore: number } {
    const scanned = this.scanRepeatLogBlock(
      (i) => lines[i],
      lines.length,
      task.line,
    );
    const { region, lineDelta } = this.buildRepeatLogRegion(
      scanned,
      task,
      total,
      limit,
      closedAt,
      occurrence,
    );

    lines.splice(scanned.start, scanned.endBefore - scanned.start, ...region);
    return { lineDelta, start: scanned.start, endBefore: scanned.endBefore };
  }

  /**
   * Leading newline needed when inserting a line at `insertIndex`.
   *
   * Obsidian clamps an out-of-range `{ line }` position to the end of the
   * document, so inserting at `editor.lineCount()` appends after the last
   * character. When the document does not end with a newline that merges the
   * inserted line onto the previous one, so prepend one.
   */
  private leadingNewlineForInsert(editor: Editor, insertIndex: number): string {
    if (insertIndex < editor.lineCount()) {
      return '';
    }
    const lastLine = editor.getLine(editor.lineCount() - 1);
    return typeof lastLine === 'string' && lastLine.length > 0 ? '\n' : '';
  }

  /** Editor-API mirror of {@link applyRepeatLogToLines}. */
  private updateRepeatLogInEditor(
    editor: Editor,
    task: Task,
    total: number,
    limit: number,
    closedAt: Date,
    occurrence: Date | null,
  ): number {
    // Scan only the task's metadata block rather than snapshotting the whole
    // buffer (which is O(file) on large notes).
    const scanned = this.scanRepeatLogBlock(
      (i) => editor.getLine(i),
      editor.lineCount(),
      task.line,
    );
    const { region, lineDelta } = this.buildRepeatLogRegion(
      scanned,
      task,
      total,
      limit,
      closedAt,
      occurrence,
    );

    const { start, endBefore } = scanned;
    // `replaceRange` to {line: endBefore, ch: 0} consumes the newline that
    // terminated the last replaced line. Re-add it when content follows, or the
    // log swallows the blank line under it and pulls the rest of the note in.
    const suffix = endBefore < editor.lineCount() ? '\n' : '';
    const prefix = this.leadingNewlineForInsert(editor, start);
    editor.replaceRange(
      `${prefix}${region.join('\n')}${suffix}`,
      { line: start, ch: 0 },
      { line: endBefore, ch: 0 },
    );
    return lineDelta;
  }

  /**
   * Whether a STARTED date should be written when a task is created already in
   * an active state. Later state transitions are handled by
   * {@link shouldUpdateStarted}, which overwrites the existing value.
   */
  private shouldWriteStarted(state: string): boolean {
    return (
      !!this.settings?.trackStartedDate && this.keywordManager.isActive(state)
    );
  }

  /**
   * Whether STARTED should be (re)written for a state transition. Only fires on
   * a genuine entry into an active state: saving an already-active task (e.g.
   * editing its text) must not reset the restart time.
   */
  private shouldUpdateStarted(task: Task, newState: string): boolean {
    return (
      !!this.settings?.trackStartedDate &&
      this.keywordManager.isActive(newState) &&
      !this.keywordManager.isActive(task.state)
    );
  }

  /** Whether a CREATED timestamp should be written for a newly created task. */
  private shouldWriteCreated(): boolean {
    return !!this.settings?.trackCreatedDate;
  }

  private static buildDateLineContent(
    date: Date,
    repeat?: DateRepeatInfo | null,
    warningPeriod?: WarningPeriodInfo | null,
  ): string {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const timeStr =
      date.getHours() === 0 && date.getMinutes() === 0
        ? ''
        : ` ${hours}:${minutes}`;
    const repeatStr = repeat ? ` ${repeat.raw}` : '';
    const warningStr = buildWarningPeriodString(warningPeriod);
    return `<${DateUtils.formatDateContent(date)}${timeStr}${repeatStr}${warningStr}>`;
  }

  /**
   * Format a CLOSED/STARTED timestamp for a table cell. Cells store these as a
   * wikilink: `[[YYYY-MM-DD DOW HH:mm]]`.
   */
  private static formatTableCellTimestamp(date: Date): string {
    // DateUtils.formatClosedDate returns "[YYYY-MM-DD DOW HH:mm]"; wrapping it
    // in another pair of brackets yields the cell wikilink "[[…]]".
    return `[${DateUtils.formatClosedDate(date)}]`;
  }

  // Pure formatter of a task line given a new state and optional priority retention
  static generateTaskLine(
    task: Task,
    newState: string,
    keepPriority = true,
    keywordManager: KeywordManager,
  ): { newLine: string; completed: boolean } {
    const keywordManagerInstance = keywordManager;
    const priToken =
      keepPriority && task.priority
        ? task.priority === 'high'
          ? '[#A]'
          : task.priority === 'med'
            ? '[#B]'
            : '[#C]'
        : null;

    const priorityPart = priToken ? ` ${priToken}` : '';

    // Check if the original task was a markdown checkbox using shared regex
    // For quoted lines, we need to check without the quote prefix
    const rawText = task.rawText;
    const quoteMatch = rawText.match(/^(\s*>\s*)/);
    const quotePrefix = quoteMatch ? quoteMatch[1] : '';
    const textWithoutQuote = quotePrefix
      ? rawText.substring(quotePrefix.length)
      : rawText;
    const checkboxMatch = textWithoutQuote.match(CHECKBOX_DETECTION_REGEX);
    const isCheckbox = checkboxMatch !== null;
    // Extract current list marker character (- or * or +) and checkbox state (x for checked, space for unchecked)
    // This preserves the checkbox state when changing to archived states
    const currentListMarkerChar = checkboxMatch ? checkboxMatch[1] : '-';
    const currentCheckboxState = checkboxMatch ? checkboxMatch[2] : ' ';
    let newLine: string;

    // Get the indent without the quote prefix (task.indent already includes the quote prefix for quoted tasks)
    const indentWithoutQuote = quotePrefix
      ? task.indent.replace(/\s*>\s*$/, '')
      : task.indent;

    if (newState === '') {
      // Handle empty state - remove task keyword entirely
      if (isCheckbox) {
        // For checkboxes, keep the checkbox format but remove the task keyword
        // Use single space between checkbox and text
        const textPart = task.text ? ` ${task.text}` : '';
        newLine = `${indentWithoutQuote}${quotePrefix}${currentListMarkerChar} [ ]${textPart}`;
      } else {
        // For regular tasks, remove the task keyword entirely
        // Handle spacing properly based on whether there's a list marker
        // Note: task.listMarker already includes trailing space if present
        const textPart = task.text ? task.text : '';
        newLine = `${task.indent}${task.listMarker || ''}${textPart}`;
      }

      // Add trailing comment end characters if they were present in the original task
      if (task.tail) {
        newLine += task.tail;
      }
    } else if (isCheckbox) {
      // Generate markdown checkbox format with proper spacing
      // For archived states, preserve the existing checkbox state
      const isArchived = keywordManagerInstance.isArchived(newState);

      let checkboxStatus: string;
      if (isArchived) {
        // Preserve existing checkbox state for archived tasks
        checkboxStatus = currentCheckboxState;
      } else {
        // Get the checkbox state character for the new state
        checkboxStatus = keywordManagerInstance.getCheckboxState(
          newState,
          keywordManagerInstance.getSettings(),
        );
      }

      const textPart = task.text ? ` ${task.text}` : '';
      newLine = `${indentWithoutQuote}${quotePrefix}${currentListMarkerChar} [${checkboxStatus}] ${newState}${priorityPart}${textPart}`;
    } else {
      // Generate original format, preserving comment prefix if present
      const textPart = task.text ? ` ${task.text}` : ' ';
      // Check if this is a footnote task and include the footnote marker
      const footnoteMarker = task.footnoteMarker || '';
      newLine = `${task.indent}${footnoteMarker}${task.listMarker || ''}${newState}${priorityPart}${textPart}`;

      // Add trailing comment end characters if they were present in the original task
      if (task.tail) {
        newLine += task.tail;
      }
    }

    // Add embed reference if it exists
    if (task.embedReference) {
      // Extract the original spacing from the raw text
      // Find where the task text (plus any footnote reference) ends and the embed reference begins
      const textToSearch = task.text + (task.footnoteReference || '');
      const textEndIndex =
        task.rawText.indexOf(textToSearch) + textToSearch.length;
      const originalSpacing = task.rawText.substring(
        textEndIndex,
        task.rawText.indexOf(task.embedReference, textEndIndex),
      );
      newLine += originalSpacing + task.embedReference;
    }

    // Add footnote reference if it exists
    if (task.footnoteReference) {
      // Extract the original spacing from the raw text
      // Find where the task text ends and the footnote reference begins
      const taskTextEndIndex =
        task.rawText.indexOf(task.text) + task.text.length;
      const originalSpacing = task.rawText.substring(
        taskTextEndIndex,
        task.rawText.indexOf(task.footnoteReference, taskTextEndIndex),
      );
      newLine += originalSpacing + task.footnoteReference;
    }

    const completed = keywordManagerInstance.isCompleted(newState);
    return { newLine, completed };
  }

  /**
   * Applies the change and returns an updated, immutable snapshot of the Task.
   *
   * File Operation Strategy:
   * - For active files: Uses Editor API (editor.replaceRange) to preserve cursor position, selection, and folds
   * - For inactive files: Uses Vault.process() for atomic background operations that prevent plugin conflicts
   * - If forceVaultApi is true, uses Vault.process() even for active files to prevent focus jump
   */
  async applyLineUpdate(
    task: Task,
    newState: string,
    options: {
      keepPriority?: boolean;
      forceVaultApi?: boolean;
      recordCompletion?: boolean;
    } = {},
  ): Promise<Task> {
    const keepPriority = options.keepPriority ?? true;
    const forceVaultApi = options.forceVaultApi ?? false;
    const recordCompletion = options.recordCompletion ?? false;

    // Table tasks use vault.process for cell-level writes
    if (task.isTableTask && task.tableCell) {
      return this.applyTableCellUpdate(task, newState, {
        keepPriority,
        recordCompletion,
        forceVaultApi,
      });
    }

    const { newLine, completed } = TaskWriter.generateTaskLine(
      task,
      newState,
      keepPriority,
      this.keywordManager,
    );

    // A recordCompletion write persists the inactive state (recurring
    // roll-forward) but still stamps a CLOSED date for the completion that
    // just happened. On such a write CLOSED is added/kept, never removed.
    const shouldWriteClosed = this.shouldWriteClosed(
      newState,
      recordCompletion,
    );
    // CLOSED is only removed when a task genuinely leaves the completed state.
    // Archived tasks keep their completion record, and recurring tasks keep the
    // last-completion record across reactivations.
    const shouldRemoveClosed =
      !shouldWriteClosed &&
      !!task.closedDate &&
      !this.preservesClosed(task, newState);

    // STARTED tracking: (re)write on every genuine entry into an active state.
    // The previous timestamp is overwritten; STARTED is never removed.
    const shouldUpdateStarted = this.shouldUpdateStarted(task, newState);

    // Check if target is the active file in a MarkdownView
    // Using getActiveViewOfType() is safer than accessing workspace.activeLeaf directly
    const md = this.app.workspace.getActiveViewOfType(MarkdownView);
    const isActive = md?.file?.path === task.path;
    const editor = md?.editor;

    // Check if we're in source/edit mode (has editor) vs preview/reader mode
    // In preview mode, getViewType() returns 'markdown' but editor is undefined or null
    const isSourceMode =
      isActive &&
      editor &&
      md?.getViewType() === 'markdown' &&
      md?.getMode &&
      md.getMode() === 'source';

    // Mutable accumulators for the vault.process callback below.
    // NOTE: these MUST be declared before the callback runs (the callback
    // assigns to startedInserted); declaring them after the callback body
    // but before .process() would still be a temporal-dead-zone error.
    let lineDelta = 0;
    let updatedClosedDate = task.closedDate;
    let updatedStartedDate = task.startedDate;
    let startedInserted = false;

    const file = this.app.vault.getAbstractFileByPath(task.path);
    if (file && file instanceof TFile) {
      if (isSourceMode && !forceVaultApi) {
        // Replace only the specific line using Editor API to preserve editor state
        // This maintains cursor position, selection, and code folds for better UX
        const currentLine = editor.getLine(task.line);
        if (typeof currentLine === 'string') {
          // Save current cursor position before the update
          const cursorPosition = editor.getCursor();

          const from: EditorPosition = { line: task.line, ch: 0 };
          const to: EditorPosition = {
            line: task.line,
            ch: currentLine.length,
          };
          editor.replaceRange(newLine, from, to);

          // Special cursor positioning for tasks with empty text
          if (task.text === '') {
            // Position cursor after the space that follows the keyword
            const keywordPosition = newLine.indexOf(newState);
            if (keywordPosition !== -1) {
              const newCursorPosition = keywordPosition + newState.length + 1;
              editor.setCursor({ line: task.line, ch: newCursorPosition });
            }
          } else if (cursorPosition.line === task.line) {
            // If cursor was on the same line, position it after the new keyword
            // Find where the new keyword starts in the new line
            const keywordPosition = newLine.indexOf(newState);
            if (keywordPosition !== -1) {
              const newCursorPosition = keywordPosition + newState.length;
              editor.setCursor({ line: task.line, ch: newCursorPosition });
            }
          }
        }
      } else {
        // Not in source mode (preview/reader mode) or not active or forceVaultApi: use atomic background edit
        // Include CLOSED date handling atomically in the same operation for consistency
        const dateStr = shouldWriteClosed
          ? DateUtils.formatClosedDate(new Date())
          : null;

        await this.app.vault.process(file, (data) => {
          const lines = data.split('\n');
          if (task.line < lines.length) {
            lines[task.line] = newLine;
          }

          // Handle CLOSED date atomically using helper
          if (dateStr !== null) {
            this.updateOrInsertDateLine(
              lines,
              task.line,
              'CLOSED',
              dateStr,
              task,
            );
          } else if (shouldRemoveClosed) {
            this.removeDateLine(lines, task.line, 'CLOSED', task);
          }

          // Handle STARTED date atomically (entry into an active state).
          // updateOrInsertDateLine overwrites an existing STARTED line with the
          // new restart timestamp; it is never removed.
          if (shouldUpdateStarted) {
            const startedDateStr = DateUtils.formatStartedDate(new Date());
            const startedResult = this.updateOrInsertDateLine(
              lines,
              task.line,
              'STARTED',
              startedDateStr,
              task,
            );
            startedInserted = startedResult.lineDelta > 0;
          }

          return lines.join('\n');
        });
      }
    }

    // For source mode, handle CLOSED date separately via individual Editor API calls
    // The main editor.replaceRange above only replaces a single line, so CLOSED date
    // insertion/removal requires its own editor operations
    // Line delta and date accumulators were declared above (before vault.process)
    if (isSourceMode && !forceVaultApi) {
      if (shouldWriteClosed) {
        const closedResult = await this.updateTaskClosedDate(
          task,
          new Date(),
          false,
        );
        lineDelta += closedResult.lineDelta;
        updatedClosedDate = closedResult.task.closedDate;
      } else if (shouldRemoveClosed) {
        const closedResult = await this.removeTaskClosedDate(task, false);
        lineDelta += closedResult.lineDelta;
        updatedClosedDate = closedResult.task.closedDate;
      }

      // STARTED: (re)write via Editor API on entry into an active state.
      // updateTaskStartedDate overwrites an existing STARTED line; there is NO
      // removal branch — STARTED is never removed.
      if (shouldUpdateStarted) {
        const startedResult = await this.updateTaskStartedDate(
          task,
          new Date(),
          false,
        );
        lineDelta += startedResult.lineDelta;
        updatedStartedDate = startedResult.task.startedDate;
      }
    } else if (!isSourceMode || forceVaultApi) {
      // For non-source mode, CLOSED date was handled atomically above
      if (shouldWriteClosed) {
        lineDelta = task.closedDate ? 0 : 1;
        updatedClosedDate = new Date();
      } else if (shouldRemoveClosed) {
        lineDelta = -1;
        updatedClosedDate = null;
      }

      // STARTED was handled atomically above; account for the inserted line
      // (an overwrite leaves the line count unchanged).
      if (shouldUpdateStarted) {
        lineDelta += startedInserted ? 1 : 0;
        updatedStartedDate = new Date();
      }
    }

    // Return an updated Task snapshot (do not mutate original)
    // Include lineDelta for the coordinator to adjust subsequent task indices
    const result: Task & { lineDelta?: number } = {
      ...task,
      rawText: newLine,
      state: newState,
      completed,
      closedDate: updatedClosedDate,
      startedDate: updatedStartedDate,
    };
    if (lineDelta !== 0) {
      result.lineDelta = lineDelta;
    }
    return result;
  }

  /**
   * Update a table cell task's state via vault.process().
   * Extracts just the keyword+text part from generateTaskLine() output
   * and replaces the cell content in the table row.
   */
  private isTableCellDateUpdate(task: Task): boolean {
    return !!(task.isTableTask && task.tableCell);
  }

  private async modifyTableCell(
    task: Task,
    mutate: (cellContent: string) => string,
    forceVaultApi = false,
  ): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(task.path);
    if (!(file instanceof TFile)) return;

    const mutateLine = (line: string): string | null => {
      const cells = line.split('|');
      let start = 0;
      if (cells.length > 0 && cells[0].trim() === '') start = 1;
      const idx = start + task.tableCell!.cellIndex;
      if (idx >= cells.length) return null;
      const origCell = cells[idx].trim();
      const newCell = mutate(origCell);
      cells[idx] = ` ${newCell} `;
      return cells.join('|');
    };

    // If the file is open in the active source-mode editor, update the buffer
    // directly via the Editor API. This mirrors applyLineUpdate's checkbox path
    // and avoids Obsidian's vault.process merge corrupting the table row.
    const md = this.app.workspace.getActiveViewOfType(MarkdownView);
    const isActive = md?.file?.path === task.path;
    const editor = md?.editor;
    const isSourceMode =
      !forceVaultApi &&
      isActive &&
      !!editor &&
      md?.getViewType() === 'markdown' &&
      !!md?.getMode &&
      md.getMode() === 'source';

    if (isSourceMode) {
      const line = editor.getLine(task.line);
      if (typeof line !== 'string') return;
      const newLine = mutateLine(line);
      if (newLine === null) return;
      editor.replaceRange(
        newLine,
        { line: task.line, ch: 0 },
        { line: task.line, ch: line.length },
      );
      return;
    }

    await this.app.vault.process(file, (data) => {
      const lines = data.split('\n');
      if (task.line >= lines.length) return data;
      const newLine = mutateLine(lines[task.line]);
      if (newLine === null) return data;
      lines[task.line] = newLine;
      return lines.join('\n');
    });
  }

  private async applyTableCellUpdate(
    task: Task,
    newState: string,
    options: {
      keepPriority?: boolean;
      recordCompletion?: boolean;
      forceVaultApi?: boolean;
    } = {},
  ): Promise<Task> {
    const keepPriority = options.keepPriority ?? true;
    const recordCompletion = options.recordCompletion ?? false;
    const forceVaultApi = options.forceVaultApi ?? false;

    const { newLine, completed } = TaskWriter.generateTaskLine(
      task,
      newState,
      keepPriority,
      this.keywordManager,
    );

    const shouldWriteClosed = this.shouldWriteClosed(
      newState,
      recordCompletion,
    );
    // Archived tasks and recurring tasks keep their completion record.
    const shouldRemoveClosed =
      !shouldWriteClosed && !this.preservesClosed(task, newState);

    // Extract just the keyword + text part (strip indent + listMarker)
    let cellContent = newLine;
    if (cellContent.startsWith(task.indent)) {
      cellContent = cellContent.slice(task.indent.length);
    }
    if (cellContent.startsWith(task.listMarker)) {
      cellContent = cellContent.slice(task.listMarker.length);
    }
    cellContent = cellContent.trim();

    const shouldUpdateStarted = this.shouldUpdateStarted(task, newState);

    let fullCellContent = cellContent;
    await this.modifyTableCell(
      task,
      (origCell) => {
        const brIdx = origCell.indexOf('<br');
        let dateSuffix = brIdx >= 0 ? origCell.substring(brIdx) : '';

        // Add or update CLOSED date when trackClosedDate is enabled
        if (shouldWriteClosed) {
          // CLOSED dates in cells use [[...]] wikilink format.
          // Support both old [date] and new [[date]] formats for migration
          const closedPattern =
            /\s*<br\s*\/?>\s*CLOSED:\s*\[{1,2}[^\]]+\]{1,2}/i;
          const closedTag = `<br>CLOSED: ${TaskWriter.formatTableCellTimestamp(new Date())}`;
          if (closedPattern.test(dateSuffix)) {
            dateSuffix = dateSuffix.replace(closedPattern, closedTag);
          } else {
            dateSuffix = `${dateSuffix}${closedTag}`;
          }
        } else if (shouldRemoveClosed) {
          // Remove CLOSED date when un-completing, regardless of whether
          // task.closedDate is set. For table cells, task.closedDate is
          // parsed only from the first <br> segment (before the CLOSED tag),
          // so it is always null even when the cell has a CLOSED date.
          // Support both old [date] and new [[date]] formats for migration
          dateSuffix = dateSuffix.replace(
            /\s*<br\s*\/?>\s*CLOSED:\s*\[{1,2}[^\]]+\]{1,2}/i,
            '',
          );
        }

        // STARTED: (re)written on every entry into an active state. Table cells
        // mirror the [[...]] timestamp format used for CLOSED.
        if (shouldUpdateStarted) {
          const startedPattern =
            /\s*<br\s*\/?>\s*STARTED:\s*\[{1,2}[^\]]+\]{1,2}/i;
          const startedTag = `<br>STARTED: ${TaskWriter.formatTableCellTimestamp(new Date())}`;
          if (startedPattern.test(dateSuffix)) {
            dateSuffix = dateSuffix.replace(startedPattern, startedTag);
          } else {
            dateSuffix = `${dateSuffix}${startedTag}`;
          }
        }

        fullCellContent = `${cellContent}${dateSuffix}`;
        return fullCellContent;
      },
      forceVaultApi,
    );

    let closedDate = task.closedDate;
    if (shouldWriteClosed) closedDate = new Date();
    else if (shouldRemoveClosed) closedDate = null;

    return {
      ...task,
      rawText: fullCellContent,
      state: newState,
      completed,
      closedDate,
      startedDate: shouldUpdateStarted ? new Date() : task.startedDate,
    };
  }

  /**
   * Replace cell content while preserving inline date lines.
   * Used by priority and other non-state updates on table tasks.
   */
  private async applyTableCellContent(
    task: Task,
    cellContent: string,
    extraUpdates: Partial<Task>,
    forceVaultApi = false,
  ): Promise<Task> {
    await this.modifyTableCell(
      task,
      (origCell) => {
        const brIdx = origCell.indexOf('<br');
        const dateSuffix = brIdx >= 0 ? origCell.substring(brIdx) : '';
        return `${cellContent}${dateSuffix}`;
      },
      forceVaultApi,
    );

    return { ...task, rawText: cellContent, ...extraUpdates };
  }

  /**
   * Update a SCHEDULED/DEADLINE date inside a table cell.
   * Dates are stored inline as <br>SCHEDULED: <date> within the cell.
   */
  private async applyTableCellDateUpdate(
    task: Task,
    newDate: Date,
    dateType: 'SCHEDULED' | 'DEADLINE',
    repeat?: DateRepeatInfo | null,
    warningPeriod?: WarningPeriodInfo | null,
    forceVaultApi = false,
  ): Promise<Task & { lineDelta?: number }> {
    const dateStr = TaskWriter.buildDateLineContent(
      newDate,
      repeat,
      warningPeriod,
    );

    await this.modifyTableCell(
      task,
      (cell) => {
        const dateTag = `${dateType}: ${dateStr}`;
        const existing = new RegExp(
          `<br\\s*/?>\\s*${dateType}:\\s*<[^>]+>`,
          'i',
        );
        return existing.test(cell)
          ? cell.replace(existing, `<br>${dateTag}`)
          : `${cell}<br>${dateTag}`;
      },
      forceVaultApi,
    );

    const result: Task & { lineDelta?: number } = {
      ...task,
      ...(dateType === 'SCHEDULED'
        ? {
            scheduledDate: newDate,
            scheduledDateRepeat: repeat ?? null,
            scheduledWarningPeriod: warningPeriod ?? null,
          }
        : {
            deadlineDate: newDate,
            deadlineDateRepeat: repeat ?? null,
            deadlineWarningPeriod: warningPeriod ?? null,
          }),
    };
    return result;
  }

  /**
   * Remove a date (SCHEDULED or DEADLINE) from a table cell.
   * Strips the <br>DATE_TYPE: <date> from the cell content.
   */
  private async removeTableCellDate(
    task: Task,
    dateType: 'SCHEDULED' | 'DEADLINE' | 'CLOSED',
    forceVaultApi = false,
  ): Promise<Task & { lineDelta?: number }> {
    await this.modifyTableCell(
      task,
      (cell) => {
        if (dateType === 'CLOSED') {
          // CLOSED dates use [[date]] wikilink format in table cells
          const datePattern = new RegExp(
            `\\s*<br\\s*/?>\\s*${dateType}:\\s*(?:\\[\\[[^\\]]+\\]\\]|\\[[^\\]]+\\])`,
            'i',
          );
          return cell.replace(datePattern, '');
        }
        // SCHEDULED and DEADLINE use <date> format
        const datePattern = new RegExp(
          `\\s*<br\\s*/?>\\s*${dateType}:\\s*<[^>]+>`,
          'i',
        );
        return cell.replace(datePattern, '');
      },
      forceVaultApi,
    );

    const result: Task & { lineDelta?: number } = {
      ...task,
      ...(dateType === 'SCHEDULED'
        ? { scheduledDate: null }
        : dateType === 'DEADLINE'
          ? { deadlineDate: null }
          : { closedDate: null }),
    };
    return result;
  }

  // Cycles a task to its next state using TaskStateTransitionManager and persists change
  async updateTaskState(
    task: Task,
    nextState: string | null = null,
    options: { forceVaultApi?: boolean; recordCompletion?: boolean } = {},
  ): Promise<Task> {
    let state: string;
    if (nextState == null) {
      const stateManager = getStateTransitionManager(
        this.plugin.taskUpdateCoordinator,
        this.keywordManager,
        this.settings?.stateTransitions,
      );
      state = stateManager.getNextState(task.state);
    } else {
      state = nextState;
    }
    return await this.applyLineUpdate(task, state, options);
  }

  // Cycles a task to its next state using TaskStateTransitionManager.getCycleState() and persists change
  async updateTaskCycleState(
    task: Task,
    nextState: string | null = null,
    options: { forceVaultApi?: boolean } = {},
  ): Promise<Task> {
    let state: string;
    if (nextState == null) {
      const stateManager = getStateTransitionManager(
        this.plugin.taskUpdateCoordinator,
        this.keywordManager,
        this.settings?.stateTransitions,
      );
      state = stateManager.getCycleState(task.state);
    } else {
      state = nextState;
    }
    return await this.applyLineUpdate(task, state, options);
  }

  // Updates task priority and persists change
  async updateTaskPriority(
    task: Task,
    newPriority: 'high' | 'med' | 'low',
    options: { forceVaultApi?: boolean } = {},
  ): Promise<Task> {
    // Table tasks: update cell content only
    if (task.isTableTask && task.tableCell) {
      const priorityToken =
        newPriority === 'high'
          ? '[#A]'
          : newPriority === 'med'
            ? '[#B]'
            : '[#C]';
      const text = task.text ? ` ${task.text}` : '';
      const cellContent = `${task.state} ${priorityToken}${text}`;
      return this.applyTableCellContent(
        task,
        cellContent,
        {
          priority: newPriority,
        },
        options.forceVaultApi ?? false,
      );
    }

    // Generate priority token
    const priorityToken =
      newPriority === 'high' ? '[#A]' : newPriority === 'med' ? '[#B]' : '[#C]';

    // Reconstruct task line from task attributes
    // This preserves indent by using task.indent directly
    const indent = task.indent;
    const listMarker = task.listMarker || '';
    const state = task.state;
    const text = task.text ? ` ${task.text}` : '';

    // For checkbox tasks, ensure a space after the list marker
    // The listMarker may or may not include trailing whitespace depending on regex capture
    const isCheckboxTask = listMarker.includes('[');
    const listMarkerWithSpace =
      isCheckboxTask && !listMarker.endsWith(' ')
        ? `${listMarker} `
        : listMarker;

    // Preserve embed and footnote references if they exist
    // Embed reference comes before the text, footnote reference comes after the text
    const footnoteMarker = task.footnoteMarker || '';
    const embedReference = task.embedReference || '';
    const footnoteReference = task.footnoteReference || '';
    const newTaskLine = `${indent}${footnoteMarker}${listMarkerWithSpace}${state} ${priorityToken}${embedReference}${text}${footnoteReference}`;

    const file = this.app.vault.getAbstractFileByPath(task.path);
    if (!file || !(file instanceof TFile)) {
      return {
        ...task,
        rawText: newTaskLine,
        priority: newPriority,
      };
    }

    const forceVaultApi = options.forceVaultApi ?? false;
    const md = this.app.workspace.getActiveViewOfType(MarkdownView);
    const isActive = md?.file?.path === task.path;
    const editor = md?.editor;

    const isSourceMode =
      !forceVaultApi &&
      isActive &&
      editor &&
      md?.getViewType() === 'markdown' &&
      md?.getMode &&
      md.getMode() === 'source';

    if (isSourceMode) {
      const currentLine = editor.getLine(task.line);
      if (typeof currentLine === 'string') {
        const from: EditorPosition = { line: task.line, ch: 0 };
        const to: EditorPosition = {
          line: task.line,
          ch: currentLine.length,
        };
        editor.replaceRange(newTaskLine, from, to);
      }
      return {
        ...task,
        rawText: newTaskLine,
        priority: newPriority,
      };
    }

    await this.app.vault.process(file, (data) => {
      const lines = data.split('\n');
      if (task.line < lines.length) {
        lines[task.line] = newTaskLine;
      }
      return lines.join('\n');
    });

    // Return an updated Task snapshot (do not mutate original)
    return {
      ...task,
      rawText: newTaskLine,
      priority: newPriority,
    };
  }

  /**
   * Removes the priority token from a task and persists the change.
   * If the task has no priority, returns the task unchanged without writing.
   */
  async removeTaskPriority(
    task: Task,
    options: { forceVaultApi?: boolean } = {},
  ): Promise<Task> {
    if (!task.priority) {
      return { ...task };
    }

    // Table tasks: update cell content only
    if (task.isTableTask && task.tableCell) {
      const text = task.text ? ` ${task.text}` : '';
      const cellContent = `${task.state}${text}`;
      return this.applyTableCellContent(
        task,
        cellContent,
        { priority: null },
        options.forceVaultApi ?? false,
      );
    }

    // Reconstruct task line from task attributes (without priority)
    // This preserves indent by using task.indent directly
    const indent = task.indent;
    const listMarker = task.listMarker || '';
    const state = task.state;
    const text = task.text ? ` ${task.text}` : '';

    // For checkbox tasks, add a space after the list marker
    // The listMarker for checkboxes is "- [ ]" but format requires "- [ ] "
    // Check for '[' instead of '-[' to avoid footnote issues
    const isCheckboxTask = listMarker.includes('[');
    const listMarkerWithSpace = isCheckboxTask ? `${listMarker} ` : listMarker;

    // Preserve embed and footnote references if they exist
    // Embed reference comes before the text, footnote reference comes after the text
    const footnoteMarker = task.footnoteMarker || '';
    const embedReference = task.embedReference || '';
    const footnoteReference = task.footnoteReference || '';
    const newTaskLine = `${indent}${footnoteMarker}${listMarkerWithSpace}${state}${embedReference}${text}${footnoteReference}`;

    await this.writeLineToFile(task, newTaskLine, options);

    return {
      ...task,
      rawText: newTaskLine,
      priority: null,
    };
  }

  /**
   * Updates or adds a SCHEDULED date line below the task.
   * If a SCHEDULED line already exists, it is updated in place.
   * If no SCHEDULED line exists, a new one is inserted after the task line.
   * Returns the updated task with lineDelta for the coordinator to adjust subsequent task indices.
   */
  async updateTaskScheduledDate(
    task: Task,
    newDate: Date,
    repeat?: DateRepeatInfo | null,
    warningPeriod?: WarningPeriodInfo | null,
    options: { forceVaultApi?: boolean } = {},
  ): Promise<Task & { lineDelta?: number }> {
    // Table tasks store dates inline with <br> separators
    if (this.isTableCellDateUpdate(task)) {
      return this.applyTableCellDateUpdate(
        task,
        newDate,
        'SCHEDULED',
        repeat,
        warningPeriod,
        options.forceVaultApi ?? false,
      );
    }

    const dateStr = TaskWriter.buildDateLineContent(
      newDate,
      repeat,
      warningPeriod,
    );
    let lineDelta = 0;

    const file = this.app.vault.getAbstractFileByPath(task.path);
    if (file && file instanceof TFile) {
      const editor = this.getEditorForTask(
        task,
        options.forceVaultApi ?? false,
      );

      if (editor) {
        const taskIndent = getTaskIndent(task);
        lineDelta = this.updateDateLineInEditor(
          editor,
          task,
          'SCHEDULED',
          dateStr,
          taskIndent,
        );
      } else {
        await this.app.vault.process(file, (data) => {
          const lines = data.split('\n');
          const result = this.updateOrInsertDateLine(
            lines,
            task.line,
            'SCHEDULED',
            dateStr,
            task,
          );
          lineDelta = result.lineDelta;
          return lines.join('\n');
        });
      }
    }

    const result: Task & { lineDelta?: number } = {
      ...task,
      scheduledDate: newDate,
      scheduledDateRepeat: repeat ?? null,
      scheduledWarningPeriod: warningPeriod ?? null,
    };
    if (lineDelta !== 0) {
      result.lineDelta = lineDelta;
    }
    return result;
  }

  /**
   * Removes the SCHEDULED date line below the task.
   * If no SCHEDULED line exists in the file, returns the task unchanged.
   * Note: This method attempts to remove the SCHEDULED line regardless of whether
   * the task.scheduledDate property is set, as there may be a discrepancy between
   * the parsed property and what exists in the file.
   * Returns the updated task with lineDelta (only included when non-zero) for the coordinator
   * to adjust subsequent task indices.
   */
  async removeTaskScheduledDate(
    task: Task,
    options: { forceVaultApi?: boolean } = {},
  ): Promise<Task & { lineDelta?: number }> {
    // Table tasks store dates inline — strip from cell
    if (this.isTableCellDateUpdate(task)) {
      return this.removeTableCellDate(
        task,
        'SCHEDULED',
        options.forceVaultApi ?? false,
      );
    }

    let lineDelta = 0;

    const file = this.app.vault.getAbstractFileByPath(task.path);
    if (file && file instanceof TFile) {
      const editor = this.getEditorForTask(
        task,
        options.forceVaultApi ?? false,
      );

      if (editor) {
        const taskIndent = getTaskIndent(task);
        lineDelta = this.updateDateLineInEditor(
          editor,
          task,
          'SCHEDULED',
          null,
          taskIndent,
        );
      } else {
        await this.app.vault.process(file, (data) => {
          const lines = data.split('\n');
          const result = this.removeDateLine(
            lines,
            task.line,
            'SCHEDULED',
            task,
          );
          lineDelta = result.lineDelta;
          return lines.join('\n');
        });
      }
    }

    const result: Task & { lineDelta?: number } = {
      ...task,
      scheduledDate: null,
    };
    if (lineDelta !== 0) {
      result.lineDelta = lineDelta;
    }
    return result;
  }

  /**
   * Updates or adds a DEADLINE date line below the task.
   * If a DEADLINE line already exists, it is updated in place.
   * If no DEADLINE line exists, a new one is inserted after the task line (or after the
   * SCHEDULED line if one exists).
   * Returns the updated task with lineDelta (only included when non-zero) for the coordinator
   * to adjust subsequent task indices.
   */
  async updateTaskDeadlineDate(
    task: Task,
    newDate: Date,
    repeat?: DateRepeatInfo | null,
    warningPeriod?: WarningPeriodInfo | null,
    options: { forceVaultApi?: boolean } = {},
  ): Promise<Task & { lineDelta?: number }> {
    // Table tasks store dates inline with <br> separators
    if (this.isTableCellDateUpdate(task)) {
      return this.applyTableCellDateUpdate(
        task,
        newDate,
        'DEADLINE',
        repeat,
        warningPeriod,
        options.forceVaultApi ?? false,
      );
    }

    const dateStr = TaskWriter.buildDateLineContent(
      newDate,
      repeat,
      warningPeriod,
    );
    let lineDelta = 0;

    const file = this.app.vault.getAbstractFileByPath(task.path);
    if (file && file instanceof TFile) {
      const editor = this.getEditorForTask(
        task,
        options.forceVaultApi ?? false,
      );

      if (editor) {
        const taskIndent = getTaskIndent(task);
        lineDelta = this.updateDateLineInEditor(
          editor,
          task,
          'DEADLINE',
          dateStr,
          taskIndent,
        );
      } else {
        await this.app.vault.process(file, (data) => {
          const lines = data.split('\n');
          const result = this.updateOrInsertDateLine(
            lines,
            task.line,
            'DEADLINE',
            dateStr,
            task,
          );
          lineDelta = result.lineDelta;
          return lines.join('\n');
        });
      }
    }

    const result: Task & { lineDelta?: number } = {
      ...task,
      deadlineDate: newDate,
      deadlineDateRepeat: repeat ?? null,
      deadlineWarningPeriod: warningPeriod ?? null,
    };
    if (lineDelta !== 0) {
      result.lineDelta = lineDelta;
    }
    return result;
  }

  /**
   * Removes the DEADLINE date line below the task.
   * If no DEADLINE line exists in the file, returns the task unchanged.
   * Note: This method attempts to remove the DEADLINE line regardless of whether
   * the task.deadlineDate property is set, as there may be a discrepancy between
   * the parsed property and what exists in the file.
   * Returns the updated task with lineDelta (only included when non-zero) for the coordinator
   * to adjust subsequent task indices.
   */
  async removeTaskDeadlineDate(
    task: Task,
    options: { forceVaultApi?: boolean } = {},
  ): Promise<Task & { lineDelta?: number }> {
    // Table tasks store dates inline — strip from cell
    if (this.isTableCellDateUpdate(task)) {
      return this.removeTableCellDate(
        task,
        'DEADLINE',
        options.forceVaultApi ?? false,
      );
    }

    let lineDelta = 0;

    const file = this.app.vault.getAbstractFileByPath(task.path);
    if (file && file instanceof TFile) {
      const editor = this.getEditorForTask(
        task,
        options.forceVaultApi ?? false,
      );

      if (editor) {
        const taskIndent = getTaskIndent(task);
        lineDelta = this.updateDateLineInEditor(
          editor,
          task,
          'DEADLINE',
          null,
          taskIndent,
        );
      } else {
        await this.app.vault.process(file, (data) => {
          const lines = data.split('\n');
          const result = this.removeDateLine(
            lines,
            task.line,
            'DEADLINE',
            task,
          );
          lineDelta = result.lineDelta;
          return lines.join('\n');
        });
      }
    }

    const result: Task & { lineDelta?: number } = {
      ...task,
      deadlineDate: null,
    };
    if (lineDelta !== 0) {
      result.lineDelta = lineDelta;
    }
    return result;
  }

  /**
   * Resolve the list prefix for a task line:
   * - `checkbox` → `- [ ] ` / `- [x] ` (state-aware)
   * - `bullet`   → `- `
   * - `none`     → `` (keyword-only task)
   */
  private static resolveListMarkerPrefix(
    state: string,
    marker: TaskListMarkerStyle | undefined,
    keywordManager: KeywordManager,
  ): string {
    switch (marker ?? 'checkbox') {
      case 'bullet':
        return '- ';
      case 'none':
        return '';
      case 'checkbox':
      default: {
        const checkboxState = keywordManager.getCheckboxState(
          state,
          keywordManager.getSettings(),
        );
        return `- [${checkboxState}] `;
      }
    }
  }

  /**
   * Build a brand-new task line. `fields.listMarker` selects the prefix
   * (checkbox, bullet, or none); it defaults to checkbox.
   * Used by the task editor modal when creating a task.
   */
  static buildNewTaskLine(
    fields: Pick<
      TaskComposeFields,
      'text' | 'state' | 'priority' | 'listMarker'
    >,
    keywordManager: KeywordManager,
  ): string {
    const priorityPart =
      fields.priority === 'high'
        ? ' [#A]'
        : fields.priority === 'med'
          ? ' [#B]'
          : fields.priority === 'low'
            ? ' [#C]'
            : '';
    const textPart = fields.text ? ` ${fields.text}` : '';
    const prefix = TaskWriter.resolveListMarkerPrefix(
      fields.state,
      fields.listMarker,
      keywordManager,
    );
    return `${prefix}${fields.state}${priorityPart}${textPart}`;
  }

  /**
   * Create a new task at the given line in the given file.
   *
   * If the target line is blank, the task block replaces it. Otherwise the
   * block is inserted at the line, pushing existing content down — unless
   * `replaceExistingLine` is set, in which case the plain text line is
   * replaced by the block (used when the editor prefilled the task text from
   * the cursor line). The task block includes the task line followed by
   * DESCRIPTION/SCHEDULED/DEADLINE metadata lines.
   */
  async createTaskAtLine(
    path: string,
    line: number,
    fields: TaskComposeFields,
    options: {
      recordCompletion?: boolean;
      replaceExistingLine?: boolean;
    } = {},
  ): Promise<TaskComposeResult | null> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      return null;
    }

    const block = this.buildNewTaskBlock(
      fields,
      options.recordCompletion ?? false,
    );
    const replaceExistingLine = options.replaceExistingLine ?? false;
    const editor = this.getSourceModeEditorForPath(path);
    let lineDelta: number;

    if (editor) {
      const currentLine = editor.getLine(line) ?? '';
      const replacingLine = replaceExistingLine || currentLine.trim() === '';
      const from: EditorPosition = { line, ch: 0 };
      if (replacingLine) {
        editor.replaceRange(block.join('\n'), from, {
          line,
          ch: currentLine.length,
        });
      } else {
        editor.replaceRange(`${block.join('\n')}\n`, from, from);
      }
      // Replacing a single line consumes one line; inserting adds them all.
      lineDelta = replacingLine ? block.length - 1 : block.length;
    } else {
      lineDelta = 0;
      await this.app.vault.process(file, (data) => {
        const lines = data.split('\n');
        const index = Math.max(0, Math.min(line, lines.length));
        const replacingLine =
          replaceExistingLine ||
          (lines[index] !== undefined && lines[index].trim() === '');
        if (replacingLine) {
          lines.splice(index, 1, ...block);
        } else {
          lines.splice(index, 0, ...block);
        }
        lineDelta = replacingLine ? block.length - 1 : block.length;
        return lines.join('\n');
      });
    }

    return {
      task: this.buildComposedTask(
        path,
        line,
        fields,
        block[0],
        options.recordCompletion ?? false,
      ),
      lineDelta,
    };
  }

  /**
   * Update an existing task from the task editor modal.
   *
   * The task line (text/state/priority) is written first via the standard
   * update pipeline so CLOSED/STARTED tracking is preserved, then the
   * DESCRIPTION and date lines are reconciled. All writes happen below the
   * task line, so the task's own line index remains stable throughout.
   */
  async updateTaskFields(
    task: Task,
    fields: TaskComposeFields,
    options: { recordCompletion?: boolean } = {},
  ): Promise<TaskComposeResult | null> {
    const file = this.app.vault.getAbstractFileByPath(task.path);
    if (!(file instanceof TFile)) {
      return null;
    }

    const description = fields.description?.trim()
      ? fields.description.trim()
      : null;
    const updatedTask: Task = {
      ...task,
      text: fields.text,
      priority: fields.priority,
    };

    let lineDelta = 0;

    // Task line + state (handles CLOSED/STARTED via the existing pipeline).
    // recordCompletion stamps a CLOSED date even when writing an inactive
    // state (recurring roll-forward).
    const afterState = await this.applyLineUpdate(updatedTask, fields.state, {
      recordCompletion: options.recordCompletion ?? false,
    });

    // DESCRIPTION (always directly below the task line).
    // Table tasks store everything inline in the cell, so a separate
    // DESCRIPTION line would corrupt the table.
    if (!afterState.isTableTask) {
      lineDelta += await this.setTaskDescription(afterState, description);
    }

    // SCHEDULED
    if (fields.scheduledDate) {
      const result = await this.updateTaskScheduledDate(
        afterState,
        fields.scheduledDate,
        fields.scheduledRepeat,
        fields.scheduledWarningPeriod,
      );
      lineDelta += result.lineDelta ?? 0;
    } else if (afterState.scheduledDate) {
      const result = await this.removeTaskScheduledDate(afterState);
      lineDelta += result.lineDelta ?? 0;
    }

    // DEADLINE
    if (fields.deadlineDate) {
      const result = await this.updateTaskDeadlineDate(
        afterState,
        fields.deadlineDate,
        fields.deadlineRepeat,
        fields.deadlineWarningPeriod,
      );
      lineDelta += result.lineDelta ?? 0;
    } else if (afterState.deadlineDate) {
      const result = await this.removeTaskDeadlineDate(afterState);
      lineDelta += result.lineDelta ?? 0;
    }

    const updated: Task = {
      ...afterState,
      text: fields.text,
      priority: fields.priority,
      description: description ?? undefined,
      scheduledDate: fields.scheduledDate,
      scheduledDateRepeat: fields.scheduledRepeat,
      scheduledWarningPeriod: fields.scheduledWarningPeriod,
      deadlineDate: fields.deadlineDate,
      deadlineDateRepeat: fields.deadlineRepeat,
      deadlineWarningPeriod: fields.deadlineWarningPeriod,
      completed: this.keywordManager.isCompleted(fields.state),
    };

    return { task: updated, lineDelta };
  }

  /**
   * Build the full line block for a new task: task line, DESCRIPTION,
   * STARTED, SCHEDULED, DEADLINE, and CLOSED (in that order).
   */
  private buildNewTaskBlock(
    fields: TaskComposeFields,
    recordCompletion = false,
  ): string[] {
    const taskLine = TaskWriter.buildNewTaskLine(fields, this.keywordManager);
    const synthetic = this.buildComposedTask(
      '',
      0,
      fields,
      taskLine,
      recordCompletion,
    );
    const indent = getDateLineIndent(synthetic);
    const lines = [taskLine];

    const description = fields.description?.trim();
    if (description) {
      lines.push(`${indent}DESCRIPTION: ${description}`);
    }
    // CREATED is written once, first among the date lines, when the task is
    // created (never updated afterwards).
    if (this.shouldWriteCreated()) {
      lines.push(
        `${indent}CREATED: ${DateUtils.formatCreatedDate(new Date())}`,
      );
    }
    // STARTED is written first among the remaining date lines (before
    // SCHEDULED/DEADLINE/CLOSED) when the task is created already active.
    if (this.shouldWriteStarted(fields.state)) {
      lines.push(
        `${indent}STARTED: ${DateUtils.formatStartedDate(new Date())}`,
      );
    }
    if (fields.scheduledDate) {
      lines.push(
        `${indent}SCHEDULED: ${TaskWriter.buildDateLineContent(
          fields.scheduledDate,
          fields.scheduledRepeat,
          fields.scheduledWarningPeriod,
        )}`,
      );
    }
    if (fields.deadlineDate) {
      lines.push(
        `${indent}DEADLINE: ${TaskWriter.buildDateLineContent(
          fields.deadlineDate,
          fields.deadlineRepeat,
          fields.deadlineWarningPeriod,
        )}`,
      );
    }
    if (this.shouldWriteClosed(fields.state, recordCompletion)) {
      lines.push(`${indent}CLOSED: ${DateUtils.formatClosedDate(new Date())}`);
    }
    return lines;
  }

  /**
   * Build an immutable Task snapshot for a newly composed task.
   */
  private buildComposedTask(
    path: string,
    line: number,
    fields: TaskComposeFields,
    rawText: string,
    recordCompletion = false,
  ): Task {
    const shouldWriteClosed = this.shouldWriteClosed(
      fields.state,
      recordCompletion,
    );
    const shouldWriteStarted = this.shouldWriteStarted(fields.state);
    return {
      path,
      line,
      rawText,
      indent: '',
      listMarker: TaskWriter.resolveListMarkerPrefix(
        fields.state,
        fields.listMarker,
        this.keywordManager,
      ),
      text: fields.text,
      description: fields.description?.trim() || undefined,
      state: fields.state,
      completed: this.keywordManager.isCompleted(fields.state),
      priority: fields.priority,
      scheduledDate: fields.scheduledDate,
      scheduledDateRepeat: fields.scheduledRepeat,
      deadlineDate: fields.deadlineDate,
      deadlineDateRepeat: fields.deadlineRepeat,
      closedDate: shouldWriteClosed ? new Date() : null,
      startedDate: shouldWriteStarted ? new Date() : null,
      createdDate: this.shouldWriteCreated() ? new Date() : null,
      scheduledWarningPeriod: fields.scheduledWarningPeriod,
      deadlineWarningPeriod: fields.deadlineWarningPeriod,
      urgency: null,
      isDailyNote: false,
      dailyNoteDate: null,
      subtaskCount: 0,
      subtaskCompletedCount: 0,
    };
  }

  /**
   * Insert, update, or remove the DESCRIPTION line for a task.
   * Returns the line delta (+1 insert, -1 remove, 0 update/no-op).
   */
  private async setTaskDescription(
    task: Task,
    description: string | null,
  ): Promise<number> {
    const file = this.app.vault.getAbstractFileByPath(task.path);
    if (!(file instanceof TFile)) {
      return 0;
    }

    const editor = this.getSourceModeEditorForPath(task.path);
    if (editor) {
      return this.setDescriptionInEditor(editor, task, description);
    }

    let lineDelta = 0;
    await this.app.vault.process(file, (data) => {
      const lines = data.split('\n');
      lineDelta = this.updateOrInsertDescriptionLine(
        lines,
        task.line,
        description,
        task,
      ).lineDelta;
      return lines.join('\n');
    });
    return lineDelta;
  }

  private setDescriptionInEditor(
    editor: Editor,
    task: Task,
    description: string | null,
  ): number {
    const taskIndent = getTaskIndent(task);
    // Scan only the task block instead of materialising the whole buffer.
    const existingIdx = findDescriptionLineIn(
      (i) => editor.getLine(i),
      editor.lineCount(),
      task.line + 1,
      taskIndent,
    );
    const indent =
      existingIdx >= 0
        ? this.getExistingDateLineIndent(editor.getLine(existingIdx))
        : getDateLineIndent(task);

    if (description === null) {
      if (existingIdx >= 0) {
        editor.replaceRange(
          '',
          { line: existingIdx, ch: 0 },
          { line: existingIdx + 1, ch: 0 },
        );
        return -1;
      }
      return 0;
    }

    const descLine = `${indent}DESCRIPTION: ${description}`;
    if (existingIdx >= 0) {
      editor.replaceRange(
        descLine,
        { line: existingIdx, ch: 0 },
        { line: existingIdx, ch: editor.getLine(existingIdx).length },
      );
      return 0;
    }

    const insertIdx = task.line + 1;
    editor.replaceRange(
      `${this.leadingNewlineForInsert(editor, insertIdx)}${descLine}\n`,
      { line: insertIdx, ch: 0 },
      { line: insertIdx, ch: 0 },
    );
    return 1;
  }

  private updateOrInsertDescriptionLine(
    lines: string[],
    taskLineIndex: number,
    description: string | null,
    task: Task,
  ): { lines: string[]; lineDelta: number } {
    const taskIndent = getTaskIndent(task);
    const existingIdx = findDescriptionLine(
      lines,
      taskLineIndex + 1,
      taskIndent,
    );

    if (description === null) {
      if (existingIdx >= 0) {
        lines.splice(existingIdx, 1);
        return { lines, lineDelta: -1 };
      }
      return { lines, lineDelta: 0 };
    }

    if (existingIdx >= 0) {
      const indent = this.getExistingDateLineIndent(lines[existingIdx]);
      lines[existingIdx] = `${indent}DESCRIPTION: ${description}`;
      return { lines, lineDelta: 0 };
    }

    const indent = getDateLineIndent(task);
    lines.splice(taskLineIndex + 1, 0, `${indent}DESCRIPTION: ${description}`);
    return { lines, lineDelta: 1 };
  }

  /**
   * Get the editor for a path if that file is active in source mode.
   * Returns null when the file is inactive or not in source mode.
   */
  private getSourceModeEditorForPath(path: string): Editor | null {
    const md = this.app.workspace.getActiveViewOfType(MarkdownView);
    const isActive = md?.file?.path === path;
    const editor = md?.editor;
    const isSourceMode =
      isActive &&
      !!editor &&
      md?.getViewType() === 'markdown' &&
      !!md?.getMode &&
      md.getMode() === 'source';
    return isSourceMode && editor ? editor : null;
  }

  /**
   * Helper: write a single line replacement to the file, using Editor API
   * for active files or Vault.process for background files.
   */
  private async writeLineToFile(
    task: Task,
    newLine: string,
    options: { forceVaultApi?: boolean } = {},
  ): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(task.path);
    if (file && file instanceof TFile) {
      const md = this.app.workspace.getActiveViewOfType(MarkdownView);
      const isActive = !options.forceVaultApi && md?.file?.path === task.path;
      const editor = md?.editor;

      if (isActive && editor) {
        const currentLine = editor.getLine(task.line);
        if (typeof currentLine === 'string') {
          const from: EditorPosition = { line: task.line, ch: 0 };
          const to: EditorPosition = {
            line: task.line,
            ch: currentLine.length,
          };
          editor.replaceRange(newLine, from, to);
        }
        return;
      }

      await this.app.vault.process(file, (data) => {
        const lines = data.split('\n');
        if (task.line < lines.length) {
          lines[task.line] = newLine;
        }
        return lines.join('\n');
      });
    }
  }

  /**
   * Updates or adds a STARTED date line below the task.
   *
   * UPSERT semantics (restart semantics):
   * - If a STARTED line already exists, its timestamp is overwritten — the task
   *   was restarted, so STARTED records when the current stretch began.
   * - Otherwise a new STARTED line is inserted first in the date-line sequence
   *   (before SCHEDULED/DEADLINE/CLOSED).
   * - There is intentionally NO removal path. STARTED is never removed by
   *   state transitions; only manual user editing can remove the line.
   *
   * Returns both the updated task and the line delta (+1 if inserted, 0 if
   * updated in place).
   */
  async updateTaskStartedDate(
    task: Task,
    startedDate: Date | null,
    forceVaultApi = false,
  ): Promise<DateLineUpdateResult> {
    const dateStr = startedDate
      ? DateUtils.formatStartedDate(startedDate)
      : null;

    let lineDelta = 0;

    if (!dateStr) {
      return {
        task: { ...task, startedDate: task.startedDate ?? null },
        lineDelta,
      };
    }

    const file = this.app.vault.getAbstractFileByPath(task.path);
    if (file && file instanceof TFile) {
      const md = this.app.workspace.getActiveViewOfType(MarkdownView);
      // Use Editor API only if NOT forcing Vault API AND file is active in editor (source mode)
      const isActive = !forceVaultApi && md?.file?.path === task.path;
      const editor = md?.editor;

      if (isActive && editor) {
        // Upsert in the existing editor buffer (updates or inserts).
        lineDelta = this.updateDateLineInEditor(
          editor,
          task,
          'STARTED',
          dateStr,
          getTaskIndent(task),
        );
      } else {
        // Vault API path (atomic)
        await this.app.vault.process(file, (data) => {
          const lines = data.split('\n');
          const result = this.updateOrInsertDateLine(
            lines,
            task.line,
            'STARTED',
            dateStr,
            task,
          );
          lineDelta = result.lineDelta;
          return lines.join('\n');
        });
      }
    }

    return {
      task: { ...task, startedDate },
      lineDelta,
    };
  }

  /**
   * Updates or adds a CLOSED date line below the task.
   * If a CLOSED line already exists, it is updated in place.
   * If no CLOSED line exists, a new one is inserted after DEADLINE (or after task if no DEADLINE).
   * Returns both the updated task and the line delta (+1 if new line inserted, 0 if updated in place).
   */
  async updateTaskClosedDate(
    task: Task,
    closedDate: Date,
    forceVaultApi = false,
  ): Promise<DateLineUpdateResult> {
    const dateStr = DateUtils.formatClosedDate(closedDate);
    let lineDelta = 0;

    const file = this.app.vault.getAbstractFileByPath(task.path);
    if (file && file instanceof TFile) {
      const md = this.app.workspace.getActiveViewOfType(MarkdownView);
      // Use Editor API only if NOT forcing Vault API AND file is active in editor (source mode)
      const isActive = !forceVaultApi && md?.file?.path === task.path;
      const editor = md?.editor;

      if (isActive && editor) {
        // Use Editor API when file is open in editor to avoid triggering file watcher
        const lines = Array.from({ length: editor.lineCount() }, (_, i) =>
          editor.getLine(i),
        );

        // Get the proper indent including quote prefix, bullet, or checkbox marker
        const taskIndent = getTaskIndent(task);

        // Search for existing CLOSED line
        // Always search regardless of task.closedDate because:
        // 1. On first completion: no CLOSED line exists, insert new
        // 2. On re-completion: CLOSED line exists from previous close, update existing
        const closedLineIndex = findDateLine(
          lines,
          task.line + 1,
          'CLOSED',
          taskIndent,
          this.keywordManager,
        );

        // Find insert position using helper (after DEADLINE/SCHEDULED if present, otherwise after task)
        const insertIndex = this.calcDateLineInsertIndex(
          lines,
          task.line,
          'CLOSED',
          taskIndent,
        );

        const closedIndent = this.getEffectiveDateLineIndent(
          lines,
          closedLineIndex,
          task,
        );

        if (closedLineIndex >= 0) {
          // Update existing CLOSED line, preserving its indentation
          const from: EditorPosition = { line: closedLineIndex, ch: 0 };
          const to: EditorPosition = {
            line: closedLineIndex,
            ch: lines[closedLineIndex].length,
          };
          editor.replaceRange(`${closedIndent}CLOSED: ${dateStr}`, from, to);
          lineDelta = 0; // Updated in place, no line count change
        } else {
          // Insert new CLOSED line at calculated position
          const from: EditorPosition = { line: insertIndex, ch: 0 };
          const to: EditorPosition = { line: insertIndex, ch: 0 };
          editor.replaceRange(
            `${this.leadingNewlineForInsert(editor, insertIndex)}${closedIndent}CLOSED: ${dateStr}\n`,
            from,
            to,
          );
          lineDelta = 1; // New line inserted
        }
      } else {
        // Vault API path
        await this.app.vault.process(file, (data) => {
          const lines = data.split('\n');
          const result = this.updateOrInsertDateLine(
            lines,
            task.line,
            'CLOSED',
            dateStr,
            task,
          );
          lineDelta = result.lineDelta;
          return lines.join('\n');
        });
      }
    }

    return {
      task: {
        ...task,
        closedDate: closedDate,
      },
      lineDelta,
    };
  }

  /**
   * Removes the CLOSED date line below the task.
   * If no CLOSED line exists in the file, returns the task unchanged.
   * Note: This method attempts to remove the CLOSED line regardless of whether
   * the task.closedDate property is set, as there may be a discrepancy between
   * the parsed property and what exists in the file.
   * Returns both the updated task and the line delta (-1 if line removed, 0 if no line found).
   * Note: Unlike removeTaskScheduledDate and removeTaskDeadlineDate, this method always
   * includes lineDelta in the return value (even when 0) due to its DateLineUpdateResult return type.
   */
  async removeTaskClosedDate(
    task: Task,
    forceVaultApi = false,
  ): Promise<DateLineUpdateResult> {
    // Table tasks store dates inline — strip from cell
    if (this.isTableCellDateUpdate(task)) {
      await this.removeTableCellDate(task, 'CLOSED', forceVaultApi);
      return {
        task: { ...task, closedDate: null },
        lineDelta: 0,
      };
    }

    let lineDelta = 0;

    const file = this.app.vault.getAbstractFileByPath(task.path);
    if (file && file instanceof TFile) {
      const md = this.app.workspace.getActiveViewOfType(MarkdownView);
      // Use Editor API only if NOT forcing Vault API AND file is active in editor (source mode)
      const isActive = !forceVaultApi && md?.file?.path === task.path;
      const editor = md?.editor;

      if (isActive && editor) {
        // Use Editor API when file is open in editor to avoid triggering file watcher
        const taskIndent = getTaskIndent(task);

        // Look for existing CLOSED line after the task
        const closedLineIndex = findDateLine(
          Array.from({ length: editor.lineCount() }, (_, i) =>
            editor.getLine(i),
          ),
          task.line + 1,
          'CLOSED',
          taskIndent,
          this.keywordManager,
        );

        if (closedLineIndex >= 0) {
          // Remove the CLOSED line using Editor API
          const from: EditorPosition = { line: closedLineIndex, ch: 0 };
          const to: EditorPosition = {
            line: closedLineIndex,
            ch: editor.getLine(closedLineIndex).length,
          };
          // Replace with empty string to remove the line
          editor.replaceRange('', from, to);
          // Remove the newline as well by extending to the next line
          const nextLineFrom: EditorPosition = { line: closedLineIndex, ch: 0 };
          const nextLineTo: EditorPosition = {
            line: closedLineIndex + 1,
            ch: 0,
          };
          editor.replaceRange('', nextLineFrom, nextLineTo);
          lineDelta = -1; // Line was removed
        }
      } else {
        // Use Vault API for background edits
        await this.app.vault.process(file, (data) => {
          const lines = data.split('\n');
          const result = this.removeDateLine(lines, task.line, 'CLOSED', task);
          lineDelta = result.lineDelta;
          return lines.join('\n');
        });
      }
    }

    return {
      task: {
        ...task,
        closedDate: null,
      },
      lineDelta,
    };
  }

  /**
   * Atomically apply all recurrence updates (scheduled date, deadline date,
   * and state).
   *
   * File Operation Strategy:
   * - For active files in source mode: Uses Editor API (editor.replaceRange)
   *   to avoid triggering Obsidian's external file modification warning.
   * - For inactive files: Uses Vault.process() for atomic background operations.
   *
   * Returns the updated task snapshot with accumulated lineDelta.
   */
  async applyRecurrenceUpdate(
    task: Task,
    options: {
      newScheduledDate?: Date | null;
      newDeadlineDate?: Date | null;
      newScheduledRepeat?: DateRepeatInfo | null;
      newDeadlineRepeat?: DateRepeatInfo | null;
      newScheduledWarningPeriod?: WarningPeriodInfo | null;
      newDeadlineWarningPeriod?: WarningPeriodInfo | null;
      newState?: string;
      forceVaultApi?: boolean;
    },
  ): Promise<Task & { lineDelta?: number }> {
    const file = this.app.vault.getAbstractFileByPath(task.path);
    let lineDelta = 0;

    let newRawText: string | undefined;
    let newRepeatCount: number | undefined;

    // Check if target is the active file in source mode
    const md = this.app.workspace.getActiveViewOfType(MarkdownView);
    const isActive = md?.file?.path === task.path;
    const editor = md?.editor;
    const isSourceMode =
      !options.forceVaultApi &&
      isActive &&
      editor &&
      md?.getViewType() === 'markdown' &&
      md?.getMode &&
      md.getMode() === 'source';

    if (file && file instanceof TFile) {
      if (isSourceMode && editor) {
        // Use Editor API to avoid external file modification warning
        const taskIndent = getTaskIndent(task);
        let totalDelta = 0;

        // Update task state first if requested
        if (options.newState !== undefined) {
          const generated = TaskWriter.generateTaskLine(
            task,
            options.newState,
            true,
            this.keywordManager,
          );
          const currentLine = editor.getLine(task.line);
          if (typeof currentLine === 'string') {
            const from: EditorPosition = { line: task.line, ch: 0 };
            const to: EditorPosition = {
              line: task.line,
              ch: currentLine.length,
            };
            editor.replaceRange(generated.newLine, from, to);
            newRawText = generated.newLine;
          }
        }

        // Update SCHEDULED date if requested
        if (options.newScheduledDate !== undefined) {
          const dateStr =
            options.newScheduledDate === null
              ? null
              : TaskWriter.buildDateLineContent(
                  options.newScheduledDate,
                  options.newScheduledRepeat ?? task.scheduledDateRepeat,
                  options.newScheduledWarningPeriod ??
                    task.scheduledWarningPeriod,
                );
          const delta = this.updateDateLineInEditor(
            editor,
            task,
            'SCHEDULED',
            dateStr,
            taskIndent,
          );
          totalDelta += delta;
        }

        // Update DEADLINE date if requested
        if (options.newDeadlineDate !== undefined) {
          const dateStr =
            options.newDeadlineDate === null
              ? null
              : TaskWriter.buildDateLineContent(
                  options.newDeadlineDate,
                  options.newDeadlineRepeat ?? task.deadlineDateRepeat,
                  options.newDeadlineWarningPeriod ??
                    task.deadlineWarningPeriod,
                );
          const delta = this.updateDateLineInEditor(
            editor,
            task,
            'DEADLINE',
            dateStr,
            taskIndent,
          );
          totalDelta += delta;
        }

        // A recurring completion records the completion in the [!repeats]
        // callout instead of CLOSED (legacy CLOSED lines are removed).
        if (this.isRepeatLogEnabled() && !task.isTableTask) {
          totalDelta += this.updateDateLineInEditor(
            editor,
            task,
            'CLOSED',
            null,
            taskIndent,
          );
          const occurrence = task.scheduledDate ?? task.deadlineDate;
          const total = (task.repeatCount ?? 0) + 1;
          totalDelta += this.updateRepeatLogInEditor(
            editor,
            task,
            total,
            this.repeatHistoryLimit(),
            new Date(),
            occurrence,
          );
          newRepeatCount = total;
        }

        lineDelta = totalDelta;
      } else {
        // Vault API path for inactive files
        await this.app.vault.process(file, (data) => {
          const lines = data.split('\n');
          let totalDelta = 0;

          // Update SCHEDULED date if requested
          if (options.newScheduledDate !== undefined) {
            if (options.newScheduledDate === null) {
              const result = this.removeDateLine(
                lines,
                task.line,
                'SCHEDULED',
                task,
              );
              totalDelta += result.lineDelta;
            } else {
              const dateStr = TaskWriter.buildDateLineContent(
                options.newScheduledDate,
                options.newScheduledRepeat ?? task.scheduledDateRepeat,
                options.newScheduledWarningPeriod ??
                  task.scheduledWarningPeriod,
              );
              const result = this.updateOrInsertDateLine(
                lines,
                task.line,
                'SCHEDULED',
                dateStr,
                task,
              );
              totalDelta += result.lineDelta;
            }
          }

          // Update DEADLINE date if requested
          if (options.newDeadlineDate !== undefined) {
            if (options.newDeadlineDate === null) {
              const result = this.removeDateLine(
                lines,
                task.line,
                'DEADLINE',
                task,
              );
              totalDelta += result.lineDelta;
            } else {
              const dateStr = TaskWriter.buildDateLineContent(
                options.newDeadlineDate,
                options.newDeadlineRepeat ?? task.deadlineDateRepeat,
                options.newDeadlineWarningPeriod ?? task.deadlineWarningPeriod,
              );
              const result = this.updateOrInsertDateLine(
                lines,
                task.line,
                'DEADLINE',
                dateStr,
                task,
              );
              totalDelta += result.lineDelta;
            }
          }

          // Update task state if requested
          if (options.newState !== undefined) {
            const generated = TaskWriter.generateTaskLine(
              task,
              options.newState,
              true,
              this.keywordManager,
            );
            if (task.line < lines.length) {
              lines[task.line] = generated.newLine;
            }
            newRawText = generated.newLine;
          }

          // A recurring completion records the completion in the [!repeats]
          // callout instead of CLOSED (legacy CLOSED lines are removed).
          if (this.isRepeatLogEnabled() && !task.isTableTask) {
            totalDelta += this.removeDateLine(
              lines,
              task.line,
              'CLOSED',
              task,
            ).lineDelta;
            const occurrence = task.scheduledDate ?? task.deadlineDate;
            const total = (task.repeatCount ?? 0) + 1;
            totalDelta += this.applyRepeatLogToLines(
              lines,
              task,
              total,
              this.repeatHistoryLimit(),
              new Date(),
              occurrence,
            ).lineDelta;
            newRepeatCount = total;
          }

          lineDelta = totalDelta;
          return lines.join('\n');
        });
      }
    }

    // Build the updated task snapshot
    const completed =
      options.newState !== undefined
        ? this.keywordManager.isCompleted(options.newState)
        : task.completed;

    const result: Task & { lineDelta?: number } = {
      ...task,
      rawText: newRawText ?? task.rawText,
      state: options.newState ?? task.state,
      completed,
      scheduledDate:
        options.newScheduledDate !== undefined
          ? options.newScheduledDate
          : task.scheduledDate,
      scheduledDateRepeat:
        options.newScheduledRepeat !== undefined
          ? options.newScheduledRepeat
          : task.scheduledDateRepeat,
      scheduledWarningPeriod:
        options.newScheduledWarningPeriod !== undefined
          ? options.newScheduledWarningPeriod
          : task.scheduledWarningPeriod,
      deadlineDate:
        options.newDeadlineDate !== undefined
          ? options.newDeadlineDate
          : task.deadlineDate,
      deadlineDateRepeat:
        options.newDeadlineRepeat !== undefined
          ? options.newDeadlineRepeat
          : task.deadlineDateRepeat,
      deadlineWarningPeriod:
        options.newDeadlineWarningPeriod !== undefined
          ? options.newDeadlineWarningPeriod
          : task.deadlineWarningPeriod,
      repeatCount: newRepeatCount ?? task.repeatCount ?? null,
    };
    if (lineDelta !== 0) {
      result.lineDelta = lineDelta;
    }
    return result;
  }

  /**
   * Check if the task's file is active in source mode and return the editor.
   * Returns null if the file is not active or not in source mode.
   */
  private getEditorForTask(task: Task, forceVaultApi = false): Editor | null {
    return forceVaultApi ? null : this.getSourceModeEditorForPath(task.path);
  }

  /**
   * Update, insert, or remove a date line (SCHEDULED/DEADLINE) via the Editor API.
   * Returns the line delta (+1 insert, -1 remove, 0 update).
   */
  private updateDateLineInEditor(
    editor: Editor,
    task: Task,
    dateType: DateLineType,
    dateStr: string | null,
    taskIndent: string,
  ): number {
    const lines = Array.from({ length: editor.lineCount() }, (_, i) =>
      editor.getLine(i),
    );
    const existingIdx = findDateLine(
      lines,
      task.line + 1,
      dateType,
      taskIndent,
      this.keywordManager,
    );

    if (dateStr === null) {
      if (existingIdx >= 0) {
        editor.replaceRange(
          '',
          { line: existingIdx, ch: 0 },
          { line: existingIdx + 1, ch: 0 },
        );
        return -1;
      }
      return 0;
    }

    if (existingIdx >= 0) {
      const indent = this.getEffectiveDateLineIndent(lines, existingIdx, task);
      editor.replaceRange(
        `${indent}${dateType}: ${dateStr}`,
        { line: existingIdx, ch: 0 },
        { line: existingIdx, ch: editor.getLine(existingIdx).length },
      );
      return 0;
    }

    const insertIdx = this.calcDateLineInsertIndex(
      lines,
      task.line,
      dateType,
      taskIndent,
    );
    const indent = this.getEffectiveDateLineIndent(lines, -1, task);
    editor.replaceRange(
      `${this.leadingNewlineForInsert(editor, insertIdx)}${indent}${dateType}: ${dateStr}\n`,
      { line: insertIdx, ch: 0 },
      { line: insertIdx, ch: 0 },
    );
    return 1;
  }

  // ─────────────────────────────────────────────────────────────────────
  // Inlined date-line helpers (formerly src/services/date-line-operator.ts)
  // All methods are private; they capture `this.keywordManager` from the
  // owning TaskWriter instance. The math here is pure and identical to the
  // prior module — just relocated behind the class boundary.
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Extract the effective indentation from a date line.
   * Handles both plain indentation and quoted lines ("> " prefixes).
   */
  private getExistingDateLineIndent(line: string): string {
    const lineIndent = line.match(/^(\s*)/)?.[1] ?? '';
    const lineQuotePrefix = line.match(/^(\s*(>\s*)+)/)?.[1] ?? '';
    return lineQuotePrefix || lineIndent;
  }

  /**
   * Resolve the indent to use for a date line operation.
   * If the line already exists, preserves its current indent.
   * Otherwise, computes the default indent for the task.
   */
  private getEffectiveDateLineIndent(
    lines: string[],
    existingLineIndex: number,
    task: Task,
  ): string {
    if (existingLineIndex >= 0) {
      return this.getExistingDateLineIndent(lines[existingLineIndex]);
    }
    return getDateLineIndent(task);
  }

  /**
   * Calculate the line index where a new date line should be inserted.
   *
   * Insertion rules (all indices relative to task.line):
   * - DESCRIPTION: always inserted at taskLineIndex + 1
   * - CREATED:    first in the date-line sequence — before STARTED/SCHEDULED
   * - STARTED:    after CREATED (if exists), before SCHEDULED/DEADLINE/CLOSED
   * - SCHEDULED:  before DEADLINE (if exists), else after STARTED/CREATED (if
   *               exists), else after DESCRIPTION
   * - DEADLINE:   after SCHEDULED (if exists), else after STARTED/CREATED (if
   *               exists), else after DESCRIPTION
   * - CLOSED:     after DEADLINE/SCHEDULED/STARTED/CREATED (whichever is last),
   *               else after DESCRIPTION
   */
  private calcDateLineInsertIndex(
    lines: string[],
    taskLineIndex: number,
    dateType: DateLineType,
    taskIndent: string,
  ): number {
    const kwManager = this.keywordManager;
    const afterTask = taskLineIndex + 1;

    // Find DESCRIPTION position (dates must go after it)
    const descIdx = findDescriptionLine(lines, afterTask, taskIndent);
    const afterDesc = descIdx >= 0 ? descIdx + 1 : afterTask;

    // CREATED is always the very first date line, so any other date line must
    // be inserted after it when present.
    const createdIdx = findDateLine(
      lines,
      afterTask,
      'CREATED',
      taskIndent,
      kwManager,
    );
    const afterCreated = createdIdx >= 0 ? createdIdx + 1 : afterDesc;

    if (dateType === 'CREATED') {
      // Insert before any other date line.
      return afterDesc;
    }
    if (dateType === 'STARTED') {
      // STARTED goes first among the non-CREATED date lines: before
      // SCHEDULED/DEADLINE/CLOSED (but after CREATED).
      const scheduledIdx = findDateLine(
        lines,
        afterTask,
        'SCHEDULED',
        taskIndent,
        kwManager,
      );
      if (scheduledIdx >= 0) return scheduledIdx;
      const deadlineIdx = findDateLine(
        lines,
        afterTask,
        'DEADLINE',
        taskIndent,
        kwManager,
      );
      if (deadlineIdx >= 0) return deadlineIdx;
      const closedIdx = findDateLine(
        lines,
        afterTask,
        'CLOSED',
        taskIndent,
        kwManager,
      );
      if (closedIdx >= 0) return closedIdx;
      return afterCreated;
    }
    if (dateType === 'SCHEDULED') {
      // Insert before DEADLINE (if exists), else after STARTED/CREATED (if
      // exists), else after DESCRIPTION.
      const deadlineIdx = findDateLine(
        lines,
        afterTask,
        'DEADLINE',
        taskIndent,
        kwManager,
      );
      if (deadlineIdx >= 0) return deadlineIdx;
      const startedIdx = findDateLine(
        lines,
        afterTask,
        'STARTED',
        taskIndent,
        kwManager,
      );
      return startedIdx >= 0 ? startedIdx + 1 : afterCreated;
    }
    if (dateType === 'DEADLINE') {
      // Insert after SCHEDULED (if exists), else after STARTED/CREATED (if
      // exists), else after DESCRIPTION.
      const scheduledIdx = findDateLine(
        lines,
        afterTask,
        'SCHEDULED',
        taskIndent,
        kwManager,
      );
      if (scheduledIdx >= 0) return scheduledIdx + 1;
      const startedIdx = findDateLine(
        lines,
        afterTask,
        'STARTED',
        taskIndent,
        kwManager,
      );
      return startedIdx >= 0 ? startedIdx + 1 : afterCreated;
    }
    // CLOSED - insert after DEADLINE, SCHEDULED, or STARTED/CREATED (whichever is last)
    const deadlineIdx = findDateLine(
      lines,
      afterTask,
      'DEADLINE',
      taskIndent,
      kwManager,
    );
    if (deadlineIdx >= 0) return deadlineIdx + 1;
    const scheduledIdx = findDateLine(
      lines,
      afterTask,
      'SCHEDULED',
      taskIndent,
      kwManager,
    );
    if (scheduledIdx >= 0) return scheduledIdx + 1;
    // No SCHEDULED/DEADLINE: place CLOSED after STARTED (if present) so a
    // CLOSED line is never positioned before a STARTED line.
    const startedIdx = findDateLine(
      lines,
      afterTask,
      'STARTED',
      taskIndent,
      kwManager,
    );
    if (startedIdx >= 0) return startedIdx + 1;
    return afterCreated;
  }

  /**
   * Update an existing date line or insert a new one.
   * Returns the resulting lines and the line delta.
   */
  private updateOrInsertDateLine(
    lines: string[],
    taskLineIndex: number,
    dateType: DateLineType,
    dateStr: string,
    task: Task,
  ): { lines: string[]; lineDelta: number } {
    const kwManager = this.keywordManager;
    const taskIndent = getTaskIndent(task);
    const existingIdx = findDateLine(
      lines,
      taskLineIndex + 1,
      dateType,
      taskIndent,
      kwManager,
    );

    if (existingIdx >= 0) {
      const indent = this.getEffectiveDateLineIndent(lines, existingIdx, task);
      lines[existingIdx] = `${indent}${dateType}: ${dateStr}`;
      return { lines, lineDelta: 0 };
    }

    const insertIdx = this.calcDateLineInsertIndex(
      lines,
      taskLineIndex,
      dateType,
      taskIndent,
    );
    const indent = this.getEffectiveDateLineIndent(lines, -1, task);
    lines.splice(insertIdx, 0, `${indent}${dateType}: ${dateStr}`);
    return { lines, lineDelta: 1 };
  }

  /**
   * Remove a date line.
   * Returns the resulting lines and the line delta.
   */
  private removeDateLine(
    lines: string[],
    taskLineIndex: number,
    dateType: DateLineType,
    task: Task,
  ): { lines: string[]; lineDelta: number } {
    const kwManager = this.keywordManager;
    const taskIndent = getTaskIndent(task);
    const existingIdx = findDateLine(
      lines,
      taskLineIndex + 1,
      dateType,
      taskIndent,
      kwManager,
    );

    if (existingIdx >= 0) {
      lines.splice(existingIdx, 1);
      return { lines, lineDelta: -1 };
    }

    return { lines, lineDelta: 0 };
  }
}
