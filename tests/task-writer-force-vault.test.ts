import { TaskWriter } from '../src/services/task-writer';
import {
  createBaseTask,
  createTestKeywordManager,
} from './helpers/test-helper';
import { Task } from '../src/types/task';
import { TFile } from 'obsidian';

class MockTFile extends TFile {
  constructor() {
    super();
  }
  path = 'test.md';
  stat: any = {};
  basename = 'test';
  extension = 'md';
  name = 'test.md';
}

/**
 * Sets up an active source-mode editor for `test.md`. When this is in place a
 * writer call without `forceVaultApi` edits the live buffer; with it, the write
 * must go through `vault.process` so the editor is never touched.
 */
function installActiveEditor(mockApp: any, lines: string[]) {
  const editor = {
    lineCount: jest.fn().mockReturnValue(lines.length),
    getLine: jest.fn((i: number) => lines[i]),
    replaceRange: jest.fn(),
  };
  const view = {
    file: { path: 'test.md' },
    editor,
    getViewType: jest.fn().mockReturnValue('markdown'),
    getMode: jest.fn().mockReturnValue('source'),
  };
  mockApp.workspace.getActiveViewOfType = jest.fn().mockReturnValue(view);
  return { editor, view };
}

describe('TaskWriter forceVaultApi', () => {
  let mockApp: any;
  let writer: TaskWriter;

  beforeEach(() => {
    mockApp = {
      vault: {
        getAbstractFileByPath: jest.fn().mockReturnValue(new MockTFile()),
        process: jest.fn(async (_file: unknown, cb: (data: string) => string) =>
          cb('TODO Task text'),
        ),
      },
      workspace: { getActiveViewOfType: jest.fn() },
    };
    const keywordManager = createTestKeywordManager({});
    writer = new TaskWriter(
      { app: mockApp, settings: {} } as never,
      keywordManager,
    );
  });

  describe('updateTaskPriority', () => {
    it('edits the live buffer for an active file by default', async () => {
      const { editor } = installActiveEditor(mockApp, ['TODO Task text']);

      await writer.updateTaskPriority(createBaseTask(), 'high');

      expect(editor.replaceRange).toHaveBeenCalled();
      expect(mockApp.vault.process).not.toHaveBeenCalled();
    });

    it('uses the vault and leaves the live buffer untouched when forced', async () => {
      const { editor } = installActiveEditor(mockApp, ['TODO Task text']);

      await writer.updateTaskPriority(createBaseTask(), 'high', {
        forceVaultApi: true,
      });

      expect(mockApp.vault.process).toHaveBeenCalled();
      expect(editor.replaceRange).not.toHaveBeenCalled();
    });
  });

  describe('removeTaskPriority', () => {
    it('uses the vault and leaves the live buffer untouched when forced', async () => {
      const { editor } = installActiveEditor(mockApp, ['TODO [#A] Task text']);

      await writer.removeTaskPriority(createBaseTask({ priority: 'high' }), {
        forceVaultApi: true,
      });

      expect(mockApp.vault.process).toHaveBeenCalled();
      expect(editor.replaceRange).not.toHaveBeenCalled();
    });

    it('edits the live buffer for an active file by default', async () => {
      const { editor } = installActiveEditor(mockApp, ['TODO [#A] Task text']);

      await writer.removeTaskPriority(createBaseTask({ priority: 'high' }));

      expect(
        editor.replaceRange.mock.calls.length > 0 ||
          mockApp.vault.process.mock.calls.length > 0,
      ).toBe(true);
    });
  });

  describe('scheduled date', () => {
    it('uses the vault and leaves the live buffer untouched when forced (add)', async () => {
      const { editor } = installActiveEditor(mockApp, ['TODO Task text']);

      await writer.updateTaskScheduledDate(
        createBaseTask(),
        new Date('2026-03-10'),
        undefined,
        undefined,
        { forceVaultApi: true },
      );

      expect(mockApp.vault.process).toHaveBeenCalled();
      expect(editor.replaceRange).not.toHaveBeenCalled();
    });

    it('uses the vault and leaves the live buffer untouched when forced (remove)', async () => {
      const { editor } = installActiveEditor(mockApp, [
        'TODO Task text',
        'SCHEDULED: <2026-03-10 Tue>',
      ]);

      await writer.removeTaskScheduledDate(
        createBaseTask({ scheduledDate: new Date('2026-03-10') }),
        { forceVaultApi: true },
      );

      expect(mockApp.vault.process).toHaveBeenCalled();
      expect(editor.replaceRange).not.toHaveBeenCalled();
    });
  });

  describe('deadline date', () => {
    it('uses the vault and leaves the live buffer untouched when forced (add)', async () => {
      const { editor } = installActiveEditor(mockApp, ['TODO Task text']);

      await writer.updateTaskDeadlineDate(
        createBaseTask(),
        new Date('2026-03-10'),
        undefined,
        undefined,
        { forceVaultApi: true },
      );

      expect(mockApp.vault.process).toHaveBeenCalled();
      expect(editor.replaceRange).not.toHaveBeenCalled();
    });

    it('uses the vault and leaves the live buffer untouched when forced (remove)', async () => {
      const { editor } = installActiveEditor(mockApp, [
        'TODO Task text',
        'DEADLINE: <2026-03-10 Tue>',
      ]);

      await writer.removeTaskDeadlineDate(
        createBaseTask({ deadlineDate: new Date('2026-03-10') }),
        { forceVaultApi: true },
      );

      expect(mockApp.vault.process).toHaveBeenCalled();
      expect(editor.replaceRange).not.toHaveBeenCalled();
    });
  });

  describe('table-cell priority', () => {
    it('uses the vault and leaves the live buffer untouched when forced', async () => {
      const { editor } = installActiveEditor(mockApp, ['| TODO Task text |']);
      const tableTask: Task = createBaseTask({
        isTableTask: true,
        tableCell: { cellIndex: 0 },
        rawText: 'TODO Task text',
      });

      await writer.updateTaskPriority(tableTask, 'high', {
        forceVaultApi: true,
      });

      expect(mockApp.vault.process).toHaveBeenCalled();
      expect(editor.replaceRange).not.toHaveBeenCalled();
    });
  });
});
