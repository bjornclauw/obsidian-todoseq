import { TaskEditorController } from '../src/services/task-editor-controller';
import {
  createBaseTask,
  createTestKeywordManager,
} from './helpers/test-helper';
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
    const keywordManager = createTestKeywordManager();
    const stateManager = {
      findTaskByPathAndLine: jest.fn().mockReturnValue(null),
      getKeywordManager: jest.fn().mockReturnValue(keywordManager),
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
      taskUpdateCoordinator: {
        scheduleRecurrenceForCompletedTask: jest.fn(),
      },
      settings: { weekStartsOn: 'Monday' as const },
      refreshAllTaskListViews: jest.fn(),
    };
    const controller = new TaskEditorController(plugin as never);
    return {
      controller,
      plugin,
      stateManager,
      editor,
      vaultScanner,
      keywordManager,
    };
  }

  type SaveTarget = { path: string; line: number; task: unknown };

  function save(
    controller: TaskEditorController,
    target: SaveTarget,
    fields: TaskComposeFields,
  ): Promise<void> {
    return (
      controller as unknown as {
        save: (target: SaveTarget, fields: TaskComposeFields) => Promise<void>;
      }
    ).save(target, fields);
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

      await save(
        controller,
        { path: 'test.md', line: 0, task: null },
        makeFields(),
      );

      expect(plugin.taskEditor.createTaskAtLine).toHaveBeenCalledWith(
        'test.md',
        0,
        expect.objectContaining({ text: 'Task text' }),
        { recordCompletion: false },
      );
      expect(vaultScanner.processIncrementalChange).toHaveBeenCalled();
      expect(plugin.refreshAllTaskListViews).toHaveBeenCalled();
    });

    it('updates an existing task', async () => {
      const { controller, plugin } = createHarness(['TODO Task text']);
      const task = createBaseTask({ line: 0 });

      await save(controller, { path: 'test.md', line: 0, task }, makeFields());

      expect(plugin.taskEditor.updateTaskFields).toHaveBeenCalledWith(
        task,
        expect.objectContaining({ text: 'Task text' }),
        { recordCompletion: false },
      );
      expect(plugin.taskEditor.createTaskAtLine).not.toHaveBeenCalled();
    });

    it('completes a recurring task like other surfaces: reset state, record CLOSED, schedule roll-forward', async () => {
      const { controller, plugin, keywordManager } = createHarness([
        'TODO Task text',
      ]);
      void keywordManager;
      const task = createBaseTask({
        line: 0,
        state: 'TODO',
        scheduledDate: new Date('2026-06-15'),
        scheduledDateRepeat: { type: '+', unit: 'd', value: 1, raw: '+1d' },
      });
      const updated = { ...task, state: 'TODO' };
      plugin.taskEditor.updateTaskFields.mockResolvedValue({
        task: updated,
        lineDelta: 0,
      });

      await save(
        controller,
        { path: 'test.md', line: 0, task },
        makeFields({
          state: 'DONE',
          scheduledDate: new Date('2026-06-15'),
          scheduledRepeat: { type: '+', unit: 'd', value: 1, raw: '+1d' },
        }),
      );

      expect(plugin.taskEditor.updateTaskFields).toHaveBeenCalledWith(
        task,
        expect.objectContaining({ state: 'TODO' }),
        { recordCompletion: true },
      );
      expect(
        plugin.taskUpdateCoordinator.scheduleRecurrenceForCompletedTask,
      ).toHaveBeenCalledWith(updated);
    });

    it('does not schedule recurrence when completing a non-recurring task', async () => {
      const { controller, plugin } = createHarness(['TODO Task text']);
      const task = createBaseTask({ line: 0, state: 'TODO' });
      plugin.taskEditor.updateTaskFields.mockResolvedValue({
        task: { ...task, state: 'DONE' },
        lineDelta: 0,
      });

      await save(
        controller,
        { path: 'test.md', line: 0, task },
        makeFields({ state: 'DONE' }),
      );

      expect(
        plugin.taskUpdateCoordinator.scheduleRecurrenceForCompletedTask,
      ).not.toHaveBeenCalled();
      expect(plugin.taskEditor.updateTaskFields).toHaveBeenCalledWith(
        task,
        expect.objectContaining({ state: 'DONE' }),
        { recordCompletion: false },
      );
    });

    it('does not throw when the coordinator is unavailable', async () => {
      const { controller, plugin } = createHarness(['TODO Task text']);
      plugin.taskUpdateCoordinator = null as never;
      plugin.taskEditor.updateTaskFields.mockResolvedValue({
        task: createBaseTask({ line: 0 }),
        lineDelta: 0,
      });
      const task = createBaseTask({
        line: 0,
        scheduledDate: new Date('2026-06-15'),
        scheduledDateRepeat: { type: '+', unit: 'd', value: 1, raw: '+1d' },
      });

      await expect(
        save(
          controller,
          { path: 'test.md', line: 0, task },
          makeFields({
            state: 'DONE',
            scheduledDate: new Date('2026-06-15'),
            scheduledRepeat: { type: '+', unit: 'd', value: 1, raw: '+1d' },
          }),
        ),
      ).resolves.toBeUndefined();
    });
  });
});
