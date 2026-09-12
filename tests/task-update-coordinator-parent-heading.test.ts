/**
 * @jest-environment jsdom
 */

import { TaskUpdateCoordinator } from '../src/services/task-update-coordinator';
import { Task } from '../src/types/task';
import { createBaseTask } from './helpers/test-helper';
import { TFile } from 'obsidian';
import { createCoordinatorHarness } from './helpers/coordinator-harness';

describe('TaskUpdateCoordinator - parentHeading preservation', () => {
  let taskUpdateCoordinator: TaskUpdateCoordinator;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    taskUpdateCoordinator?.destroy();
    jest.useRealTimers();
  });

  function setupVaultReparse(reparsed: Task) {
    const harness = createCoordinatorHarness();
    taskUpdateCoordinator = harness.coordinator;

    const mockTFile = new TFile();
    mockTFile.path = 'test.md';
    harness.mockApp.vault.getAbstractFileByPath.mockReturnValue(mockTFile);
    harness.mockApp.vault.read.mockResolvedValue('TODO Task text');
    harness.mockPlugin.vaultScanner.getParser.mockReturnValue({
      parseTaskBlock: jest.fn(() => reparsed),
    });

    return harness;
  }

  test('carries the cached parentHeading onto the live re-parsed task', async () => {
    const reparsed = createBaseTask({ parentHeading: undefined });
    const { mockPlugin, stateManager, coordinator } =
      setupVaultReparse(reparsed);

    const task = createBaseTask({ parentHeading: 'Work', state: 'TODO' });
    stateManager.addTask(task);

    await coordinator.updateTaskState(task, 'DONE', 'task-list');

    expect(mockPlugin.taskEditor.updateTaskState).toHaveBeenCalled();
    const passed = mockPlugin.taskEditor.updateTaskState.mock
      .calls[0][0] as Task;
    expect(passed.parentHeading).toBe('Work');
  });

  test('prefers the re-parsed heading when it has one', async () => {
    const reparsed = createBaseTask({ parentHeading: 'Fresh Heading' });
    const { mockPlugin, stateManager, coordinator } =
      setupVaultReparse(reparsed);

    const task = createBaseTask({
      parentHeading: 'Stale Heading',
      state: 'TODO',
    });
    stateManager.addTask(task);

    await coordinator.updateTaskState(task, 'DONE', 'task-list');

    const passed = mockPlugin.taskEditor.updateTaskState.mock
      .calls[0][0] as Task;
    expect(passed.parentHeading).toBe('Fresh Heading');
  });
});
