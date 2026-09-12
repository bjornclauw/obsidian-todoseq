import { TaskEditorController } from '../src/services/task-editor-controller';
import { createBaseTask } from './helpers/test-helper';
import { TaskComposeFields } from '../src/services/task-writer';
import { TFile } from 'obsidian';

function makeFields(
  overrides: Partial<TaskComposeFields> = {},
): TaskComposeFields {
  return {
    text: 'Task text',
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

describe('TaskEditorController', () => {
  function createHarness(lines: string[]) {
    const parser = {
      isTaskLine: (line: string) => /(^|\s)(TODO|DOING|DONE)\b/.test(line),
      parseLineAsTask: (line: string, lineNo: number, path: string) =>
        createBaseTask({ rawText: line, line: lineNo, path }),
    };
    const editor = {
      getLine: jest.fn((i: number) => lines[i]),
      getCursor: jest.fn().mockReturnValue({ line: 0, ch: 0 }),
    };
    const stateManager = {
      findTaskByPathAndLine: jest.fn().mockReturnValue(null),
      getKeywordManager: jest.fn(),
    };
    const vaultScanner = {
      getParser: () => parser,
      processIncrementalChange: jest.fn().mockResolvedValue(undefined),
    };
    const plugin = {
      app: {
        workspace: {
          getActiveViewOfType: jest.fn().mockReturnValue({
            file: { path: 'test.md' },
            editor,
          }),
        },
        vault: {
          getAbstractFileByPath: jest
            .fn()
            .mockReturnValue(new TFile('test.md', 'test.md', 'md')),
        },
      },
      taskStateManager: stateManager,
      vaultScanner,
      taskEditor: {
        createTaskAtLine: jest.fn(),
        updateTaskFields: jest.fn(),
      },
      settings: { weekStartsOn: 'Monday' as const },
      refreshAllTaskListViews: jest.fn(),
    };
    const controller = new TaskEditorController(plugin as never);
    return { controller, plugin, stateManager, editor, vaultScanner };
  }

  describe('resolveTarget', () => {
    it('returns the task from the state manager when the cursor is on it', () => {
      const { controller, stateManager } = createHarness(['TODO Task text']);
      const task = createBaseTask({ line: 0, rawText: 'TODO Task text' });
      stateManager.findTaskByPathAndLine.mockReturnValue(task);

      const target = (
        controller as unknown as {
          resolveTarget: (
            path: string,
            line: number,
          ) => {
            line: number;
            task: unknown;
          };
        }
      ).resolveTarget('test.md', 0);

      expect(target.task).toBe(task);
    });

    it('parses the current line when it is a task line', () => {
      const { controller } = createHarness(['TODO Task text']);

      const target = (
        controller as unknown as {
          resolveTarget: (
            path: string,
            line: number,
          ) => {
            line: number;
            task: { rawText: string } | null;
          };
        }
      ).resolveTarget('test.md', 0);

      expect(target.line).toBe(0);
      expect(target.task?.rawText).toBe('TODO Task text');
    });

    it('walks up from a metadata line to the owning task', () => {
      const { controller } = createHarness([
        'TODO Task text',
        '  SCHEDULED: <2026-03-10 Tue>',
      ]);

      const target = (
        controller as unknown as {
          resolveTarget: (
            path: string,
            line: number,
          ) => {
            line: number;
            task: { rawText: string } | null;
          };
        }
      ).resolveTarget('test.md', 1);

      expect(target.line).toBe(0);
      expect(target.task?.rawText).toBe('TODO Task text');
    });

    it('returns a null task when the cursor is not on a task', () => {
      const { controller } = createHarness(['Just some paragraph text']);

      const target = (
        controller as unknown as {
          resolveTarget: (
            path: string,
            line: number,
          ) => {
            task: unknown;
          };
        }
      ).resolveTarget('test.md', 0);

      expect(target.task).toBeNull();
    });
  });

  describe('save', () => {
    it('creates a task and refreshes views', async () => {
      const { controller, plugin, vaultScanner } = createHarness(['']);

      await (
        controller as unknown as {
          save: (
            target: { path: string; line: number; task: null },
            fields: TaskComposeFields,
          ) => Promise<void>;
        }
      ).save({ path: 'test.md', line: 0, task: null }, makeFields());

      expect(plugin.taskEditor.createTaskAtLine).toHaveBeenCalledWith(
        'test.md',
        0,
        expect.objectContaining({ text: 'Task text' }),
      );
      expect(vaultScanner.processIncrementalChange).toHaveBeenCalled();
      expect(plugin.refreshAllTaskListViews).toHaveBeenCalled();
    });

    it('updates an existing task', async () => {
      const { controller, plugin } = createHarness(['TODO Task text']);
      const task = createBaseTask({ line: 0 });

      await (
        controller as unknown as {
          save: (
            target: { path: string; line: number; task: unknown },
            fields: TaskComposeFields,
          ) => Promise<void>;
        }
      ).save({ path: 'test.md', line: 0, task }, makeFields());

      expect(plugin.taskEditor.updateTaskFields).toHaveBeenCalledWith(
        task,
        expect.objectContaining({ text: 'Task text' }),
      );
      expect(plugin.taskEditor.createTaskAtLine).not.toHaveBeenCalled();
    });
  });
});
