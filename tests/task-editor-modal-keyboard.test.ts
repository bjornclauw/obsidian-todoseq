/**
 * @jest-environment jsdom
 */

import { Platform } from 'obsidian';
import { installObsidianDomMocks } from './helpers/obsidian-dom-mock';
import {
  TaskEditorInitialValues,
  TaskEditorModal,
} from '../src/view/components/task-editor-modal';
import { createTestKeywordManager } from './helpers/test-helper';

beforeAll(() => {
  installObsidianDomMocks();
});

beforeEach(() => {
  (Platform as unknown as { isMobile: boolean }).isMobile = true;
});

afterEach(() => {
  (Platform as unknown as { isMobile: boolean }).isMobile = false;
  document.documentElement.setCssProps({ '--keyboard-height': '0px' });
  document.querySelectorAll('.modal-container').forEach((el) => el.remove());
});

function makeInitial(): TaskEditorInitialValues {
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
  };
}

function openModal(): TaskEditorModal {
  const modal = new TaskEditorModal({} as never, {
    mode: 'create',
    initial: makeInitial(),
    keywordManager: createTestKeywordManager(),
    weekStartsOn: 'Monday',
    onSubmit: jest.fn(),
    onCancel: jest.fn(),
  });
  modal.open();
  return modal;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('TaskEditorModal mobile keyboard handling (native modal)', () => {
  it('toggles is-keyboard-open with the soft keyboard inset', async () => {
    const modal = openModal();
    const modalEl = document.querySelector(
      '.todoseq-task-editor-modal',
    ) as HTMLElement;
    expect(modalEl).not.toBeNull();
    expect(modalEl.classList.contains('is-keyboard-open')).toBe(false);

    document.documentElement.setCssProps({ '--keyboard-height': '300px' });
    await tick();
    expect(modalEl.classList.contains('is-keyboard-open')).toBe(true);

    // Dismissing the keyboard resets the class without needing a background
    // tap, even though the field may still be focused.
    document.documentElement.setCssProps({ '--keyboard-height': '0px' });
    await tick();
    expect(modalEl.classList.contains('is-keyboard-open')).toBe(false);

    modal.close();
  });

  it('stops watching after close', async () => {
    const modal = openModal();
    modal.close();

    expect(() => {
      document.documentElement.setCssProps({ '--keyboard-height': '300px' });
    }).not.toThrow();
    await tick();
    expect(document.querySelector('.todoseq-task-editor-modal')).toBeNull();
  });
});
