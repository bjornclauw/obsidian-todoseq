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
  } = {},
): {
  modal: TaskEditorModal;
  onSubmit: jest.Mock;
  onCancel: jest.Mock;
} {
  const onSubmit = overrides.onSubmit ?? jest.fn();
  const onCancel = overrides.onCancel ?? jest.fn();
  const modal = new TaskEditorModal({
    mode: overrides.mode ?? 'create',
    initial: makeInitial(overrides.initial),
    keywordManager: createTestKeywordManager(),
    weekStartsOn: 'Monday',
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
  document.querySelectorAll('.todoseq-task-editor-modal').forEach((el) => {
    el.remove();
  });
  document
    .querySelectorAll('.todoseq-task-editor-backdrop')
    .forEach((el) => el.remove());
  document
    .querySelectorAll('.todoseq-date-picker, .todoseq-backdrop')
    .forEach((el) => el.remove());
});

describe('TaskEditorModal', () => {
  it('renders a create dialog with populated state options', () => {
    openModal();

    expect(query('.todoseq-task-editor-title').textContent).toBe('New task');
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

    expect(query('.todoseq-task-editor-title').textContent).toBe('Edit task');
    expect(query<HTMLTextAreaElement>('.todoseq-task-editor-text').value).toBe(
      'Existing task',
    );
    expect(query<HTMLSelectElement>('.todoseq-task-editor-state').value).toBe(
      'DOING',
    );
    expect(
      query<HTMLSelectElement>('.todoseq-task-editor-priority').value,
    ).toBe('high');
    expect(
      query<HTMLTextAreaElement>('.todoseq-task-editor-description').value,
    ).toBe('Existing notes');
  });

  it('submits the composed fields and closes', async () => {
    const { onSubmit } = openModal();

    query<HTMLTextAreaElement>('.todoseq-task-editor-text').value = 'Buy milk';
    query<HTMLSelectElement>('.todoseq-task-editor-state').value = 'DOING';
    query<HTMLSelectElement>('.todoseq-task-editor-priority').value = 'med';
    query<HTMLTextAreaElement>('.todoseq-task-editor-description').value =
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
    expect(document.querySelector('.todoseq-task-editor-backdrop')).toBeNull();
  });

  it('dismisses an open date picker on backdrop click without closing the task editor', () => {
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

    query<HTMLDivElement>('.todoseq-task-editor-backdrop').click();

    expect(hide).toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    expect(document.querySelector('.todoseq-task-editor-modal')).not.toBeNull();
  });

  it('lets clicks bubble when the date picker is open so it can dismiss itself', () => {
    const { modal, onCancel } = openModal();

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
      hide: jest.fn(),
      cleanup: jest.fn(),
    };

    const documentClick = jest.fn();
    document.addEventListener('click', documentClick);
    query<HTMLDivElement>('.todoseq-task-editor-modal').click();
    document.removeEventListener('click', documentClick);

    // Propagation reached the document, where the picker's outside-click
    // handler lives to dismiss it.
    expect(documentClick).toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    expect(document.querySelector('.todoseq-task-editor-modal')).not.toBeNull();
  });

  it('stops propagation on clicks when no date picker is open', () => {
    openModal();

    const documentClick = jest.fn();
    document.addEventListener('click', documentClick);
    query<HTMLDivElement>('.todoseq-task-editor-modal').click();
    document.removeEventListener('click', documentClick);

    expect(documentClick).not.toHaveBeenCalled();
  });

  it('opens the date picker and closes it again when the task editor is clicked', async () => {
    openModal();

    query<HTMLButtonElement>('.todoseq-task-editor-date-btn').click();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(document.querySelector('.todoseq-date-picker')).not.toBeNull();

    query<HTMLDivElement>('.todoseq-task-editor-modal').click();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(document.querySelector('.todoseq-date-picker')).toBeNull();
    expect(document.querySelector('.todoseq-task-editor-modal')).not.toBeNull();
  });
});
