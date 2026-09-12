import { App, Modal, Platform, setIcon, setTooltip } from 'obsidian';
import { DateRepeatInfo, WarningPeriodInfo } from '../../types/task';
import { KeywordManager } from '../../utils/keyword-manager';
import { DateUtils } from '../../utils/date-utils';
import { KeyboardInsetWatcher } from '../../utils/keyboard-inset';
import { TaskComposeFields } from '../../services/task-writer';
import { DatePicker, DatePickerMode } from './date-picker-menu';

/** Delay before focusing the task text, to let the modal finish opening. */
const FOCUS_DELAY_MS = 50;
/** Delay before scrolling a focused field into view, after the keyboard settles. */
const KEYBOARD_SETTLE_MS = 320;

/** Priority flag options, mirroring the task context menu. */
const PRIORITY_OPTIONS: ReadonlyArray<{
  icon: string;
  label: string;
  priority: 'high' | 'med' | 'low' | null;
  colorClass: string;
}> = [
  {
    icon: 'flag',
    label: 'Priority A (high)',
    priority: 'high',
    colorClass: 'todoseq-priority-high',
  },
  {
    icon: 'flag',
    label: 'Priority B (medium)',
    priority: 'med',
    colorClass: 'todoseq-priority-med',
  },
  {
    icon: 'flag',
    label: 'Priority C (low)',
    priority: 'low',
    colorClass: 'todoseq-priority-low',
  },
  {
    icon: 'flag-off',
    label: 'No priority',
    priority: null,
    colorClass: 'todoseq-priority-none',
  },
];

/** Initial field values used to pre-fill the task editor form. */
export interface TaskEditorInitialValues {
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
}

export interface TaskEditorModalOptions {
  /** Whether the modal creates a new task or edits an existing one. */
  mode: 'create' | 'edit';
  /** Values to pre-fill the form with. */
  initial: TaskEditorInitialValues;
  /** KeywordManager used to populate state options. */
  keywordManager: KeywordManager;
  /** Controls the day the date picker's week starts on. */
  weekStartsOn: 'Monday' | 'Sunday';
  /**
   * True when editing a markdown table cell task. Such tasks cannot store a
   * DESCRIPTION line and do not support recurrence, so those fields are hidden.
   */
  isTableTask?: boolean;
  /** Called with the composed fields when the user saves. */
  onSubmit: (fields: TaskComposeFields) => void | Promise<void>;
  /** Called when the user cancels or dismisses the modal. */
  onCancel: () => void;
}

/**
 * Mobile-first modal for creating or editing a task, built on Obsidian's
 * native `Modal`.
 *
 * Using the native modal gives us Obsidian's own backdrop, Escape handling,
 * focus management and mobile dialog CSS for free. The form lives in
 * `contentEl` (`.modal-content`), with the action buttons sticky at the
 * bottom; the mobile keyboard fix is handled in CSS by padding the scroll
 * container while a text field is focused (see styles.css).
 *
 * All persistence is delegated to the caller via `onSubmit`, which is
 * expected to route through TaskWriter.
 */
export class TaskEditorModal extends Modal {
  private datePicker: DatePicker | null = null;

  private scheduledDate: Date | null;
  private scheduledRepeat: DateRepeatInfo | null;
  private scheduledWarningPeriod: WarningPeriodInfo | null;
  private deadlineDate: Date | null;
  private deadlineRepeat: DateRepeatInfo | null;
  private deadlineWarningPeriod: WarningPeriodInfo | null;
  private priority: 'high' | 'med' | 'low' | null;
  private priorityButtons: Array<{
    priority: 'high' | 'med' | 'low' | null;
    btn: HTMLButtonElement;
  }> = [];
  private dateFieldRefresh: (() => void) | null = null;
  /** True once the user saved, so onClose doesn't report a cancel. */
  private submitted = false;
  /** True once the modal is closing/closed, to ignore deferred callbacks. */
  private closed = false;
  private stopKeyboardWatch: (() => void) | null = null;

  constructor(
    app: App,
    private options: TaskEditorModalOptions,
  ) {
    super(app);
    this.scheduledDate = options.initial.scheduledDate;
    this.scheduledRepeat = options.initial.scheduledRepeat;
    this.scheduledWarningPeriod = options.initial.scheduledWarningPeriod;
    this.deadlineDate = options.initial.deadlineDate;
    this.deadlineRepeat = options.initial.deadlineRepeat;
    this.deadlineWarningPeriod = options.initial.deadlineWarningPeriod;
    this.priority = options.initial.priority;
  }

  onOpen(): void {
    const isEdit = this.options.mode === 'edit';
    this.setTitle(isEdit ? 'Edit task' : 'New task');
    this.modalEl.addClass('todoseq-task-editor-modal');

    // While the date picker is open, clicking the modal background should only
    // dismiss the picker, not the whole editor. Capture phase so this runs
    // before Obsidian's own background-click close handler.
    const bg = this.containerEl.querySelector('.modal-bg');
    bg?.addEventListener(
      'click',
      (evt) => {
        if (this.datePicker?.isVisible()) {
          evt.stopImmediatePropagation();
          this.datePicker.hide();
        }
      },
      true,
    );

    const form = this.contentEl.createDiv({
      cls: 'todoseq-task-editor-form',
    });

    // Task text (required)
    const textGroup = form.createDiv({ cls: 'todoseq-task-editor-field' });
    textGroup.createEl('label', { text: 'Task' });
    const textInput = textGroup.createEl('textarea', {
      cls: 'todoseq-task-editor-text',
      attr: {
        rows: '2',
        placeholder: 'What needs to be done?',
      },
    });
    textInput.value = this.options.initial.text;

    // State keyword
    const stateGroup = form.createDiv({ cls: 'todoseq-task-editor-field' });
    stateGroup.createEl('label', { text: 'State' });
    const stateSelect = stateGroup.createEl('select', {
      cls: 'todoseq-task-editor-state',
    });
    this.populateStateOptions(stateSelect);

    // Priority (icon flags, matching the task context menu)
    const priorityGroup = form.createDiv({
      cls: 'todoseq-task-editor-field',
    });
    priorityGroup.createEl('label', { text: 'Priority' });
    const priorityRow = priorityGroup.createDiv({
      cls: 'todoseq-task-editor-priority-row',
      attr: { role: 'radiogroup', 'aria-label': 'Priority' },
    });
    for (const option of PRIORITY_OPTIONS) {
      const btn = priorityRow.createEl('button', {
        cls: [
          'todoseq-context-menu-icon-btn',
          'todoseq-task-editor-priority-btn',
          option.colorClass,
        ],
        attr: {
          type: 'button',
          role: 'radio',
          'aria-label': option.label,
        },
      });
      setTooltip(btn, option.label);
      const iconEl = btn.createSpan({ cls: 'todoseq-context-menu-icon' });
      setIcon(iconEl, option.icon);
      btn.addEventListener('click', () => {
        this.priority = option.priority;
        this.updatePriorityButtons();
      });
      this.priorityButtons.push({ priority: option.priority, btn });
    }
    this.updatePriorityButtons();

    // Scheduled date
    this.buildDateField(
      form,
      'Scheduled',
      'scheduled',
      () => this.scheduledDate,
    );

    // Deadline date
    this.buildDateField(form, 'Deadline', 'deadline', () => this.deadlineDate);

    // Description (single line - the plugin stores descriptions as one line).
    // Table-cell tasks cannot store a DESCRIPTION line, so the field is hidden.
    let descInput: HTMLInputElement | null = null;
    if (!this.options.isTableTask) {
      const descGroup = form.createDiv({ cls: 'todoseq-task-editor-field' });
      descGroup.createEl('label', { text: 'Description' });
      descInput = descGroup.createEl('input', {
        cls: 'todoseq-task-editor-description',
        attr: { type: 'text', placeholder: 'Optional notes' },
      });
      descInput.value = this.options.initial.description ?? '';
    }

    // Buttons (sticky at the bottom of the scroll container)
    const buttons = form.createDiv({
      cls: 'todoseq-task-editor-buttons',
    });
    const cancelBtn = buttons.createEl('button', {
      text: 'Cancel',
      cls: 'todoseq-task-editor-btn-cancel',
    });
    cancelBtn.addEventListener('click', () => this.close());
    const saveBtn = buttons.createEl('button', {
      text: isEdit ? 'Save changes' : 'Create task',
      cls: 'todoseq-task-editor-btn-save',
    });
    saveBtn.addEventListener('click', () => {
      void this.submit(textInput, stateSelect, descInput);
    });

    // Keyboard handling: Enter in the task text submits.
    textInput.addEventListener('keydown', (e: KeyboardEvent) => {
      textInput.removeClass('todoseq-task-editor-input-error');
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void this.submit(textInput, stateSelect, descInput);
      }
    });

    descInput?.addEventListener('keydown', (e: KeyboardEvent) => {
      // Descriptions are single-line, but Enter/Shift+Enter should not
      // submit the form from this field.
      if (e.key === 'Enter') {
        e.preventDefault();
      }
    });

    // Ctrl/Cmd+Enter submits from anywhere in the form.
    this.contentEl.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        void this.submit(textInput, stateSelect, descInput);
      }
    });

    // Focus the task text for immediate typing. Use the modal's own window so
    // popout windows work; on mobile the content scrolls the field clear of the
    // keyboard once Obsidian's modal finishes opening.
    const win = this.modalEl?.ownerDocument.defaultView ?? window;
    win.setTimeout(() => {
      if (this.closed) return;
      textInput.focus({ preventScroll: true });
      textInput.setSelectionRange(
        textInput.value.length,
        textInput.value.length,
      );
    }, FOCUS_DELAY_MS);

    if (Platform.isMobile) {
      const fields = descInput ? [textInput, descInput] : [textInput];
      for (const field of fields) {
        field.addEventListener('focus', () => this.scrollFieldIntoView(field));
      }
      // Drive the keyboard allowance from an explicit class rather than
      // :has(:focus). Dismissing the soft keyboard (system back/gesture) often
      // leaves the field focused, which would otherwise keep the allowance and
      // the shifted layout until a background tap blurs it.
      this.stopKeyboardWatch = new KeyboardInsetWatcher().start(win, (inset) =>
        this.applyKeyboardInset(inset),
      );
    }
  }

  /** Toggle the mobile keyboard allowance on the modal. */
  private applyKeyboardInset(inset: number): void {
    const modalEl = this.modalEl;
    if (!modalEl) return;
    const wasOpen = modalEl.hasClass('is-keyboard-open');
    modalEl.toggleClass('is-keyboard-open', inset > 0);
    if (wasOpen && inset === 0) {
      // Force the scroll container to re-clamp now the padding is gone so the
      // sheet snaps back without waiting for a background tap.
      const max = this.contentEl.scrollHeight - this.contentEl.clientHeight;
      this.contentEl.scrollTop = Math.max(
        0,
        Math.min(this.contentEl.scrollTop, max),
      );
    }
  }

  onClose(): void {
    this.closed = true;
    if (this.stopKeyboardWatch) {
      this.stopKeyboardWatch();
      this.stopKeyboardWatch = null;
    }
    if (this.datePicker) {
      this.datePicker.cleanup();
      this.datePicker = null;
    }
    this.contentEl.empty();
    if (!this.submitted) {
      this.options.onCancel();
    }
  }

  private async submit(
    textInput: HTMLTextAreaElement,
    stateSelect: HTMLSelectElement,
    descInput: HTMLInputElement | null,
  ): Promise<void> {
    const text = textInput.value.trim();
    if (!text) {
      textInput.addClass('todoseq-task-editor-input-error');
      textInput.focus();
      return;
    }

    const fields: TaskComposeFields = {
      text,
      state: stateSelect.value,
      priority: this.priority,
      scheduledDate: this.scheduledDate,
      scheduledRepeat: this.scheduledRepeat,
      scheduledWarningPeriod: this.scheduledWarningPeriod,
      deadlineDate: this.deadlineDate,
      deadlineRepeat: this.deadlineRepeat,
      deadlineWarningPeriod: this.deadlineWarningPeriod,
      description: descInput?.value.trim() || null,
    };

    this.submitted = true;
    try {
      await this.options.onSubmit(fields);
    } catch (error) {
      // Keep the modal open so the user can retry; the caller reports the error.
      this.submitted = false;
      console.error('Failed to save task', error);
      return;
    }
    this.close();
  }

  /** Reflect the selected priority on the flag buttons. */
  private updatePriorityButtons(): void {
    for (const { priority, btn } of this.priorityButtons) {
      const selected = priority === this.priority;
      btn.toggleClass('is-selected', selected);
      btn.setAttr('aria-checked', String(selected));
    }
  }

  /**
   * Bring a focused field into view once the keyboard animation has settled.
   */
  private scrollFieldIntoView(field: HTMLElement): void {
    const win = this.modalEl?.ownerDocument.defaultView ?? window;
    win.setTimeout(() => {
      if (this.closed) return;
      if (typeof field.scrollIntoView === 'function') {
        field.scrollIntoView({ block: 'nearest' });
      }
    }, KEYBOARD_SETTLE_MS);
  }

  /** Build a date field row with a date button and a clear button. */
  private buildDateField(
    parent: HTMLElement,
    label: string,
    mode: DatePickerMode,
    getDate: () => Date | null,
  ): void {
    const group = parent.createDiv({ cls: 'todoseq-task-editor-field' });
    group.createEl('label', { text: label });
    const row = group.createDiv({ cls: 'todoseq-task-editor-date-row' });

    const dateBtn = row.createEl('button', {
      cls: 'todoseq-task-editor-date-btn',
      attr: { type: 'button' },
    });
    const clearBtn = row.createEl('button', {
      cls: 'todoseq-task-editor-date-clear clickable-icon',
      attr: { type: 'button', 'aria-label': `Clear ${label.toLowerCase()}` },
    });
    setIcon(clearBtn, 'x');

    const refresh = (): void => {
      const date = getDate();
      dateBtn.toggleClass('is-empty', !date);
      dateBtn.setText(date ? DateUtils.formatDateForDisplay(date) : 'Set date');
      clearBtn.toggleClass('is-hidden', !date);
    };
    refresh();

    dateBtn.addEventListener('click', () => {
      const rect = dateBtn.getBoundingClientRect();
      void this.showDatePicker(mode, rect, refresh);
    });

    clearBtn.addEventListener('click', () => {
      if (mode === 'scheduled') {
        this.scheduledDate = null;
        this.scheduledRepeat = null;
        this.scheduledWarningPeriod = null;
      } else {
        this.deadlineDate = null;
        this.deadlineRepeat = null;
        this.deadlineWarningPeriod = null;
      }
      refresh();
    });
  }

  /** Open the shared DatePicker, anchored to the tapped field. */
  private async showDatePicker(
    mode: DatePickerMode,
    anchor: DOMRect,
    onChanged: () => void,
  ): Promise<void> {
    // Track which field's refresh callback the picker should invoke.
    this.dateFieldRefresh = onChanged;

    if (!this.datePicker) {
      this.datePicker = new DatePicker(
        {
          onDateSelected: (date, repeat, selectedMode, warningPeriod) => {
            if (selectedMode === 'deadline') {
              this.deadlineDate = date;
              this.deadlineRepeat = repeat;
              this.deadlineWarningPeriod = warningPeriod ?? null;
            } else {
              this.scheduledDate = date;
              this.scheduledRepeat = repeat;
              this.scheduledWarningPeriod = warningPeriod ?? null;
            }
            this.dateFieldRefresh?.();
          },
        },
        {
          weekStartsOn: this.options.weekStartsOn,
          allowRepeat: !this.options.isTableTask,
          // Keep the picker inside the modal so Obsidian's modal focus trap
          // does not pull focus back when typing in its inputs.
          parentEl: this.containerEl,
        },
      );
    }

    const initialDate =
      mode === 'deadline' ? this.deadlineDate : this.scheduledDate;
    const initialRepeat =
      mode === 'deadline' ? this.deadlineRepeat : this.scheduledRepeat;
    const initialWarningPeriod =
      mode === 'deadline'
        ? this.deadlineWarningPeriod
        : this.scheduledWarningPeriod;

    try {
      await this.datePicker.show(
        { x: anchor.left, y: anchor.bottom + 4 },
        mode,
        initialDate,
        initialRepeat,
        initialWarningPeriod,
      );
    } catch (error) {
      console.error('Failed to show date picker', error);
    }
  }

  /** Populate the state select with keyword groups, skipping duplicates. */
  private populateStateOptions(select: HTMLSelectElement): void {
    const km = this.options.keywordManager;
    const groups: Array<{
      group: Parameters<KeywordManager['getKeywordsForGroup']>[0];
      label: string;
    }> = [
      { group: 'inactiveKeywords', label: 'To do' },
      { group: 'activeKeywords', label: 'In progress' },
      { group: 'waitingKeywords', label: 'Waiting' },
      { group: 'completedKeywords', label: 'Done' },
      { group: 'archivedKeywords', label: 'Archived' },
    ];

    const initial = this.options.initial.state;
    const seen = new Set<string>();
    let matchedInitial = false;

    for (const { group, label } of groups) {
      const keywords = km.getKeywordsForGroup(group);
      if (keywords.length === 0) continue;

      // For new tasks, don't offer archived states.
      if (
        group === 'archivedKeywords' &&
        this.options.mode === 'create' &&
        !this.options.keywordManager.isArchived(initial)
      ) {
        continue;
      }

      const optgroup = select.createEl('optgroup', { attr: { label } });
      for (const keyword of keywords) {
        if (seen.has(keyword)) continue;
        seen.add(keyword);
        const option = optgroup.createEl('option', {
          attr: { value: keyword },
          text: keyword,
        });
        if (keyword === initial) {
          option.selected = true;
          matchedInitial = true;
        }
      }
    }

    if (matchedInitial) return;

    // Fallback: preserve an unknown/legacy state so editing doesn't silently
    // change it.
    const fallbackGroup = select.createEl('optgroup', {
      attr: { label: 'Current' },
    });
    fallbackGroup.createEl('option', {
      attr: { value: initial },
      text: initial,
    });
    select.value = initial;
  }
}
