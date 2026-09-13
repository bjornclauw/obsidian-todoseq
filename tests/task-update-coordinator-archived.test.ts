/**
 * @jest-environment jsdom
 */

import { TaskUpdateCoordinator } from '../src/services/task-update-coordinator';
import { TaskStateManager } from '../src/services/task-state-manager';
import { TaskParser } from '../src/parser/task-parser';
import { createBaseTask } from './helpers/test-helper';
import { TFile } from 'obsidian';
import {
  createCoordinatorHarness,
  createMarkdownViewStub,
  CoordinatorHarness,
} from './helpers/coordinator-harness';

let mockApp: CoordinatorHarness['mockApp'];
let mockPlugin: CoordinatorHarness['mockPlugin'];

describe('TaskUpdateCoordinator - Archived State Removal', () => {
  let taskUpdateCoordinator: TaskUpdateCoordinator;
  let taskStateManager: TaskStateManager;
  let keywordManager: any;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    const harness = createCoordinatorHarness({
      settings: { additionalArchivedKeywords: ['ARCHIVED', 'OLD'] },
    });
    mockApp = harness.mockApp;
    mockPlugin = harness.mockPlugin;
    keywordManager = harness.keywordManager;
    taskStateManager = harness.stateManager;
    taskUpdateCoordinator = harness.coordinator;

    const mockTFile = new TFile();
    mockTFile.path = 'test.md';
    mockTFile.name = 'test.md';
    mockApp.vault.getAbstractFileByPath.mockReturnValue(mockTFile);
    mockApp.vault.process.mockImplementation((file, callback) => {
      const data = 'TODO Task text';
      return callback(data);
    });
    mockApp.vault.read.mockResolvedValue('TODO Task text');

    mockPlugin.taskEditor.updateTaskState.mockImplementation(
      async (task, newState) => ({
        ...task,
        state: newState,
        rawText: task.rawText.replace(/TODO/, newState),
      }),
    );

    mockPlugin.taskEditor.applyRecurrenceUpdate.mockImplementation(
      async (task, options) => {
        const result = { ...task };
        if (options.newState !== undefined) {
          result.state = options.newState;
          result.rawText = task.rawText.replace(task.state, options.newState);
        }
        if (options.newScheduledDate !== undefined) {
          result.scheduledDate = options.newScheduledDate;
        }
        if (options.newDeadlineDate !== undefined) {
          result.deadlineDate = options.newDeadlineDate;
        }
        return result;
      },
    );
  });

  it('should remove task from state manager when transitioning to ARCHIVED state', async () => {
    const task = createBaseTask({
      path: 'test.md',
      line: 0,
      state: 'TODO',
      rawText: 'TODO Test task',
    });

    taskStateManager.addTask(task);

    expect(taskStateManager.getTaskCount()).toBe(1);

    await taskUpdateCoordinator.updateTaskState(task, 'ARCHIVED', 'task-list');

    expect(taskStateManager.getTaskCount()).toBe(0);
  });

  it('should remove task from state manager when transitioning to custom archived keyword', async () => {
    const task = createBaseTask({
      path: 'test.md',
      line: 0,
      state: 'TODO',
      rawText: 'TODO Test task',
    });

    taskStateManager.addTask(task);

    expect(taskStateManager.getTaskCount()).toBe(1);

    await taskUpdateCoordinator.updateTaskState(task, 'OLD', 'task-list');

    expect(taskStateManager.getTaskCount()).toBe(0);
  });

  it('should remove task after recurrence update if final state is archived', async () => {
    const task = createBaseTask({
      path: 'test.md',
      line: 0,
      state: 'TODO',
      rawText: 'TODO Test task',
      scheduledDate: new Date('2024-01-01'),
      scheduledDateRepeat: {
        type: '+',
        unit: 'd',
        value: 1,
        raw: '+1d',
      },
    });

    taskStateManager.addTask(task);

    expect(taskStateManager.getTaskCount()).toBe(1);

    mockPlugin.taskEditor.updateTaskState.mockImplementation(
      async (task, newState) => ({
        ...task,
        state: newState,
        rawText: task.rawText.replace(/TODO/, newState),
      }),
    );

    await taskUpdateCoordinator.updateTaskRecurrence(task, {
      newStateForRecurrence: 'ARCHIVED',
    });

    expect(taskStateManager.getTaskCount()).toBe(0);
  });

  it('should NOT remove task when transitioning to non-archived state', async () => {
    const task = createBaseTask({
      path: 'test.md',
      line: 0,
      state: 'TODO',
      rawText: 'TODO Test task',
    });

    taskStateManager.addTask(task);

    expect(taskStateManager.getTaskCount()).toBe(1);

    await taskUpdateCoordinator.updateTaskState(task, 'DONE', 'task-list');

    expect(taskStateManager.getTaskCount()).toBe(1);
    const updatedTask = taskStateManager.findTaskByPathAndLine('test.md', 0);
    expect(updatedTask?.state).toBe('DONE');
  });

  it('should remove task from state manager after async phase completes', async () => {
    const task = createBaseTask({
      path: 'test.md',
      line: 0,
      state: 'TODO',
      rawText: 'TODO Test task',
    });

    taskStateManager.addTask(task);

    expect(taskStateManager.getTaskCount()).toBe(1);

    const updatePromise = taskUpdateCoordinator.updateTaskState(
      task,
      'ARCHIVED',
      'editor',
    );

    await updatePromise;

    expect(taskStateManager.getTaskCount()).toBe(0);
  });

  it('should notify subscribers after task removal', async () => {
    const task = createBaseTask({
      path: 'test.md',
      line: 0,
      state: 'TODO',
      rawText: 'TODO Test task',
    });

    taskStateManager.addTask(task);

    const subscriber = jest.fn();
    taskStateManager.subscribe(subscriber);

    await taskUpdateCoordinator.updateTaskState(task, 'ARCHIVED', 'task-list');

    expect(subscriber).toHaveBeenCalled();
    const lastCall = subscriber.mock.calls[subscriber.mock.calls.length - 1][0];
    expect(lastCall.length).toBe(0);
  });

  it('should only remove the specific task when multiple tasks exist', async () => {
    const task1 = createBaseTask({
      path: 'test.md',
      line: 0,
      state: 'TODO',
      rawText: 'TODO Task 1',
    });

    const task2 = createBaseTask({
      path: 'test.md',
      line: 1,
      state: 'TODO',
      rawText: 'TODO Task 2',
    });

    const task3 = createBaseTask({
      path: 'test.md',
      line: 2,
      state: 'TODO',
      rawText: 'TODO Task 3',
    });

    taskStateManager.addTask(task1);
    taskStateManager.addTask(task2);
    taskStateManager.addTask(task3);

    expect(taskStateManager.getTaskCount()).toBe(3);

    await taskUpdateCoordinator.updateTaskState(task2, 'ARCHIVED', 'task-list');

    expect(taskStateManager.getTaskCount()).toBe(2);
    expect(taskStateManager.findTaskByPathAndLine('test.md', 0)).not.toBeNull();
    expect(taskStateManager.findTaskByPathAndLine('test.md', 1)).toBeNull();
    expect(taskStateManager.findTaskByPathAndLine('test.md', 2)).not.toBeNull();
  });

  afterEach(() => {
    jest.useRealTimers();
    taskUpdateCoordinator.destroy();
  });
});

describe('TaskUpdateCoordinator - Re-adding Tasks from Archived', () => {
  let taskUpdateCoordinator: TaskUpdateCoordinator;
  let taskStateManager: TaskStateManager;
  let keywordManager: any;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    const harness = createCoordinatorHarness({
      settings: { additionalArchivedKeywords: ['ARCHIVED', 'OLD'] },
    });
    mockApp = harness.mockApp;
    mockPlugin = harness.mockPlugin;
    keywordManager = harness.keywordManager;
    taskStateManager = harness.stateManager;
    taskUpdateCoordinator = harness.coordinator;

    const mockTFile = new TFile();
    mockTFile.path = 'test.md';
    mockTFile.name = 'test.md';
    mockApp.vault.getAbstractFileByPath.mockReturnValue(mockTFile);
    mockApp.vault.read.mockResolvedValue('TODO Task text');
  });

  it('should re-add task when transitioning from archived to non-archived state', async () => {
    const reactivated = createBaseTask({
      path: 'test.md',
      line: 0,
      state: 'TODO',
      rawText: 'TODO Reactivated task',
      scheduledDate: new Date('2026-03-10'),
      scheduledDateRepeat: { type: '+', unit: 'w', value: 1, raw: '+1w' },
      closedDate: new Date('2026-03-01'),
    });
    const mockParser = {
      // Re-adding parses the whole file so date/repeat metadata is preserved.
      parseFile: jest.fn().mockReturnValue([reactivated]),
    };

    mockPlugin.vaultScanner.getParser.mockReturnValue(mockParser);

    expect(taskStateManager.getTaskCount()).toBe(0);

    await taskUpdateCoordinator.updateTaskByPath(
      'test.md',
      0,
      'TODO',
      'editor',
    );

    expect(taskStateManager.getTaskCount()).toBe(1);
    const reactivatedTask = taskStateManager.findTaskByPathAndLine(
      'test.md',
      0,
    );
    expect(reactivatedTask).not.toBeNull();
    expect(reactivatedTask?.state).toBe('TODO');
    // Full-file parse preserves date/repeat/CLOSED metadata for the re-added task.
    expect(reactivatedTask?.scheduledDateRepeat).not.toBeNull();
    expect(reactivatedTask?.scheduledDate).not.toBeNull();
    expect(reactivatedTask?.closedDate).not.toBeNull();
  });

  it('re-reads date metadata from the file before a state update', async () => {
    // The stored copy still has the old SCHEDULED repeater, but the file no
    // longer contains it (the scanner has not caught up yet).
    const stale = createBaseTask({
      path: 'test.md',
      line: 0,
      state: 'TODO',
      rawText: 'TODO Pay rent',
      scheduledDate: new Date('2026-03-10'),
      scheduledDateRepeat: { type: '+', unit: 'w', value: 1, raw: '+1w' },
    });
    taskStateManager.addTask(stale);
    mockPlugin.vaultScanner.getParser.mockReturnValue(
      TaskParser.create(keywordManager, null),
    );
    mockApp.vault.read.mockResolvedValue('TODO Pay rent');

    await taskUpdateCoordinator.updateTaskByPath(
      'test.md',
      0,
      'DOING',
      'editor',
    );

    const updated = taskStateManager.findTaskByPathAndLine('test.md', 0);
    expect(updated?.state).toBe('DOING');
    expect(updated?.scheduledDate).toBeNull();
    expect(updated?.scheduledDateRepeat).toBeNull();
  });

  it('re-reads date metadata from an open editor buffer before a state update', async () => {
    const stale = createBaseTask({
      path: 'test.md',
      line: 0,
      state: 'TODO',
      rawText: 'TODO Pay rent',
      scheduledDate: new Date('2026-03-10'),
      scheduledDateRepeat: { type: '+', unit: 'w', value: 1, raw: '+1w' },
    });
    taskStateManager.addTask(stale);
    mockPlugin.vaultScanner.getParser.mockReturnValue(
      TaskParser.create(keywordManager, null),
    );

    // The editor buffer no longer has the SCHEDULED line.
    const editorLines = ['TODO Pay rent'];
    const editor = {
      lineCount: () => editorLines.length,
      getLine: (i: number) => editorLines[i] ?? '',
    };
    (mockApp.workspace as unknown as Record<string, unknown>).getLeavesOfType =
      jest
        .fn()
        .mockReturnValue([{ view: createMarkdownViewStub('test.md', editor) }]);

    await taskUpdateCoordinator.updateTaskByPath(
      'test.md',
      0,
      'DOING',
      'editor',
    );

    const updated = taskStateManager.findTaskByPathAndLine('test.md', 0);
    expect(updated?.state).toBe('DOING');
    expect(updated?.scheduledDate).toBeNull();
    expect(updated?.scheduledDateRepeat).toBeNull();
  });

  it('keeps the repeater when it is still present in the editor buffer', async () => {
    const stale = createBaseTask({
      path: 'test.md',
      line: 0,
      state: 'TODO',
      rawText: 'TODO Pay rent',
    });
    taskStateManager.addTask(stale);
    mockPlugin.vaultScanner.getParser.mockReturnValue(
      TaskParser.create(keywordManager, null),
    );

    const editorLines = ['TODO Pay rent', '  SCHEDULED: <2026-03-10 Tue +1w>'];
    const editor = {
      lineCount: () => editorLines.length,
      getLine: (i: number) => editorLines[i] ?? '',
    };
    (mockApp.workspace as unknown as Record<string, unknown>).getLeavesOfType =
      jest
        .fn()
        .mockReturnValue([{ view: createMarkdownViewStub('test.md', editor) }]);

    await taskUpdateCoordinator.updateTaskByPath(
      'test.md',
      0,
      'DOING',
      'editor',
    );

    const updated = taskStateManager.findTaskByPathAndLine('test.md', 0);
    expect(updated?.state).toBe('DOING');
    expect(updated?.scheduledDate).toBeTruthy();
    expect(updated?.scheduledDateRepeat?.raw).toBe('+1w');
  });

  it('should NOT re-add task when transitioning to archived state', async () => {
    const mockParser = {
      parseLine: jest.fn().mockReturnValue(
        createBaseTask({
          path: 'test.md',
          line: 0,
          state: 'ARCHIVED',
          rawText: 'ARCHIVED Task',
        }),
      ),
    };

    mockPlugin.vaultScanner.getParser.mockReturnValue(mockParser);

    expect(taskStateManager.getTaskCount()).toBe(0);

    await taskUpdateCoordinator.updateTaskByPath(
      'test.md',
      0,
      'ARCHIVED',
      'editor',
    );

    expect(taskStateManager.getTaskCount()).toBe(0);
    expect(mockParser.parseLine).not.toHaveBeenCalled();
  });

  it('should use existing task if already in state manager when reactivating', async () => {
    const existingTask = createBaseTask({
      path: 'test.md',
      line: 0,
      state: 'TODO',
      rawText: 'TODO Existing task',
    });

    taskStateManager.addTask(existingTask);

    const mockParser = {
      parseLine: jest.fn().mockReturnValue(
        createBaseTask({
          path: 'test.md',
          line: 0,
          state: 'DOING',
          rawText: 'DOING Existing task',
        }),
      ),
    };

    mockPlugin.vaultScanner.getParser.mockReturnValue(mockParser);

    expect(taskStateManager.getTaskCount()).toBe(1);

    await taskUpdateCoordinator.updateTaskByPath(
      'test.md',
      0,
      'DOING',
      'editor',
    );

    expect(taskStateManager.getTaskCount()).toBe(1);
    const updatedTask = taskStateManager.findTaskByPathAndLine('test.md', 0);
    expect(updatedTask?.state).toBe('DOING');
    expect(mockParser.parseLine).not.toHaveBeenCalled();
  });

  it('should not re-add task if file cannot be found', async () => {
    mockApp.vault.getAbstractFileByPath.mockReturnValue(null);

    expect(taskStateManager.getTaskCount()).toBe(0);

    await taskUpdateCoordinator.updateTaskByPath(
      'nonexistent.md',
      0,
      'TODO',
      'editor',
    );

    expect(taskStateManager.getTaskCount()).toBe(0);
  });

  it('should not re-add task if line is out of bounds', async () => {
    const mockParser = {
      parseLine: jest.fn(),
    };

    mockPlugin.vaultScanner.getParser.mockReturnValue(mockParser);

    expect(taskStateManager.getTaskCount()).toBe(0);

    await taskUpdateCoordinator.updateTaskByPath(
      'test.md',
      100,
      'TODO',
      'editor',
    );

    expect(taskStateManager.getTaskCount()).toBe(0);
    expect(mockParser.parseLine).not.toHaveBeenCalled();
  });

  it('should not re-add task if parsed task is null', async () => {
    const mockParser = {
      parseLine: jest.fn().mockReturnValue(null),
    };

    mockPlugin.vaultScanner.getParser.mockReturnValue(mockParser);

    expect(taskStateManager.getTaskCount()).toBe(0);

    await taskUpdateCoordinator.updateTaskByPath(
      'test.md',
      0,
      'TODO',
      'editor',
    );

    expect(taskStateManager.getTaskCount()).toBe(0);
  });

  afterEach(() => {
    jest.useRealTimers();
    taskUpdateCoordinator.destroy();
  });
});
