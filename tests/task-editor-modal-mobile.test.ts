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
  HTMLElement.prototype.scrollIntoView = jest.fn();
});

beforeEach(() => {
  (Platform as unknown as { isMobile: boolean }).isMobile = true;
});

afterEach(() => {
  (Platform as unknown as { isMobile: boolean }).isMobile = false;
  document.documentElement.style.removeProperty('--keyboard-height');
  document
    .querySelectorAll(
      '.todoseq-task-editor-modal, .todoseq-task-editor-backdrop',
    )
    .forEach((el) => el.remove());
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
  const modal = new TaskEditorModal({
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

describe('TaskEditorModal mobile keyboard handling', () => {
  it('offsets the sheet above the soft keyboard', async () => {
    const modal = openModal();
    const modalEl = document.querySelector(
      '.todoseq-task-editor-modal',
    ) as HTMLElement;

    document.documentElement.setCssProps({ '--keyboard-height': '300px' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(modalEl.style.getPropertyValue('--todoseq-keyboard-height')).toBe(
      '300px',
    );
    expect(modalEl.classList.contains('is-keyboard-open')).toBe(true);

    modal.close();
  });

  it('resets the offset when the keyboard closes', async () => {
    const modal = openModal();
    const modalEl = document.querySelector(
      '.todoseq-task-editor-modal',
    ) as HTMLElement;

    document.documentElement.setCssProps({ '--keyboard-height': '300px' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(modalEl.classList.contains('is-keyboard-open')).toBe(true);

    document.documentElement.style.removeProperty('--keyboard-height');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(modalEl.style.getPropertyValue('--todoseq-keyboard-height')).toBe(
      '0px',
    );
    expect(modalEl.classList.contains('is-keyboard-open')).toBe(false);

    modal.close();
  });

  it('stops watching the keyboard after close', async () => {
    const modal = openModal();
    modal.close();

    expect(() => {
      document.documentElement.setCssProps({ '--keyboard-height': '300px' });
    }).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector('.todoseq-task-editor-modal')).toBeNull();
  });
});
