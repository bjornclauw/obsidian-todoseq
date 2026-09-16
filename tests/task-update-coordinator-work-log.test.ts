/**
 * @jest-environment jsdom
 */

import { TaskUpdateCoordinator } from '../src/services/task-update-coordinator';
import { TaskStateManager } from '../src/services/task-state-manager';
import { createBaseTask } from './helpers/test-helper';
import { TFile } from 'obsidian';
import {
  createCoordinatorHarness,
  CoordinatorHarness,
} from './helpers/coordinator-harness';

describe('TaskUpdateCoordinator - work session auto-close', () => {
  let mockApp: CoordinatorHarness['mockApp'];
  let mockPlugin: CoordinatorHarness['mockPlugin'];
  let taskStateManager: TaskStateManager;
  let coordinator: TaskUpdateCoordinator;

  function setup(settings: Record<string, unknown> = {}): void {
    const harness = createCoordinatorHarness({
      settings: {
        trackClosedDate: true,
        trackWorkLog: true,
        ...settings,
      },
    });
    mockApp = harness.mockApp;
    mockPlugin = harness.mockPlugin;
    taskStateManager = harness.stateManager;
    coordinator = harness.coordinator;

    const mockTFile = new TFile();
    mockTFile.path = 'test.md';
    mockTFile.name = 'test.md';
    mockApp.vault.getAbstractFileByPath.mockReturnValue(mockTFile);
    mockApp.vault.process.mockImplementation(
      (_file: unknown, callback: (data: string) => string) =>
        Promise.resolve(callback('TODO Task text')),
    );
    mockApp.vault.read.mockResolvedValue('TODO Task text');
  }

  afterEach(() => {
    coordinator?.destroy();
    jest.clearAllMocks();
  });

  it('pauses the running session when the task is completed', async () => {
    setup();
    const task = createBaseTask({
      state: 'DOING',
      timerStart: new Date(2026, 8, 14, 9, 0),
    });
    taskStateManager.addTask(task);

    await coordinator.updateTaskState(task, 'DONE');

    expect(mockPlugin.taskEditor.pauseWorkSession).toHaveBeenCalledWith(task);
  });

  it('leaves the session running on a non-completing transition', async () => {
    setup();
    const task = createBaseTask({
      state: 'TODO',
      timerStart: new Date(2026, 8, 14, 9, 0),
    });
    taskStateManager.addTask(task);

    await coordinator.updateTaskState(task, 'DOING');

    expect(mockPlugin.taskEditor.pauseWorkSession).not.toHaveBeenCalled();
  });

  it('does nothing when the task is not running', async () => {
    setup();
    const task = createBaseTask({ state: 'DOING', timerStart: null });
    taskStateManager.addTask(task);

    await coordinator.updateTaskState(task, 'DONE');

    expect(mockPlugin.taskEditor.pauseWorkSession).not.toHaveBeenCalled();
  });

  it('does nothing when work logging is disabled', async () => {
    setup({ trackWorkLog: false });
    const task = createBaseTask({
      state: 'DOING',
      timerStart: new Date(2026, 8, 14, 9, 0),
    });
    taskStateManager.addTask(task);

    await coordinator.updateTaskState(task, 'DONE');

    expect(mockPlugin.taskEditor.pauseWorkSession).not.toHaveBeenCalled();
  });
});
