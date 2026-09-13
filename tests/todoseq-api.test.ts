/**
 * Unit tests for the TODOseq public API surface used by other plugins.
 */
import {
  TODOSEQ_API_VERSION,
  TodoseqApiImpl,
  type TodoseqApi,
  type TodoseqApiHost,
} from '../src/api/todoseq-api';
import { TaskStateManager } from '../src/services/task-state-manager';
import { TaskUpdateCoordinator } from '../src/services/task-update-coordinator';
import { Task } from '../src/types/task';
import {
  createBaseSettings,
  createBaseTask,
  createTestKeywordManager,
} from './helpers/test-helper';

interface Harness {
  api: TodoseqApi;
  taskStateManager: TaskStateManager;
  keywordManager: ReturnType<typeof createTestKeywordManager>;
  updateTaskByPath: jest.Mock;
  scanVault: jest.Mock;
}

function createHarness(): Harness {
  const settings = createBaseSettings();
  const keywordManager = createTestKeywordManager(settings);
  const taskStateManager = new TaskStateManager(keywordManager);
  const updateTaskByPath = jest.fn().mockResolvedValue(undefined);
  const scanVault = jest.fn().mockResolvedValue(undefined);

  const host: TodoseqApiHost = {
    taskStateManager,
    taskUpdateCoordinator: {
      updateTaskByPath,
    } as unknown as TaskUpdateCoordinator,
    keywordManager,
    settings,
    scanVault,
  };

  return {
    api: new TodoseqApiImpl(host),
    taskStateManager,
    keywordManager,
    updateTaskByPath,
    scanVault,
  };
}

function setSingleTask(
  taskStateManager: TaskStateManager,
  overrides: Partial<Task> = {},
): Task {
  const task = createBaseTask(overrides);
  taskStateManager.setTasks([task]);
  return task;
}

describe('TodoseqApi', () => {
  describe('version', () => {
    it('exposes the current API version', () => {
      const { api } = createHarness();
      expect(api.version).toBe(TODOSEQ_API_VERSION);
    });
  });

  describe('getTasks()', () => {
    it('returns the current tasks from the state manager', () => {
      const { api, taskStateManager } = createHarness();
      setSingleTask(taskStateManager, { path: 'a.md', line: 2 });

      const tasks = api.getTasks();

      expect(tasks).toHaveLength(1);
      expect(tasks[0].path).toBe('a.md');
      expect(tasks[0].line).toBe(2);
    });
  });

  describe('onTasksChanged()', () => {
    it('invokes the callback immediately with current tasks', () => {
      const { api, taskStateManager } = createHarness();
      setSingleTask(taskStateManager, { path: 'a.md' });
      const callback = jest.fn();

      api.onTasksChanged(callback);

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback.mock.calls[0][0]).toHaveLength(1);
    });

    it('invokes the callback when tasks change', () => {
      const { api, taskStateManager } = createHarness();
      const callback = jest.fn();
      api.onTasksChanged(callback);
      callback.mockClear();

      setSingleTask(taskStateManager, { path: 'b.md' });

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback.mock.calls[0][0][0].path).toBe('b.md');
    });

    it('stops notifying after unsubscribe', () => {
      const { api, taskStateManager } = createHarness();
      const callback = jest.fn();
      const unsubscribe = api.onTasksChanged(callback);
      callback.mockClear();

      unsubscribe();
      setSingleTask(taskStateManager, { path: 'c.md' });

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('toggleTask()', () => {
    it('completes an open task', async () => {
      const { api, taskStateManager, keywordManager, updateTaskByPath } =
        createHarness();
      setSingleTask(taskStateManager, {
        path: 'a.md',
        line: 3,
        state: 'TODO',
        completed: false,
      });

      const result = await api.toggleTask('a.md', 3);

      expect(updateTaskByPath).toHaveBeenCalledTimes(1);
      const [path, line, newState, source, cellIndex] =
        updateTaskByPath.mock.calls[0];
      expect(path).toBe('a.md');
      expect(line).toBe(3);
      expect(source).toBe('api');
      expect(cellIndex).toBeUndefined();
      expect(keywordManager.isCompleted(newState)).toBe(true);
      expect(result).toBe(newState);
    });

    it('reactivates a completed task', async () => {
      const { api, taskStateManager, keywordManager, updateTaskByPath } =
        createHarness();
      setSingleTask(taskStateManager, {
        path: 'a.md',
        line: 3,
        state: 'DONE',
        completed: true,
      });

      const result = await api.toggleTask('a.md', 3);

      expect(updateTaskByPath).toHaveBeenCalledTimes(1);
      const newState = updateTaskByPath.mock.calls[0][2];
      expect(keywordManager.isCompleted(newState)).toBe(false);
      expect(result).toBe(newState);
    });

    it('passes the table cell index through', async () => {
      const { api, taskStateManager, updateTaskByPath } = createHarness();
      const task = createBaseTask({
        path: 'a.md',
        line: 3,
        state: 'TODO',
        completed: false,
        isTableTask: true,
        tableCell: { cellIndex: 2 },
      });
      taskStateManager.setTasks([task]);

      await api.toggleTask('a.md', 3, 2);

      expect(updateTaskByPath.mock.calls[0][4]).toBe(2);
    });

    it('returns null when the task is not found', async () => {
      const { api, updateTaskByPath } = createHarness();

      const result = await api.toggleTask('missing.md', 9);

      expect(result).toBeNull();
      expect(updateTaskByPath).not.toHaveBeenCalled();
    });
  });

  describe('setTaskState()', () => {
    it('updates the task state through the coordinator', async () => {
      const { api, taskStateManager, updateTaskByPath } = createHarness();
      setSingleTask(taskStateManager, {
        path: 'a.md',
        line: 4,
        state: 'TODO',
      });

      const result = await api.setTaskState('a.md', 4, 'DOING');

      expect(updateTaskByPath).toHaveBeenCalledWith(
        'a.md',
        4,
        'DOING',
        'api',
        undefined,
      );
      expect(result).toBe('DOING');
    });

    it('is a no-op when the task is already in the target state', async () => {
      const { api, taskStateManager, updateTaskByPath } = createHarness();
      setSingleTask(taskStateManager, {
        path: 'a.md',
        line: 4,
        state: 'DOING',
      });

      const result = await api.setTaskState('a.md', 4, 'DOING');

      expect(updateTaskByPath).not.toHaveBeenCalled();
      expect(result).toBe('DOING');
    });

    it('returns null when the task is not found', async () => {
      const { api, updateTaskByPath } = createHarness();

      const result = await api.setTaskState('missing.md', 1, 'DOING');

      expect(result).toBeNull();
      expect(updateTaskByPath).not.toHaveBeenCalled();
    });

    it('throws when the coordinator is not ready', async () => {
      const settings = createBaseSettings();
      const keywordManager = createTestKeywordManager(settings);
      const taskStateManager = new TaskStateManager(keywordManager);
      taskStateManager.setTasks([
        createBaseTask({ path: 'a.md', line: 1, state: 'TODO' }),
      ]);
      const api = new TodoseqApiImpl({
        taskStateManager,
        taskUpdateCoordinator: null,
        keywordManager,
        settings,
        scanVault: jest.fn().mockResolvedValue(undefined),
      });

      await expect(api.setTaskState('a.md', 1, 'DONE')).rejects.toThrow(
        /not.*initializ|not.*ready/i,
      );
    });
  });

  describe('rescan()', () => {
    it('delegates to the vault scanner', async () => {
      const { api, scanVault } = createHarness();

      await api.rescan();

      expect(scanVault).toHaveBeenCalledTimes(1);
    });
  });
});
