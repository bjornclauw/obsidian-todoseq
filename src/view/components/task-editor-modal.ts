import { setIcon } from 'obsidian';
import { DateRepeatInfo, WarningPeriodInfo } from '../../types/task';
import { KeywordManager } from '../../utils/keyword-manager';
import { DateUtils } from '../../utils/date-utils';
import { TaskComposeFields } from '../../services/task-writer';
import { DatePicker, DatePickerMode } from './date-picker-menu';

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
  /** Called with the composed fields when the user saves. */
  onSubmit: (fields: TaskComposeFields) => void | Promise<void>;
  /** Called when the user cancels or dismisses the modal. */
  onCancel: () => void;
}

/**
 * Mobile-first modal for creating or editing a task.
 *
 * The layout is a centered, near-full-width sheet on phones and a compact
 * dialog on desktop. It exposes the core task fields (text, state, priority,
 * scheduled date, deadline date, description) and reuses the existing
 * DatePicker for date selection. All persistence is delegated to the caller
 * via `onSubmit`, which is expected to route through TaskWriter.
 */
export class TaskEditorModal {
  private modalEl: HTMLElement | null = null;
  private backdropEl: HTMLElement | null = null;
  private datePicker: DatePicker | null = null;

  private scheduledDate: Date | null;
  private scheduledRepeat: DateRepeatInfo | null;
  private scheduledWarningPeriod: WarningPeriodInfo | null;
  private deadlineDate: Date | null;
  private deadlineRepeat: DateRepeatInfo | null;
  private deadlineWarningPeriod: WarningPeriodInfo | null;
  private isClosed = false;
  private dateFieldRefresh: (() => void) | null = null;

  constructor(private options: TaskEditorModalOptions) {
    this.scheduledDate = options.initial.scheduledDate;
    this.scheduledRepeat = options.initial.scheduledRepeat;
    this.scheduledWarningPeriod = options.initial.scheduledWarningPeriod;
    this.deadlineDate = options.initial.deadlineDate;
    this.deadlineRepeat = options.initial.deadlineRepeat;
    this.deadlineWarningPeriod = options.initial.deadlineWarningPeriod;
  }

  open(): void {
    // Create backdrop
    this.backdropEl = activeDocument.body.createDiv({
      cls: 'todoseq-task-editor-backdrop',
    });
    this.backdropEl.addEventListener('click', () => {
      // While the date picker is open, an outside click should only dismiss
      // the date picker and keep the task editor open underneath.
      if (this.datePicker?.isVisible()) {
        this.datePicker.hide();
        return;
      }
      this.cancel();
    });

    // Create modal
    this.modalEl = activeDocument.body.createDiv({
      cls: 'todoseq-task-editor-modal',
      attr: { role: 'dialog', 'aria-modal': 'true' },
    });
    this.modalEl.addEventListener('click', (e) => {
      // When the date picker is open, let the click bubble so the picker's own
      // outside-click handler dismisses it (the task editor stays open). This
      // also respects the picker's mobile ghost-click suppression, which a
      // manual hide() here would bypass.
      if (!this.datePicker?.isVisible()) {
        e.stopPropagation();
      }
    });

    const isEdit = this.options.mode === 'edit';

    // Title bar
    const titleEl = this.modalEl.createDiv({
      cls: 'todoseq-task-editor-title',
    });
    titleEl.createSpan({ text: isEdit ? 'Edit task' : 'New task' });

    const closeBtn = titleEl.createDiv({
      cls: 'todoseq-task-editor-close clickable-icon',
    });
    setIcon(closeBtn, 'x');
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.addEventListener('click', () => this.cancel());

    // Form
    const form = this.modalEl.createDiv({
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

    // Priority
    const priorityGroup = form.createDiv({
      cls: 'todoseq-task-editor-field',
    });
    priorityGroup.createEl('label', { text: 'Priority' });
    const prioritySelect = priorityGroup.createEl('select', {
      cls: 'todoseq-task-editor-priority',
    });
    for (const opt of [
      { value: '', label: 'No priority' },
      { value: 'high', label: 'High (A)' },
      { value: 'med', label: 'Medium (B)' },
      { value: 'low', label: 'Low (C)' },
    ]) {
      prioritySelect.createEl('option', {
        attr: { value: opt.value },
        text: opt.label,
      });
    }
    prioritySelect.value = this.options.initial.priority ?? '';

    // Scheduled date
    this.buildDateField(
      form,
      'Scheduled',
      'scheduled',
      () => this.scheduledDate,
    );

    // Deadline date
    this.buildDateField(form, 'Deadline', 'deadline', () => this.deadlineDate);

    // Description (single line - the plugin stores descriptions as one line)
    const descGroup = form.createDiv({ cls: 'todoseq-task-editor-field' });
    descGroup.createEl('label', { text: 'Description' });
    const descInput = descGroup.createEl('input', {
      cls: 'todoseq-task-editor-description',
      attr: { type: 'text', placeholder: 'Optional notes' },
    });
    descInput.value = this.options.initial.description ?? '';

    // Buttons
    const buttons = this.modalEl.createDiv({
      cls: 'todoseq-task-editor-buttons',
    });
    const cancelBtn = buttons.createEl('button', {
      text: 'Cancel',
      cls: 'todoseq-task-editor-btn-cancel',
    });
    cancelBtn.addEventListener('click', () => this.cancel());
    const saveBtn = buttons.createEl('button', {
      text: isEdit ? 'Save changes' : 'Create task',
      cls: 'todoseq-task-editor-btn-save',
    });
    saveBtn.addEventListener('click', () => {
      void this.submit(textInput, stateSelect, prioritySelect, descInput);
    });

    // Keyboard handling: Enter in the task text submits; Escape cancels.
    textInput.addEventListener('keydown', (e: KeyboardEvent) => {
      textInput.removeClass('todoseq-task-editor-input-error');
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void this.submit(textInput, stateSelect, prioritySelect, descInput);
      }
    });

    descInput.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void this.submit(textInput, stateSelect, prioritySelect, descInput);
      }
    });

    this.modalEl.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.cancel();
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        void this.submit(textInput, stateSelect, prioritySelect, descInput);
      }
    });

    // Focus the task text for immediate typing
    window.setTimeout(() => {
      textInput.focus();
      textInput.setSelectionRange(
        textInput.value.length,
        textInput.value.length,
      );
    }, 50);
  }

  private async submit(
    textInput: HTMLTextAreaElement,
    stateSelect: HTMLSelectElement,
    prioritySelect: HTMLSelectElement,
    descInput: HTMLInputElement,
  ): Promise<void> {
    if (this.isClosed) return;

    const text = textInput.value.trim();
    if (!text) {
      textInput.addClass('todoseq-task-editor-input-error');
      textInput.focus();
      return;
    }

    const priorityValue = prioritySelect.value;
    const fields: TaskComposeFields = {
      text,
      state: stateSelect.value,
      priority:
        priorityValue === 'high' ||
        priorityValue === 'med' ||
        priorityValue === 'low'
          ? priorityValue
          : null,
      scheduledDate: this.scheduledDate,
      scheduledRepeat: this.scheduledRepeat,
      scheduledWarningPeriod: this.scheduledWarningPeriod,
      deadlineDate: this.deadlineDate,
      deadlineRepeat: this.deadlineRepeat,
      deadlineWarningPeriod: this.deadlineWarningPeriod,
      description: descInput.value.trim() || null,
    };

    await this.options.onSubmit(fields);
    this.close();
  }

  private cancel(): void {
    if (this.isClosed) return;
    this.options.onCancel();
    this.close();
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
    });
    const clearBtn = row.createEl('button', {
      cls: 'todoseq-task-editor-date-clear clickable-icon',
      attr: { 'aria-label': `Clear ${label.toLowerCase()}` },
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
        { weekStartsOn: this.options.weekStartsOn },
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
        initial !== 'ARCHIVED'
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

  /** Remove the modal and any associated date picker from the DOM. */
  public close(): void {
    if (this.isClosed) return;
    this.isClosed = true;

    if (this.datePicker) {
      this.datePicker.cleanup();
      this.datePicker = null;
    }
    if (this.modalEl) {
      this.modalEl.remove();
      this.modalEl = null;
    }
    if (this.backdropEl) {
      this.backdropEl.remove();
      this.backdropEl = null;
    }
  }
}
