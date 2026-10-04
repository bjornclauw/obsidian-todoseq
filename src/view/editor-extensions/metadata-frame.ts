import { setIcon } from 'obsidian';
import { EditorView, WidgetType } from '@codemirror/view';
import { StateEffect } from '@codemirror/state';
import { Task } from '../../types/task';
import { FrameVariant } from '../../utils/metadata-block';
import { DateUtils } from '../../utils/date-utils';
import { formatDuration } from '../../utils/work-log';

/**
 * Toggle a frame's expansion state (payload = 1-based task line number).
 * Dispatched by the expand chip; handled by the metadata frame StateField,
 * which resolves the line to a document position so the state follows the
 * task across edits.
 */
export const toggleMetadataFrameEffect = StateEffect.define<number>();

/**
 * Toggle the raw metadata source for one task (payload = 1-based task line
 * number). Dispatched by the `<>` source chip, mirroring Obsidian's
 * edit-block-button on rendered blocks.
 */
export const toggleMetadataFrameSourceEffect = StateEffect.define<number>();

/**
 * Minimum left offset of a frame, matching the approved mockup. Measured task
 * indents that are smaller (heading tasks, top-level tasks with short markers)
 * are raised to this value so every frame reads as indented.
 */
const MIN_FRAME_INDENT = 28;

/**
 * Icon-only chip that reveals or hides the raw metadata block. Shown inside
 * the frame (hide source) and as an inline widget on the task line while the
 * source is revealed (show frame).
 */
function sourceToggleChip(
  view: EditorView,
  taskLine: number,
  revealed: boolean,
): HTMLElement {
  const el = createSpan({
    cls: 'todoseq-chip todoseq-chip-source',
    attr: {
      'data-todoseq-action': 'source',
      'data-todoseq-line': String(taskLine),
      role: 'button',
      tabindex: '0',
      'aria-label': revealed ? 'Show metadata frame' : 'Show metadata source',
    },
  });
  const iconEl = createSpan({ cls: 'todoseq-chip-icon' });
  setIcon(iconEl, 'code');
  el.appendChild(iconEl);

  const activate = (evt: {
    preventDefault(): void;
    stopPropagation(): void;
  }) => {
    evt.preventDefault();
    evt.stopPropagation();
    view.dispatch({
      effects: toggleMetadataFrameSourceEffect.of(taskLine),
    });
  };
  el.addEventListener('click', activate);
  el.addEventListener('keydown', (evt) => {
    if (evt.key === 'Enter' || evt.key === ' ') {
      activate(evt);
    }
  });
  return el;
}

/**
 * Inline widget shown at the end of a task line while its metadata source is
 * revealed, so the frame can be restored with the same `<>` affordance.
 */
export class FrameSourceToggleWidget extends WidgetType {
  constructor(
    private taskLine: number,
    private revealed: boolean,
  ) {
    super();
  }

  eq(other: FrameSourceToggleWidget): boolean {
    return other.taskLine === this.taskLine && other.revealed === this.revealed;
  }

  ignoreEvent(): boolean {
    return true;
  }

  toDOM(view: EditorView): HTMLElement {
    return sourceToggleChip(view, this.taskLine, this.revealed);
  }
}

/** Everything the frame widget needs to render one task's metadata block. */
export interface FramePayload {
  variant: FrameVariant;
  task: Task;
  /** 1-based source line of the task line (fresh per decoration pass). */
  taskLine: number;
  /** Number of metadata lines hidden by the frame. */
  metadataLineCount: number;
  /** Raw source lines for tooltips, keyed by field. */
  tooltips: {
    scheduled?: string;
    deadline?: string;
    description?: string;
    started?: string;
    closed?: string;
    repeatLog?: string;
    photo?: string;
  };
  /** Ephemeral expansion flag so a completed block can show its raw fields. */
  expanded: boolean;
  /** Whether work logging is enabled (shows the play/pause chip). */
  workLogEnabled?: boolean;
  /** Whether task photos are enabled (shows the add-photo chip). */
  photosEnabled?: boolean;
  /** Resolved resource URL for the task's photo (when one exists). */
  photoSrc?: string;
}

/** Stable identity of a frame payload for CodeMirror's eq() check. */
export function frameSignature(payload: FramePayload): string {
  const t = payload.task;
  const iso = (d: Date | null | undefined) => (d ? d.getTime() : '');
  return [
    payload.variant,
    payload.taskLine,
    payload.metadataLineCount,
    payload.expanded,
    t.state,
    iso(t.scheduledDate),
    t.scheduledDateRepeat?.raw ?? '',
    iso(t.deadlineDate),
    t.deadlineDateRepeat?.raw ?? '',
    iso(t.startedDate),
    iso(t.closedDate),
    iso(t.createdDate),
    iso(t.timerStart),
    t.workLogTotalMinutes ?? '',
    t.description ?? '',
    t.photo ?? '',
    payload.photoSrc ?? '',
    t.repeatCount ?? '',
  ].join('\u0000');
}

/** Build one clickable chip: icon + label, tooltip = raw source line. */
function chip(
  className: string,
  icon: string,
  label: string,
  tooltip: string,
  action: string,
  taskLine: number,
): HTMLElement {
  const el = createSpan();
  el.className = `todoseq-chip ${className}`;
  el.setAttribute('data-todoseq-action', action);
  el.setAttribute('data-todoseq-line', String(taskLine));
  el.setAttribute('aria-label', tooltip);
  el.setAttribute('role', 'button');
  el.setAttribute('tabindex', '0');

  const iconEl = createSpan({ cls: 'todoseq-chip-icon' });
  setIcon(iconEl, icon);
  el.appendChild(iconEl);

  if (label) {
    el.appendChild(createSpan({ cls: 'todoseq-chip-label', text: label }));
  }
  return el;
}

/**
 * Renders a task's metadata block as a compact icon frame.
 *
 * Purely virtual: the widget never touches the document, and moving the
 * cursor into the block reveals the raw text instead.
 */
export class FrameWidget extends WidgetType {
  /** Interval ids for live work-session ticks (cleared on destroy). */
  private workTickIds: number[] = [];

  constructor(private payload: FramePayload) {
    super();
  }

  eq(other: FrameWidget): boolean {
    return frameSignature(other.payload) === frameSignature(this.payload);
  }

  destroy(): void {
    for (const id of this.workTickIds) {
      window.clearInterval(id);
    }
    this.workTickIds = [];
  }

  ignoreEvent(): boolean {
    // Chips handle their own clicks; CodeMirror must not steal the event
    // and move the cursor into the (hidden) metadata text.
    return true;
  }

  toDOM(view: EditorView): HTMLElement {
    const { payload } = this;
    const frame = createDiv({
      cls: `todoseq-metadata-frame todoseq-frame-${payload.variant}`,
      attr: {
        'data-todoseq-variant': payload.variant,
        'data-todoseq-line': String(payload.taskLine),
        contenteditable: 'false',
        spellcheck: 'false',
      },
    });
    switch (payload.variant) {
      case 'completed':
        if (payload.expanded) {
          this.buildActive(frame, payload, true);
        } else {
          this.buildCompleted(frame, payload);
        }
        break;
      case 'recurring-completed':
        if (payload.expanded) {
          this.buildActive(frame, payload, true);
        } else {
          this.buildRecurring(frame, payload);
        }
        break;
      default:
        this.buildActive(frame, payload, payload.expanded);
        break;
    }

    if (payload.task.photo && payload.photoSrc) {
      frame.addClass('todoseq-frame-with-photo');
    }

    const chipRow =
      frame.querySelector<HTMLElement>(':scope > .todoseq-frame-chips') ??
      frame;
    this.appendExpandHint(chipRow, payload, view);
    chipRow.appendChild(sourceToggleChip(view, payload.taskLine, false));
    this.applyIndent(view, frame, payload.taskLine);
    return frame;
  }

  /**
   * Align the frame with the task's rendered text.
   *
   * Block widgets are children of `.cm-content`, not of the task's line, so
   * they inherit none of the list indentation Obsidian applies to the line.
   * The offset is measured after layout and handed to CSS as a custom
   * property; the stylesheet falls back to a sane default when measurement
   * is not possible (offscreen lines, first paint, tests).
   *
   * The measured offset is floored at {@link MIN_FRAME_INDENT} so heading
   * tasks (whose text starts almost flush with the content edge) keep the
   * same visual indent as list tasks, matching the approved mockup.
   */
  private applyIndent(
    view: EditorView,
    frame: HTMLElement,
    taskLine: number,
  ): void {
    const measure = () => {
      if (!frame.isConnected) return;
      try {
        const lineFrom = view.state.doc.line(taskLine).from;
        const domPos = view.domAtPos(lineFrom);
        const node = domPos.node;
        const lineEl = (
          node.nodeType === Node.ELEMENT_NODE
            ? (node as HTMLElement)
            : node.parentElement
        )?.closest('.cm-line');
        if (!lineEl) return;

        // The keyword span marks where the task text starts; fall back to the
        // list marker/checkbox/heading marks, then the line box itself.
        const reference =
          lineEl.querySelector<HTMLElement>(
            '.todoseq-keyword-formatted, .cm-formatting-list, .cm-formatting-header, input[type="checkbox"], .list-bullet',
          ) ?? lineEl;

        const contentLeft = view.contentDOM.getBoundingClientRect().left;
        const referenceLeft = reference.getBoundingClientRect().left;
        const measured = Math.round(referenceLeft - contentLeft);
        const indent = Math.max(MIN_FRAME_INDENT, measured);
        // Obsidian applies `margin: 0 !important` to `.cm-content` children, so
        // the stylesheet carries the `!important` indent rule; this variable is
        // what it reads. The inline margin is a fallback for the case where
        // that app rule changes.
        frame.style.setProperty('--todoseq-frame-indent', `${indent}px`);
        frame.style.marginLeft = `${indent}px`;
      } catch {
        // Best-effort measurement only; the CSS fallback is used otherwise.
      }
    };

    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(measure);
    } else {
      measure();
    }
  }

  /**
   * Render the full chip row in its fixed logical order: dates first
   * (scheduled, deadline, closed), then the bookkeeping fields, then the
   * description. `includeHidden` controls the CREATED/STARTED chips, which are
   * collapsed behind the "N hidden" toggle unless the frame is expanded.
   */
  private buildActive(
    frame: HTMLElement,
    payload: FramePayload,
    includeHidden: boolean,
  ): void {
    const t = payload.task;
    // Chips live in their own row so a photo card can sit below them.
    const chips = createDiv({ cls: 'todoseq-frame-chips' });
    if (t.scheduledDate) {
      chips.appendChild(
        chip(
          'todoseq-chip-scheduled',
          'calendar',
          DateUtils.formatDateForDisplay(t.scheduledDate),
          payload.tooltips.scheduled ?? 'Scheduled',
          'scheduled',
          payload.taskLine,
        ),
      );
    }
    if (t.deadlineDate) {
      chips.appendChild(
        chip(
          'todoseq-chip-deadline',
          'alarm-clock',
          DateUtils.formatDateForDisplay(t.deadlineDate),
          payload.tooltips.deadline ?? 'Deadline',
          'deadline',
          payload.taskLine,
        ),
      );
    }
    if (t.closedDate) {
      chips.appendChild(
        chip(
          'todoseq-chip-closed',
          'check-circle',
          DateUtils.formatDateForDisplay(t.closedDate, true),
          payload.tooltips.closed ?? 'Closed',
          'closed',
          payload.taskLine,
        ),
      );
    }
    if (includeHidden && t.createdDate) {
      chips.appendChild(
        chip(
          'todoseq-chip-created',
          'calendar-plus',
          DateUtils.formatDateForDisplay(t.createdDate),
          'Created',
          'created',
          payload.taskLine,
        ),
      );
    }
    if (includeHidden && t.startedDate) {
      chips.appendChild(
        chip(
          'todoseq-chip-started',
          'clock',
          DateUtils.formatDateForDisplay(t.startedDate),
          payload.tooltips.started ?? 'Started',
          'started',
          payload.taskLine,
        ),
      );
    }
    const hasPhoto = !!(t.photo && payload.photoSrc);
    // With a photo, the description moves below the image (see below) instead
    // of taking a chip slot in the row.
    if (t.description && !hasPhoto) {
      chips.appendChild(
        chip(
          'todoseq-chip-desc',
          'text',
          t.description,
          payload.tooltips.description ?? t.description,
          'description',
          payload.taskLine,
        ),
      );
    }
    if (payload.variant === 'active' && payload.workLogEnabled === true) {
      this.appendWorkChip(chips, payload);
    }
    if (payload.photosEnabled && !hasPhoto) {
      chips.appendChild(
        chip(
          'todoseq-chip-photo-add',
          'camera',
          '',
          payload.tooltips.photo ?? 'Add photo',
          'photo-add',
          payload.taskLine,
        ),
      );
    }
    frame.appendChild(chips);

    if (!hasPhoto) {
      return;
    }

    // Photo card image sits below the chip row; the description follows it.
    const card = createDiv({
      cls: 'todoseq-frame-photo-card',
      attr: {
        'data-todoseq-action': 'photo',
        'data-todoseq-line': String(payload.taskLine),
        'data-todoseq-photo': t.photo ?? '',
        'aria-label': payload.tooltips.photo ?? 'Photo',
        role: 'button',
        tabindex: '0',
      },
    });
    const img = card.createEl('img', {
      cls: 'todoseq-frame-photo-card-img',
    });
    img.src = payload.photoSrc ?? '';
    img.alt = '';
    img.setAttribute('draggable', 'false');
    frame.appendChild(card);

    if (t.description) {
      // Same chip as the no-photo layout (icon + label, click opens the task
      // editor), just rendered below the photo and allowed to wrap.
      frame.appendChild(
        chip(
          'todoseq-chip-desc todoseq-frame-photo-desc',
          'text',
          t.description,
          payload.tooltips.description ?? t.description,
          'description',
          payload.taskLine,
        ),
      );
    }
  }

  /** Label text for the work chip: elapsed and/or running total. */
  private workLabelText(payload: FramePayload, running: boolean): string {
    const t = payload.task;
    const total = t.workLogTotalMinutes ?? 0;
    if (!running) {
      return total > 0 ? formatDuration(total) : '';
    }
    const elapsed = t.timerStart
      ? Math.max(0, Math.round((Date.now() - t.timerStart.getTime()) / 60000))
      : 0;
    return total > 0
      ? `${formatDuration(elapsed)} \u00b7 ${formatDuration(total)}`
      : formatDuration(elapsed);
  }

  /**
   * Play/pause chip. While a session runs, a 30s interval refreshes only this
   * chip's label (one interval per running frame, cleared on destroy).
   */
  private appendWorkChip(frame: HTMLElement, payload: FramePayload): void {
    const running = !!payload.task.timerStart;
    const chipEl = chip(
      running ? 'todoseq-chip-work-running' : 'todoseq-chip-work',
      running ? 'pause' : 'play',
      this.workLabelText(payload, running),
      running ? 'Pause work session' : 'Start work session',
      running ? 'work-pause' : 'work-start',
      payload.taskLine,
    );
    frame.appendChild(chipEl);

    if (
      running &&
      typeof window !== 'undefined' &&
      typeof window.setInterval === 'function'
    ) {
      const labelEl = chipEl.querySelector<HTMLElement>('.todoseq-chip-label');
      this.workTickIds.push(
        window.setInterval(() => {
          if (labelEl) {
            labelEl.textContent = this.workLabelText(payload, true);
          }
        }, 30000),
      );
    }
  }

  private buildCompleted(frame: HTMLElement, payload: FramePayload): void {
    const t = payload.task;
    if (t.closedDate) {
      frame.appendChild(
        chip(
          'todoseq-chip-closed',
          'check-circle',
          DateUtils.formatDateForDisplay(t.closedDate, true),
          payload.tooltips.closed ?? 'Closed',
          'closed',
          payload.taskLine,
        ),
      );
    }
  }

  private buildRecurring(frame: HTMLElement, payload: FramePayload): void {
    const t = payload.task;
    if (t.scheduledDate) {
      frame.appendChild(
        chip(
          'todoseq-chip-scheduled',
          'calendar',
          DateUtils.formatDateForDisplay(t.scheduledDate),
          payload.tooltips.scheduled ?? 'Next occurrence',
          'scheduled',
          payload.taskLine,
        ),
      );
    }
    if (t.repeatCount != null) {
      frame.appendChild(
        chip(
          'todoseq-chip-repeats',
          'repeat',
          `\u00d7${t.repeatCount} done`,
          payload.tooltips.repeatLog ?? `Repeats: ${t.repeatCount}`,
          'repeats',
          payload.taskLine,
        ),
      );
    }
  }

  private appendExpandHint(
    frame: HTMLElement,
    payload: FramePayload,
    view: EditorView,
  ): void {
    // Active frames only hide CREATED/STARTED; finished frames collapse every
    // field except the completion summary.
    const hidden =
      payload.variant === 'active'
        ? (payload.task.createdDate ? 1 : 0) +
          (payload.task.startedDate ? 1 : 0)
        : payload.metadataLineCount;
    if (hidden <= 0) {
      return;
    }

    const el = createSpan({
      cls: 'todoseq-chip todoseq-chip-expand',
      attr: {
        'data-todoseq-action': 'expand',
        'data-todoseq-line': String(payload.taskLine),
        role: 'button',
        tabindex: '0',
      },
      text: payload.expanded ? `\u25c2 collapse` : `\u25b8 ${hidden} hidden`,
    });
    el.setAttribute(
      'aria-label',
      payload.expanded ? 'Collapse' : 'Show all fields',
    );
    el.addEventListener('click', (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      view.dispatch({
        effects: toggleMetadataFrameEffect.of(payload.taskLine),
      });
    });
    el.addEventListener('keydown', (evt) => {
      if (evt.key !== 'Enter' && evt.key !== ' ') {
        return;
      }
      evt.preventDefault();
      evt.stopPropagation();
      view.dispatch({
        effects: toggleMetadataFrameEffect.of(payload.taskLine),
      });
    });
    frame.appendChild(el);
  }
}
