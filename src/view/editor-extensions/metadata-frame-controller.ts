import { MarkdownView, Notice } from 'obsidian';
import { EditorView } from '@codemirror/view';
import TodoTracker from '../../main';
import { Task } from '../../types/task';
import { DatePicker, DatePickerMode } from '../components/date-picker-menu';
import { PhotoPickerModal } from '../components/photo-picker-modal';
import { PhotoLightbox } from '../components/photo-lightbox';

/**
 * Minimal pointer information the chip routing needs. A real MouseEvent and
 * the synthetic object built for keyboard activation both satisfy it, which
 * avoids constructing DOM events (and their window) for key presses.
 */
export interface ChipPointerEvent {
  clientX: number;
  clientY: number;
  preventDefault(): void;
  stopPropagation(): void;
}

/**
 * Routes clicks on the virtual metadata frame chips to the existing edit
 * surfaces: the DatePicker (scheduled/deadline), the state menu
 * (started/closed) and the task editor modal (description).
 *
 * All writes go through the standard update pipeline; this controller only
 * resolves the clicked task and opens the right surface.
 */
export class MetadataFrameController {
  constructor(private plugin: TodoTracker) {}

  /** Handle a click on a frame chip. Returns true when handled. */
  public handleChipClick(evt: ChipPointerEvent, chipEl: HTMLElement): boolean {
    const action = chipEl.getAttribute('data-todoseq-action');
    // Expand and source toggles are handled by the frame widget itself.
    if (!action || action === 'expand' || action === 'source') {
      return false;
    }

    const view = this.findViewForChip(chipEl);
    if (!view || !view.file || !view.editor) {
      return false;
    }

    const lineRaw = Number(chipEl.getAttribute('data-todoseq-line'));
    if (!Number.isFinite(lineRaw) || lineRaw < 1) {
      return false;
    }
    const line0 = lineRaw - 1;

    let task = this.resolveTask(view, line0);
    // Work-session state (TIMER) lives in the live buffer the frame renders
    // from, but the state manager may lag behind by a scan. Re-read it from the
    // buffer so pause/start always sees the current timer.
    if (action === 'work-start' || action === 'work-pause') {
      task = this.parseTaskFromEditor(view, line0) ?? task;
    }
    if (!task) {
      return false;
    }

    // Make the clicked pane active so downstream surfaces resolve the
    // correct editor via getActiveViewOfType.
    this.activateLeafForView(view);

    switch (action) {
      case 'scheduled':
      case 'deadline':
        this.openDatePicker(task, action, evt);
        return true;
      case 'started':
      case 'closed':
        this.openStateMenu(task, chipEl, evt);
        return true;
      case 'description':
        this.openTaskEditor(view, line0);
        return true;
      case 'work-start':
        void this.plugin.taskEditor?.startWorkSession(task).catch((error) => {
          console.debug('Failed to start work session', error);
        });
        return true;
      case 'work-pause':
        void this.plugin.taskEditor?.pauseWorkSession(task).catch((error) => {
          console.debug('Failed to pause work session', error);
        });
        return true;
      case 'photo':
        this.openPhotoLightbox(task, view);
        return true;
      case 'photo-add':
        this.openPhotoPicker(task, view);
        return true;
      default:
        // 'created' / 'repeats' chips are informational only.
        return true;
    }
  }

  /** Find the MarkdownView whose editor contains the clicked chip. */
  private findViewForChip(chipEl: HTMLElement): MarkdownView | null {
    const container = chipEl.closest('.cm-editor');
    const leaves = this.plugin.app.workspace.getLeavesOfType('markdown');
    for (const leaf of leaves) {
      const view = leaf.view;
      if (view instanceof MarkdownView && view.editor) {
        const cm = (view.editor as { cm?: EditorView }).cm;
        if (cm && cm.dom === container) {
          return view;
        }
      }
    }
    return null;
  }

  private activateLeafForView(view: MarkdownView): void {
    const leaves = this.plugin.app.workspace.getLeavesOfType('markdown');
    for (const leaf of leaves) {
      if (leaf.view === view) {
        this.plugin.app.workspace.setActiveLeaf(leaf, { focus: true });
        return;
      }
    }
  }

  /** Fresh task for the frame's task line: state manager first, live buffer fallback. */
  private resolveTask(view: MarkdownView, line0: number): Task | null {
    const path = view.file?.path;
    if (!path) {
      return null;
    }
    return (
      this.plugin.taskStateManager?.findTaskByPathAndLine(path, line0) ??
      this.parseTaskFromEditor(view, line0)
    );
  }

  /**
   * Parse the task straight from the live editor buffer (the click may land
   * before the incremental scan caught up with recent edits).
   */
  private parseTaskFromEditor(view: MarkdownView, line0: number): Task | null {
    const path = view.file?.path;
    const parser = this.plugin.vaultScanner?.getParser();
    if (!path || !parser) {
      return null;
    }

    const lineCount = view.editor.lineCount();
    const lines = new Array<string>(lineCount);
    for (let i = 0; i < lineCount; i++) {
      lines[i] = view.editor.getLine(i);
    }
    if (line0 < 0 || line0 >= lines.length) {
      return null;
    }
    const candidate = lines[line0];
    if (!candidate || !parser.isTaskLine(candidate)) {
      // Line numbers shifted; the frame data is stale for this line.
      return null;
    }
    return parser.parseTaskBlock(lines, line0, path);
  }

  private openDatePicker(
    task: Task,
    mode: DatePickerMode,
    evt: ChipPointerEvent,
  ): void {
    const coordinator = this.plugin.taskUpdateCoordinator;
    if (!coordinator) {
      new Notice('Task updating unavailable');
      return;
    }

    const isDeadline = mode === 'deadline';
    const initialDate = isDeadline ? task.deadlineDate : task.scheduledDate;
    const initialRepeat = isDeadline
      ? task.deadlineDateRepeat
      : task.scheduledDateRepeat;

    const datePicker = new DatePicker(
      {
        onDateSelected: (date, repeat) => {
          coordinator
            .updateTask({
              task,
              type: isDeadline ? 'deadline-date' : 'scheduled-date',
              source: 'editor',
              newDate: date,
              newRepeat: repeat,
            })
            .catch((error) => {
              console.debug(
                'Failed to update task date from frame chip',
                error,
              );
              new Notice('Failed to update task date');
            });
        },
      },
      {
        weekStartsOn: this.plugin.settings.weekStartsOn,
        allowRepeat: true,
      },
    );

    void datePicker
      .show(
        { x: evt.clientX, y: evt.clientY + 8 },
        mode,
        initialDate,
        initialRepeat,
      )
      .catch((error) => {
        console.debug('Failed to open date picker from frame chip', error);
      });
  }

  private openStateMenu(
    task: Task,
    chipEl: HTMLElement,
    evt: ChipPointerEvent,
  ): void {
    this.plugin.editorKeywordMenu?.openStateMenuAtMouseEvent(
      task.state,
      chipEl,
      evt,
      task.line + 1,
    );
  }

  private openTaskEditor(view: MarkdownView, line0: number): void {
    view.editor.setCursor({ line: line0, ch: 0 });
    this.plugin.taskEditorController?.openFromActiveEditor();
  }

  private openPhotoLightbox(task: Task, view: MarkdownView): void {
    if (!task.photo) {
      return;
    }
    const resolved = this.plugin.resolvePhotoLink(
      task.photo,
      view.file?.path ?? '',
    );
    if (!resolved) {
      new Notice('Photo not found in the vault');
      return;
    }
    new PhotoLightbox(this.plugin.app, resolved.src, task.text).open();
  }

  private openPhotoPicker(task: Task, view: MarkdownView): void {
    const sourcePath = view.file?.path ?? '';
    const modal = new PhotoPickerModal(this.plugin.app, {
      onSelect: async (selection) => {
        const link = await this.plugin.saveTaskPhoto(selection, sourcePath);
        if (!link) {
          new Notice('Failed to save the photo');
          return;
        }
        await this.plugin.taskEditor?.setTaskPhoto(task, link);
      },
    });
    modal.open();
  }
}
