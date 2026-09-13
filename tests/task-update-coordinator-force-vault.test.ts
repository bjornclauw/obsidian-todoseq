/**
 * @jest-environment jsdom
 */

import { TaskUpdateCoordinator } from '../src/services/task-update-coordinator';
import { createBaseTask } from './helpers/test-helper';
import { createCoordinatorHarness } from './helpers/coordinator-harness';

describe('TaskUpdateCoordinator - forceVaultApi for non-state writes', () => {
  let taskUpdateCoordinator: TaskUpdateCoordinator;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    taskUpdateCoordinator?.destroy();
    jest.useRealTimers();
  });

  test('scheduled-date from a non-editor source writes via the vault', async () => {
    const harness = createCoordinatorHarness();
    taskUpdateCoordinator = harness.coordinator;
    const task = createBaseTask({ scheduledDate: null });
    harness.stateManager.addTask(task);

    await harness.coordinator.updateTaskScheduledDate(
      task,
      new Date('2026-03-10'),
    );

    expect(harness.taskEditor.updateTaskScheduledDate).toHaveBeenCalledWith(
      task,
      new Date('2026-03-10'),
      undefined,
      undefined,
      { forceVaultApi: true },
    );
  });

  test('scheduled-date from the editor keeps the buffer path', async () => {
    const harness = createCoordinatorHarness();
    taskUpdateCoordinator = harness.coordinator;
    const task = createBaseTask({ scheduledDate: null });
    harness.stateManager.addTask(task);

    await harness.coordinator.updateTask({
      task,
      type: 'scheduled-date',
      source: 'editor',
      newDate: new Date('2026-03-10'),
    });

    expect(harness.taskEditor.updateTaskScheduledDate).toHaveBeenCalledWith(
      task,
      new Date('2026-03-10'),
      undefined,
      undefined,
      { forceVaultApi: false },
    );
  });

  test('removing a scheduled date from a non-editor source writes via the vault', async () => {
    const harness = createCoordinatorHarness();
    taskUpdateCoordinator = harness.coordinator;
    const task = createBaseTask({ scheduledDate: new Date('2026-03-10') });
    harness.stateManager.addTask(task);

    await harness.coordinator.updateTaskScheduledDate(task, null);

    expect(harness.taskEditor.removeTaskScheduledDate).toHaveBeenCalledWith(
      task,
      { forceVaultApi: true },
    );
  });

  test('deadline-date from a non-editor source writes via the vault', async () => {
    const harness = createCoordinatorHarness();
    taskUpdateCoordinator = harness.coordinator;
    const task = createBaseTask({ deadlineDate: null });
    harness.stateManager.addTask(task);

    await harness.coordinator.updateTaskDeadlineDate(
      task,
      new Date('2026-03-10'),
    );

    expect(harness.taskEditor.updateTaskDeadlineDate).toHaveBeenCalledWith(
      task,
      new Date('2026-03-10'),
      undefined,
      undefined,
      { forceVaultApi: true },
    );
  });

  test('priority from a non-editor source writes via the vault', async () => {
    const harness = createCoordinatorHarness();
    taskUpdateCoordinator = harness.coordinator;
    const task = createBaseTask({ priority: null });
    harness.stateManager.addTask(task);

    await harness.coordinator.updateTask({
      task,
      type: 'priority',
      source: 'embedded',
      newPriority: 'high',
    });

    expect(harness.taskEditor.updateTaskPriority).toHaveBeenCalledWith(
      task,
      'high',
      { forceVaultApi: true },
    );
  });

  test('removing priority from a non-editor source writes via the vault', async () => {
    const harness = createCoordinatorHarness();
    taskUpdateCoordinator = harness.coordinator;
    const task = createBaseTask({ priority: 'high' });
    harness.stateManager.addTask(task);

    await harness.coordinator.updateTask({
      task,
      type: 'priority',
      source: 'task-list',
      newPriority: null,
    });

    expect(harness.taskEditor.removeTaskPriority).toHaveBeenCalledWith(task, {
      forceVaultApi: true,
    });
  });
});
