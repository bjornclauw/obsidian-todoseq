/**
 * @jest-environment jsdom
 */

import { installObsidianDomMocks } from './helpers/obsidian-dom-mock';
import {
  TaskEditorInitialValues,
  TaskEditorModal,
} from '../src/view/components/task-editor-modal';
import { createTestKeywordManager } from './helpers/test-helper';

beforeAll(() => {
  installObsidianDomMocks();
  HTMLElement.prototype.scrollIntoView = jest.fn();
});

function makeInitial(
  overrides: Partial<TaskEditorInitialValues> = {},
): TaskEditorInitialValues {
  return {
    text: '',
    state: 'TODO',
    priority: null,
    scheduledDate: null,
    scheduledRepeat: null,
    scheduledWarningPeriod: null,
    deadlineDate: null,
    deadlineRepeat: null,
    deadlineWarningPeriod: null,
    description: null,
    ...overrides,
  };
}

function openModal(
  overrides: {
    mode?: 'create' | 'edit';
    initial?: Partial<TaskEditorInitialValues>;
    onSubmit?: jest.Mock;
    onCancel?: jest.Mock;
    isTableTask?: boolean;
    listMarker?: 'checkbox' | 'bullet' | 'none';
    onListMarkerChange?: jest.Mock;
  } = {},
): {
  modal: TaskEditorModal;
  onSubmit: jest.Mock;
  onCancel: jest.Mock;
} {
  const onSubmit = overrides.onSubmit ?? jest.fn();
  const onCancel = overrides.onCancel ?? jest.fn();
  const modal = new TaskEditorModal({} as never, {
    mode: overrides.mode ?? 'create',
    initial: makeInitial(overrides.initial),
    keywordManager: createTestKeywordManager(),
    weekStartsOn: 'Monday',
    isTableTask: overrides.isTableTask,
    listMarker: overrides.listMarker,
    onListMarkerChange: overrides.onListMarkerChange,
    onSubmit,
    onCancel,
  });
  modal.open();
  return { modal, onSubmit, onCancel };
}

function query<T extends Element>(selector: string): T {
  const el = document.querySelector(selector);
  if (!el) throw new Error(`Expected element ${selector}`);
  return el as T;
}

afterEach(() => {
  document.querySelectorAll('.modal-container').forEach((el) => el.remove());
  document
    .querySelectorAll('.todoseq-date-picker, .todoseq-backdrop')
    .forEach((el) => el.remove());
});

describe('TaskEditorModal (native Modal)', () => {
  it('renders a native modal shell with populated state options', () => {
    openModal();

    expect(document.querySelector('.modal-container')).not.toBeNull();
    expect(document.querySelector('.todoseq-task-editor-modal')).not.toBeNull();
    expect(query('.todoseq-task-editor-modal .modal-title').textContent).toBe(
      'New task',
    );

    const stateSelect = query<HTMLSelectElement>('.todoseq-task-editor-state');
    expect(stateSelect.value).toBe('TODO');
    expect(Array.from(stateSelect.options).map((o) => o.value)).toContain(
      'DOING',
    );
  });

  it('renders an edit dialog and pre-fills fields', () => {
    openModal({
      mode: 'edit',
      initial: {
        text: 'Existing task',
        state: 'DOING',
        priority: 'high',
        description: 'Existing notes',
      },
    });

    expect(query('.todoseq-task-editor-modal .modal-title').textContent).toBe(
      'Edit task',
    );
    expect(query<HTMLTextAreaElement>('.todoseq-task-editor-text').value).toBe(
      'Existing task',
    );
    expect(query<HTMLSelectElement>('.todoseq-task-editor-state').value).toBe(
      'DOING',
    );
    expect(
      query<HTMLButtonElement>('.todoseq-priority-high').classList.contains(
        'is-selected',
      ),
    ).toBe(true);
    expect(
      query<HTMLInputElement>('.todoseq-task-editor-description').value,
    ).toBe('Existing notes');
  });

  it('renders four priority flag options and updates the selection', () => {
    openModal();

    const options = document.querySelectorAll(
      '.todoseq-task-editor-priority-row button',
    );
    expect(options.length).toBe(4);

    const high = query<HTMLButtonElement>('.todoseq-priority-high');
    const med = query<HTMLButtonElement>('.todoseq-priority-med');
    const none = query<HTMLButtonElement>('.todoseq-priority-none');

    expect(none.classList.contains('is-selected')).toBe(true);

    med.click();
    expect(med.classList.contains('is-selected')).toBe(true);
    expect(none.classList.contains('is-selected')).toBe(false);
    expect(high.classList.contains('is-selected')).toBe(false);
  });

  it('renders three list-marker options and selects the provided marker', () => {
    openModal({ listMarker: 'bullet' });

    const options = document.querySelectorAll(
      '.todoseq-task-editor-marker-row button',
    );
    expect(options.length).toBe(3);
    expect(
      query('.todoseq-marker-bullet').classList.contains('is-selected'),
    ).toBe(true);
    expect(
      query('.todoseq-marker-checkbox').classList.contains('is-selected'),
    ).toBe(false);
  });

  it('updates the marker selection and notifies the caller to persist it', () => {
    const onListMarkerChange = jest.fn();
    openModal({ listMarker: 'checkbox', onListMarkerChange });

    query<HTMLButtonElement>('.todoseq-marker-none').click();

    expect(
      query('.todoseq-marker-none').classList.contains('is-selected'),
    ).toBe(true);
    expect(
      query('.todoseq-marker-checkbox').classList.contains('is-selected'),
    ).toBe(false);
    expect(onListMarkerChange).toHaveBeenCalledWith('none');
  });

  it('submits the selected listMarker', async () => {
    const onSubmit = jest.fn();
    openModal({ onSubmit, listMarker: 'bullet' });

    query<HTMLTextAreaElement>('.todoseq-task-editor-text').value = 'Buy milk';
    query<HTMLButtonElement>('.todoseq-task-editor-btn-save').click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ listMarker: 'bullet' }),
    );
  });

  it('hides the list-marker control when editing an existing task', () => {
    openModal({ mode: 'edit' });

    expect(
      document.querySelector('.todoseq-task-editor-marker-row'),
    ).toBeNull();
  });

  it('renders the description as a single-line input', () => {
    openModal();

    const desc = query<HTMLElement>('.todoseq-task-editor-description');
    expect(desc.tagName).toBe('INPUT');
    expect(desc.getAttribute('rows')).toBeNull();
  });

  it('hides the description field for table-cell tasks', () => {
    openModal({ isTableTask: true });

    expect(
      document.querySelector('.todoseq-task-editor-description'),
    ).toBeNull();
    // The rest of the form still renders.
    expect(document.querySelector('.todoseq-task-editor-text')).not.toBeNull();
  });

  it('does not submit on Enter or Shift+Enter in the description field', async () => {
    const { onSubmit } = openModal();

    query<HTMLTextAreaElement>('.todoseq-task-editor-text').value = 'Buy milk';
    const desc = query<HTMLInputElement>('.todoseq-task-editor-description');
    desc.value = 'From the store';
    desc.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
    desc.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        shiftKey: true,
        bubbles: true,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(document.querySelector('.todoseq-task-editor-modal')).not.toBeNull();
  });

  it('submits the composed fields and closes', async () => {
    const { onSubmit, onCancel } = openModal();

    query<HTMLTextAreaElement>('.todoseq-task-editor-text').value = 'Buy milk';
    query<HTMLSelectElement>('.todoseq-task-editor-state').value = 'DOING';
    query<HTMLButtonElement>('.todoseq-priority-med').click();
    query<HTMLInputElement>('.todoseq-task-editor-description').value =
      'From the store';

    query<HTMLButtonElement>('.todoseq-task-editor-btn-save').click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'Buy milk',
        state: 'DOING',
        priority: 'med',
        description: 'From the store',
        scheduledDate: null,
        deadlineDate: null,
      }),
    );
    expect(onCancel).not.toHaveBeenCalled();
    expect(document.querySelector('.todoseq-task-editor-modal')).toBeNull();
  });

  it('blocks submission when the task text is empty', () => {
    const { onSubmit } = openModal();

    const textarea = query<HTMLTextAreaElement>('.todoseq-task-editor-text');
    textarea.value = '   ';
    query<HTMLButtonElement>('.todoseq-task-editor-btn-save').click();

    expect(onSubmit).not.toHaveBeenCalled();
    expect(textarea.classList.contains('todoseq-task-editor-input-error')).toBe(
      true,
    );
    expect(document.querySelector('.todoseq-task-editor-modal')).not.toBeNull();
  });

  it('cancels and removes the modal', () => {
    const { onCancel } = openModal();

    query<HTMLButtonElement>('.todoseq-task-editor-btn-cancel').click();

    expect(onCancel).toHaveBeenCalled();
    expect(document.querySelector('.todoseq-task-editor-modal')).toBeNull();
  });

  it('dismisses an open date picker on background click without closing the editor', () => {
    const { modal, onCancel } = openModal();

    const hide = jest.fn();
    (
      modal as unknown as {
        datePicker: {
          isVisible: () => boolean;
          hide: () => void;
          cleanup: () => void;
        };
      }
    ).datePicker = {
      isVisible: () => true,
      hide,
      cleanup: jest.fn(),
    };

    query<HTMLDivElement>('.modal-bg').click();

    expect(hide).toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    expect(document.querySelector('.todoseq-task-editor-modal')).not.toBeNull();
  });

  it('opens the date picker and closes it again when the editor is clicked', async () => {
    openModal();

    query<HTMLButtonElement>('.todoseq-task-editor-date-btn').click();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(document.querySelector('.todoseq-date-picker')).not.toBeNull();

    query<HTMLDivElement>('.todoseq-task-editor-modal').click();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(document.querySelector('.todoseq-date-picker')).toBeNull();
    expect(document.querySelector('.todoseq-task-editor-modal')).not.toBeNull();
  });

  it('appends the date picker inside the modal container', async () => {
    openModal();

    query<HTMLButtonElement>('.todoseq-task-editor-date-btn').click();
    await new Promise((resolve) => setTimeout(resolve, 10));

    const picker = document.querySelector('.todoseq-date-picker');
    expect(picker).not.toBeNull();
    expect(
      document.querySelector('.modal-container .todoseq-date-picker'),
    ).toBe(picker);
  });

  it('focuses the custom repeat input opened from the modal', async () => {
    openModal();

    query<HTMLButtonElement>('.todoseq-task-editor-date-btn').click();
    await new Promise((resolve) => setTimeout(resolve, 10));

    const repeatRow = query<HTMLElement>(
      '.todoseq-date-picker-repeat .todoseq-date-picker-menu-row',
    );
    repeatRow.click();
    const customRow = document.querySelectorAll(
      '.todoseq-date-picker-submenu-row',
    )[4] as HTMLElement;
    customRow.click();

    const input = document.querySelector(
      '.todoseq-date-picker-custom-repeat-value-input',
    );
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);
  });
});
