import { MarkdownView, Notice, TFile } from 'obsidian';
import TodoTracker from '../main';
import { Task, DateRepeatInfo } from '../types/task';
import { TaskComposeFields, TaskWriter } from './task-writer';
import {
  TaskEditorInitialValues,
  TaskEditorModal,
} from '../view/components/task-editor-modal';
import { isTaskMetadataLine } from '../utils/task-metadata';
import { stripMarkdownPrefixes } from '../utils/patterns';

/** A resolved target for the task editor: an existing task or a new-task line. */
interface TaskEditorTarget {
  path: string;
  line: number;
  task: Task | null;
  /** Text prefilled from the cursor line when creating a task on plain text. */
  prefillText?: string;
  /** Replace the (non-blank) plain text cursor line when saving the new task. */
  replaceLine?: boolean;
}

/**
 * Coordinates the task editor modal.
 *
 * Resolves the task under the editor cursor (or a new-task insertion point when
 * the cursor is not on a task), builds the initial form values, and persists
 * the composed fields through TaskWriter.
 */
export class TaskEditorController {
  private modal: TaskEditorModal | null = null;

  constructor(private plugin: TodoTracker) {}

  /**
   * Open the task editor for the active markdown editor.
   * Edits the task under the cursor, or creates a new task there.
   */
  openFromActiveEditor(): void {
    // Ensure only one editor modal is open at a time.
    if (this.modal) {
      this.modal.close();
      this.modal = null;
    }

    const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || !view.file) {
      new Notice('Open a note to add a task');
      return;
    }

    const editor = view.editor;
    if (!editor) {
      new Notice('Open the note in edit mode to add a task');
      return;
    }

    const cursorLine = editor.getCursor().line;
    const target = this.resolveTarget(view.file.path, cursorLine);
    const keywordManager = this.plugin.taskStateManager.getKeywordManager();

    const initial: TaskEditorInitialValues = target.task
      ? {
          text: target.task.text,
          state: target.task.state,
          priority: target.task.priority,
          scheduledDate: target.task.scheduledDate,
          scheduledRepeat: target.task.scheduledDateRepeat,
          scheduledWarningPeriod: target.task.scheduledWarningPeriod,
          deadlineDate: target.task.deadlineDate,
          deadlineRepeat: target.task.deadlineDateRepeat,
          deadlineWarningPeriod: target.task.deadlineWarningPeriod,
          description: target.task.description ?? null,
        }
      : {
          text: target.prefillText ?? '',
          state: keywordManager.getDefaultInactive(),
          priority: null,
          scheduledDate: null,
          scheduledRepeat: null,
          scheduledWarningPeriod: null,
          deadlineDate: null,
          deadlineRepeat: null,
          deadlineWarningPeriod: null,
          description: null,
        };

    this.modal = new TaskEditorModal(this.plugin.app, {
      mode: target.task ? 'edit' : 'create',
      initial,
      keywordManager,
      weekStartsOn: this.plugin.settings.weekStartsOn,
      listMarker: this.plugin.settings.newTaskListMarker,
      onListMarkerChange: (value) => {
        this.plugin.settings.newTaskListMarker = value;
        void this.plugin.saveSettings();
      },
      isTableTask: target.task?.isTableTask,
      onSubmit: (fields) => this.save(target, fields),
      onCancel: () => {
        this.modal = null;
      },
    });
    this.modal.open();
  }

  /**
   * Close any open editor modal. Call during plugin unload.
   */
  cleanup(): void {
    if (this.modal) {
      this.modal.close();
      this.modal = null;
    }
  }

  /**
   * Resolve whether the cursor is on (or directly below) an existing task.
   * Falls back to a new-task target at the cursor line.
   */
  private resolveTarget(path: string, cursorLine: number): TaskEditorTarget {
    const stateManager = this.plugin.taskStateManager;
    const editor =
      this.plugin.app.workspace.getActiveViewOfType(MarkdownView)?.editor ??
      null;
    const parser = this.plugin.vaultScanner?.getParser() ?? null;

    const direct = stateManager.findTaskByPathAndLine(path, cursorLine);
    if (direct) {
      return { path, line: cursorLine, task: direct };
    }

    if (editor) {
      const line = editor.getLine(cursorLine);
      if (parser && line !== undefined && parser.isTaskLine(line)) {
        return {
          path,
          line: cursorLine,
          task: parser.parseLineAsTask(line, cursorLine, path),
        };
      }

      // Cursor may be on a metadata line (DESCRIPTION/SCHEDULED/...): walk up
      // to the task that owns it so editing works from anywhere in the block.
      if (line !== undefined && isTaskMetadataLine(line)) {
        for (let i = cursorLine - 1; i >= Math.max(0, cursorLine - 9); i--) {
          const candidate = editor.getLine(i);
          if (candidate === undefined) break;
          if (parser && parser.isTaskLine(candidate)) {
            return {
              path,
              line: i,
              task:
                stateManager.findTaskByPathAndLine(path, i) ??
                parser.parseLineAsTask(candidate, i, path),
            };
          }
          if (candidate.trim() !== '' && !isTaskMetadataLine(candidate)) {
            break;
          }
        }
      }

      // The cursor may sit on plain text the user just typed: offer it as the
      // prefill for a new task and replace that line when the task is saved.
      const lineText = editor.getLine(cursorLine) ?? '';
      const prefillText = stripMarkdownPrefixes(lineText).trim();
      return {
        path,
        line: cursorLine,
        task: null,
        prefillText,
        replaceLine: prefillText !== '',
      };
    }

    return { path, line: cursorLine, task: null };
  }

  /** Whether the modal changed the task's scheduled/deadline dates or repeats. */
  private hasScheduleChanged(task: Task, fields: TaskComposeFields): boolean {
    return (
      this.repeatChanged(task.scheduledDateRepeat, fields.scheduledRepeat) ||
      this.repeatChanged(task.deadlineDateRepeat, fields.deadlineRepeat) ||
      this.dateChanged(task.scheduledDate, fields.scheduledDate) ||
      this.dateChanged(task.deadlineDate, fields.deadlineDate)
    );
  }

  private repeatChanged(
    before: DateRepeatInfo | null,
    after: DateRepeatInfo | null,
  ): boolean {
    return (before?.raw ?? null) !== (after?.raw ?? null);
  }

  private dateChanged(before: Date | null, after: Date | null): boolean {
    return (before?.getTime() ?? null) !== (after?.getTime() ?? null);
  }

  /** Persist the composed fields and refresh task views. */
  private async save(
    target: TaskEditorTarget,
    fields: TaskComposeFields,
  ): Promise<void> {
    const writer: TaskWriter | null = this.plugin.taskEditor;
    if (!writer) {
      return;
    }

    const keywordManager = this.plugin.taskStateManager.getKeywordManager();
    const willBeCompleted = keywordManager.isCompleted(fields.state);
    const willBeRecurrenceCompletion =
      willBeCompleted && !keywordManager.isCanceled(fields.state);
    const hasRepeatingDates =
      (fields.scheduledRepeat != null && fields.scheduledDate != null) ||
      (fields.deadlineRepeat != null && fields.deadlineDate != null);
    // Roll a recurring occurrence forward when the task is completed now, or
    // when its schedule/repeat is added or changed on an already-completed
    // task. Cancellations and unrelated edits (e.g. text) to a completed
    // recurring task do not reopen it — matching the other surfaces.
    const wasRecurrenceCompletion = target.task
      ? keywordManager.isCompleted(target.task.state) &&
        !keywordManager.isCanceled(target.task.state)
      : false;
    const scheduleChanged = target.task
      ? this.hasScheduleChanged(target.task, fields)
      : false;
    const completingNow =
      willBeRecurrenceCompletion &&
      (!wasRecurrenceCompletion || scheduleChanged);
    const recordCompletion = completingNow && hasRepeatingDates;
    const writeFields: TaskComposeFields = recordCompletion
      ? { ...fields, state: keywordManager.getDefaultInactive() }
      : fields;

    try {
      if (target.task) {
        const result = await writer.updateTaskFields(target.task, writeFields, {
          recordCompletion,
        });
        if (recordCompletion && result) {
          this.plugin.taskUpdateCoordinator?.scheduleRecurrenceIfRecurring(
            result.task,
            'editor',
          );
        }
      } else {
        const result = await writer.createTaskAtLine(
          target.path,
          target.line,
          writeFields,
          {
            recordCompletion,
            replaceExistingLine: target.replaceLine ?? false,
          },
        );
        if (recordCompletion && result) {
          this.plugin.taskUpdateCoordinator?.scheduleRecurrenceIfRecurring(
            result.task,
            'editor',
          );
        }
      }
    } catch (error) {
      // Report once here and let the modal keep itself open for a retry.
      console.debug('Failed to save task', error);
      new Notice('Failed to save task');
      throw error;
    }

    // Refresh views after a successful write. A failure here must not keep the
    // modal open — the task is already saved, and retrying would duplicate it.
    // Only write failures keep the modal open.
    try {
      const file = this.plugin.app.vault.getAbstractFileByPath(target.path);
      if (file instanceof TFile && this.plugin.vaultScanner) {
        await this.plugin.vaultScanner.processIncrementalChange(file);
      }
      this.plugin.refreshAllTaskListViews();
    } catch (error) {
      console.debug('Failed to refresh views after saving task', error);
    }
  }
}
