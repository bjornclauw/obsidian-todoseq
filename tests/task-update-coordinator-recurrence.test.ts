/**
 * Tests for TaskUpdateCoordinator - Recurrence Update Behavior
 */

import { TaskUpdateCoordinator } from '../src/services/task-update-coordinator';
import { TaskStateManager } from '../src/services/task-state-manager';
import { TaskParser } from '../src/parser/task-parser';
import { Task } from '../src/types/task';
import { createBaseTask } from './helpers/test-helper';
import { TFile } from 'obsidian';
import {
  createCoordinatorHarness,
  createMarkdownViewStub,
  CoordinatorHarness,
} from './helpers/coordinator-harness';

describe('TaskUpdateCoordinator - Recurrence Update Behavior', () => {
  let taskUpdateCoordinator: TaskUpdateCoordinator;
  let taskStateManager: TaskStateManager;
  let keywordManager: any;
  let mockApp: CoordinatorHarness['mockApp'];
  let mockPlugin: CoordinatorHarness['mockPlugin'];

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    const harness = createCoordinatorHarness({
      settings: { additionalArchivedKeywords: ['ARCHIVED'] },
    });
    mockApp = harness.mockApp;
    mockPlugin = harness.mockPlugin;
    keywordManager = harness.keywordManager;
    taskStateManager = harness.stateManager;
    taskUpdateCoordinator = harness.coordinator;

    // Create a mock file
    const mockTFile = new TFile();
    mockTFile.path = 'test.md';
    mockTFile.name = 'test.md';
    mockApp.vault.getAbstractFileByPath.mockReturnValue(mockTFile);
    mockApp.vault.process.mockImplementation((file, callback) => {
      const data = 'TODO Task text\n  SCHEDULED: <2026-03-10 Mon +1w>';
      return callback(data);
    });
    mockApp.vault.read.mockResolvedValue(
      'TODO Task text\n  SCHEDULED: <2026-03-10 Mon +1w>',
    );
  });

  describe('updateTaskRecurrence', () => {
    it('should call updateTaskScheduledDate when newScheduledDate is provided', async () => {
      const task: Task = {
        ...createBaseTask(),
        path: 'test.md',
        line: 0,
        scheduledDate: new Date('2026-03-10'),
        scheduledDateRepeat: { type: '+', unit: 'w', value: 1, raw: '+1w' },
      };

      const newScheduledDate = new Date('2026-03-17');

      await taskUpdateCoordinator.updateTaskRecurrence(task, {
        newScheduledDate,
      });

      expect(mockPlugin.taskEditor.applyRecurrenceUpdate).toHaveBeenCalled();
      const args = mockPlugin.taskEditor.applyRecurrenceUpdate.mock.calls[0];
      expect(args[1].newScheduledDate).toEqual(newScheduledDate);
    });

    it('should call applyRecurrenceUpdate when newScheduledDate is null to remove', async () => {
      const task: Task = {
        ...createBaseTask(),
        path: 'test.md',
        line: 0,
        scheduledDate: new Date('2026-03-10'),
        scheduledDateRepeat: { type: '+', unit: 'w', value: 1, raw: '+1w' },
      };

      await taskUpdateCoordinator.updateTaskRecurrence(task, {
        newScheduledDate: null,
      });

      expect(mockPlugin.taskEditor.applyRecurrenceUpdate).toHaveBeenCalled();
      const args = mockPlugin.taskEditor.applyRecurrenceUpdate.mock.calls[0];
      expect(args[1].newScheduledDate).toBeNull();
    });

    it('should call applyRecurrenceUpdate when newDeadlineDate is provided', async () => {
      const task: Task = {
        ...createBaseTask(),
        path: 'test.md',
        line: 0,
        deadlineDate: new Date('2026-03-10'),
        deadlineDateRepeat: { type: '+', unit: 'w', value: 1, raw: '+1w' },
      };

      const newDeadlineDate = new Date('2026-03-17');

      await taskUpdateCoordinator.updateTaskRecurrence(task, {
        newDeadlineDate,
      });

      expect(mockPlugin.taskEditor.applyRecurrenceUpdate).toHaveBeenCalled();
      const args = mockPlugin.taskEditor.applyRecurrenceUpdate.mock.calls[0];
      expect(args[1].newDeadlineDate).toEqual(newDeadlineDate);
    });

    it('should call applyRecurrenceUpdate when newDeadlineDate is null to remove', async () => {
      const task: Task = {
        ...createBaseTask(),
        path: 'test.md',
        line: 0,
        deadlineDate: new Date('2026-03-10'),
        deadlineDateRepeat: { type: '+', unit: 'w', value: 1, raw: '+1w' },
      };

      await taskUpdateCoordinator.updateTaskRecurrence(task, {
        newDeadlineDate: null,
      });

      expect(mockPlugin.taskEditor.applyRecurrenceUpdate).toHaveBeenCalled();
      const args = mockPlugin.taskEditor.applyRecurrenceUpdate.mock.calls[0];
      expect(args[1].newDeadlineDate).toBeNull();
    });

    it('should call applyRecurrenceUpdate when newStateForRecurrence is provided', async () => {
      const task: Task = {
        ...createBaseTask(),
        path: 'test.md',
        line: 0,
        state: 'DONE',
      };

      await taskUpdateCoordinator.updateTaskRecurrence(task, {
        newStateForRecurrence: 'TODO',
      });

      expect(mockPlugin.taskEditor.applyRecurrenceUpdate).toHaveBeenCalled();
      const args = mockPlugin.taskEditor.applyRecurrenceUpdate.mock.calls[0];
      expect(args[1].newState).toBe('TODO');
    });

    it('should update state manager with all updated fields', async () => {
      const task: Task = {
        ...createBaseTask(),
        path: 'test.md',
        line: 0,
        state: 'DONE',
        scheduledDate: new Date('2026-03-10'),
        scheduledDateRepeat: { type: '+', unit: 'w', value: 1, raw: '+1w' },
        deadlineDate: new Date('2026-03-10'),
        deadlineDateRepeat: { type: '+', unit: 'w', value: 1, raw: '+1w' },
      };

      const newScheduledDate = new Date('2026-03-17');
      const newDeadlineDate = new Date('2026-03-17');
      const newStateForRecurrence = 'TODO';

      // Add task to state manager
      taskStateManager.setTasks([task]);

      await taskUpdateCoordinator.updateTaskRecurrence(task, {
        newScheduledDate,
        newDeadlineDate,
        newStateForRecurrence,
      });

      const updatedTask = taskStateManager.findTaskByPathAndLine('test.md', 0);
      expect(updatedTask).toBeDefined();
      // Check that the scheduled date was updated (compare using time value)
      expect(updatedTask?.scheduledDate?.getTime()).toEqual(
        newScheduledDate.getTime(),
      );
      expect(updatedTask?.deadlineDate?.getTime()).toEqual(
        newDeadlineDate.getTime(),
      );
      expect(updatedTask?.state).toBe(newStateForRecurrence);
    });
  });

  describe('first-only warning period stripping on recurrence', () => {
    it('should strip scheduled warning period when null is passed', async () => {
      const task: Task = {
        ...createBaseTask(),
        path: 'test.md',
        line: 0,
        scheduledDate: new Date('2026-03-10'),
        scheduledDateRepeat: { type: '+', unit: 'w', value: 1, raw: '+1w' },
        scheduledWarningPeriod: { value: 3, unit: 'd', isFirstOnly: true },
      };

      const newScheduledDate = new Date('2026-03-17');

      await taskUpdateCoordinator.updateTaskRecurrence(task, {
        newScheduledDate,
        newScheduledWarningPeriod: null, // strip --Nd
      });

      const calls = mockPlugin.taskEditor.applyRecurrenceUpdate.mock.calls;
      expect(calls.length).toBe(1);
      const options = calls[0][1];
      expect(options.newScheduledWarningPeriod).toBeNull();
    });

    it('should strip deadline warning period when null is passed', async () => {
      const task: Task = {
        ...createBaseTask(),
        path: 'test.md',
        line: 0,
        deadlineDate: new Date('2026-03-10'),
        deadlineDateRepeat: { type: '+', unit: 'w', value: 1, raw: '+1w' },
        deadlineWarningPeriod: { value: 5, unit: 'd', isFirstOnly: true },
      };

      const newDeadlineDate = new Date('2026-03-17');

      await taskUpdateCoordinator.updateTaskRecurrence(task, {
        newDeadlineDate,
        newDeadlineWarningPeriod: null, // strip --Nd
      });

      const calls = mockPlugin.taskEditor.applyRecurrenceUpdate.mock.calls;
      expect(calls.length).toBe(1);
      const options = calls[0][1];
      expect(options.newDeadlineWarningPeriod).toBeNull();
    });

    it('should preserve existing warning period when undefined is passed', async () => {
      const task: Task = {
        ...createBaseTask(),
        path: 'test.md',
        line: 0,
        scheduledDate: new Date('2026-03-10'),
        scheduledDateRepeat: { type: '+', unit: 'w', value: 1, raw: '+1w' },
        scheduledWarningPeriod: { value: 3, unit: 'd', isFirstOnly: true },
      };

      const newScheduledDate = new Date('2026-03-17');

      // Don't pass newScheduledWarningPeriod (undefined)
      await taskUpdateCoordinator.updateTaskRecurrence(task, {
        newScheduledDate,
      });

      const calls = mockPlugin.taskEditor.applyRecurrenceUpdate.mock.calls;
      expect(calls.length).toBe(1);
      const options = calls[0][1];
      // resolveRecurrenceWarningPeriod(undefined, existing) => existing
      expect(options.newScheduledWarningPeriod).toEqual({
        value: 3,
        unit: 'd',
        isFirstOnly: true,
      });
    });

    it('should pass through a new warning period', async () => {
      const task: Task = {
        ...createBaseTask(),
        path: 'test.md',
        line: 0,
        scheduledDate: new Date('2026-03-10'),
        scheduledDateRepeat: { type: '+', unit: 'w', value: 1, raw: '+1w' },
        scheduledWarningPeriod: { value: 3, unit: 'd', isFirstOnly: true },
      };

      const newScheduledDate = new Date('2026-03-17');

      await taskUpdateCoordinator.updateTaskRecurrence(task, {
        newScheduledDate,
        newScheduledWarningPeriod: { value: 7, unit: 'w', isFirstOnly: false },
      });

      const calls = mockPlugin.taskEditor.applyRecurrenceUpdate.mock.calls;
      expect(calls.length).toBe(1);
      const options = calls[0][1];
      expect(options.newScheduledWarningPeriod).toEqual({
        value: 7,
        unit: 'w',
        isFirstOnly: false,
      });
    });

    it('should preserve existing deadline warning period when undefined is passed', async () => {
      const task: Task = {
        ...createBaseTask(),
        path: 'test.md',
        line: 0,
        deadlineDate: new Date('2026-03-10'),
        deadlineDateRepeat: { type: '+', unit: 'w', value: 1, raw: '+1w' },
        deadlineWarningPeriod: { value: 5, unit: 'd', isFirstOnly: true },
      };

      const newDeadlineDate = new Date('2026-03-17');

      // Don't pass newDeadlineWarningPeriod (undefined)
      await taskUpdateCoordinator.updateTaskRecurrence(task, {
        newDeadlineDate,
      });

      const calls = mockPlugin.taskEditor.applyRecurrenceUpdate.mock.calls;
      expect(calls.length).toBe(1);
      const options = calls[0][1];
      // resolveRecurrenceWarningPeriod(undefined, existing) => existing
      expect(options.newDeadlineWarningPeriod).toEqual({
        value: 5,
        unit: 'd',
        isFirstOnly: true,
      });
    });

    it('should preserve regular -Nd warning period when null is passed (recurring periods persist)', async () => {
      const task: Task = {
        ...createBaseTask(),
        path: 'test.md',
        line: 0,
        scheduledDate: new Date('2026-03-10'),
        scheduledDateRepeat: { type: '+', unit: 'w', value: 1, raw: '+1w' },
        scheduledWarningPeriod: { value: 3, unit: 'd', isFirstOnly: false },
      };

      const newScheduledDate = new Date('2026-03-17');

      await taskUpdateCoordinator.updateTaskRecurrence(task, {
        newScheduledDate,
        newScheduledWarningPeriod: null, // null means "keep existing" for regular -Nd
      });

      const calls = mockPlugin.taskEditor.applyRecurrenceUpdate.mock.calls;
      expect(calls.length).toBe(1);
      const options = calls[0][1];
      // resolveRecurrenceWarningPeriod(null, non-firstOnly) => existing (regular periods persist)
      expect(options.newScheduledWarningPeriod).toEqual({
        value: 3,
        unit: 'd',
        isFirstOnly: false,
      });
    });

    it('should update state manager with stripped warning period', async () => {
      const task: Task = {
        ...createBaseTask(),
        path: 'test.md',
        line: 0,
        state: 'DONE',
        scheduledDate: new Date('2026-03-10'),
        scheduledDateRepeat: { type: '+', unit: 'w', value: 1, raw: '+1w' },
        scheduledWarningPeriod: { value: 3, unit: 'd', isFirstOnly: true },
      };

      // Add task to state manager
      taskStateManager.setTasks([task]);

      // Verify the task initially has warningPeriod
      const beforeTask = taskStateManager.findTaskByPathAndLine('test.md', 0);
      expect(beforeTask?.scheduledWarningPeriod).toEqual({
        value: 3,
        unit: 'd',
        isFirstOnly: true,
      });

      await taskUpdateCoordinator.updateTaskRecurrence(task, {
        newScheduledDate: new Date('2026-03-17'),
        newScheduledWarningPeriod: null, // strip
        newStateForRecurrence: 'TODO',
      });

      // State manager should reflect the stripped value
      const afterTask = taskStateManager.findTaskByPathAndLine('test.md', 0);
      expect(afterTask?.scheduledWarningPeriod).toBeNull();
    });

    it('should update state manager with stripped deadline warning period', async () => {
      const task: Task = {
        ...createBaseTask(),
        path: 'test.md',
        line: 0,
        state: 'DONE',
        deadlineDate: new Date('2026-03-10'),
        deadlineDateRepeat: { type: '+', unit: 'w', value: 1, raw: '+1w' },
        deadlineWarningPeriod: { value: 5, unit: 'd', isFirstOnly: true },
      };

      // Add task to state manager
      taskStateManager.setTasks([task]);

      // Verify the task initially has warningPeriod
      const beforeTask = taskStateManager.findTaskByPathAndLine('test.md', 0);
      expect(beforeTask?.deadlineWarningPeriod).toEqual({
        value: 5,
        unit: 'd',
        isFirstOnly: true,
      });

      await taskUpdateCoordinator.updateTaskRecurrence(task, {
        newDeadlineDate: new Date('2026-03-17'),
        newDeadlineWarningPeriod: null, // strip
        newStateForRecurrence: 'TODO',
      });

      // State manager should reflect the stripped value
      const afterTask = taskStateManager.findTaskByPathAndLine('test.md', 0);
      expect(afterTask?.deadlineWarningPeriod).toBeNull();
    });
  });

  describe('recurrence when schedule is added to a completed task', () => {
    function recurrenceSpy(): jest.SpyInstance {
      return jest.spyOn(
        (
          taskUpdateCoordinator as unknown as {
            recurrenceCoordinator: { scheduleRecurrence: () => void };
          }
        ).recurrenceCoordinator,
        'scheduleRecurrence',
      );
    }

    it('schedules recurrence when a repeat is added to a DONE task', async () => {
      const task: Task = {
        ...createBaseTask(),
        path: 'test.md',
        line: 0,
        state: 'DONE',
        completed: true,
        scheduledDate: new Date('2026-03-10'),
        scheduledDateRepeat: { type: '+', unit: 'w', value: 1, raw: '+1w' },
      };
      taskStateManager.addTask(task);
      const spy = recurrenceSpy();

      await taskUpdateCoordinator.updateTaskScheduledDate(
        task,
        new Date('2026-03-10'),
        { type: '+', unit: 'w', value: 1, raw: '+1w' },
      );

      expect(spy).toHaveBeenCalled();
    });

    it('does not schedule recurrence for an ARCHIVED task', async () => {
      const task: Task = {
        ...createBaseTask(),
        path: 'test.md',
        line: 0,
        state: 'ARCHIVED',
        completed: false,
        scheduledDate: new Date('2026-03-10'),
        scheduledDateRepeat: { type: '+', unit: 'w', value: 1, raw: '+1w' },
      };
      taskStateManager.addTask(task);
      const spy = recurrenceSpy();

      await taskUpdateCoordinator.updateTaskScheduledDate(
        task,
        new Date('2026-03-10'),
        { type: '+', unit: 'w', value: 1, raw: '+1w' },
      );

      expect(spy).not.toHaveBeenCalled();
    });

    it('does not schedule recurrence for a non-completed task', async () => {
      const task: Task = {
        ...createBaseTask(),
        path: 'test.md',
        line: 0,
        state: 'TODO',
        completed: false,
        scheduledDate: new Date('2026-03-10'),
        scheduledDateRepeat: { type: '+', unit: 'w', value: 1, raw: '+1w' },
      };
      taskStateManager.addTask(task);
      const spy = recurrenceSpy();

      await taskUpdateCoordinator.updateTaskScheduledDate(
        task,
        new Date('2026-03-10'),
        { type: '+', unit: 'w', value: 1, raw: '+1w' },
      );

      expect(spy).not.toHaveBeenCalled();
    });

    it('does not roll a recurring task when it is canceled', async () => {
      const task: Task = {
        ...createBaseTask(),
        path: 'test.md',
        line: 0,
        state: 'TODO',
        completed: false,
        scheduledDate: new Date('2026-03-10'),
        scheduledDateRepeat: { type: '+', unit: 'w', value: 1, raw: '+1w' },
      };
      taskStateManager.addTask(task);
      const spy = recurrenceSpy();
      (mockPlugin.taskEditor.updateTaskState as jest.Mock).mockClear();

      await taskUpdateCoordinator.updateTaskState(task, 'CANCELED');

      // Cancellation is terminal: no state reset, no recurrence.
      expect(mockPlugin.taskEditor.updateTaskState).toHaveBeenCalledWith(
        task,
        'CANCELED',
        { recordCompletion: false, forceVaultApi: false },
      );
      expect(spy).not.toHaveBeenCalled();
    });

    it('re-adds an un-archived task with its repeat metadata intact', async () => {
      const fullTask: Task = {
        ...createBaseTask(),
        path: 'test.md',
        line: 0,
        state: 'TODO',
        completed: false,
        scheduledDate: new Date('2026-03-10'),
        scheduledDateRepeat: { type: '+', unit: 'w', value: 1, raw: '+1w' },
      };
      // The task is not in the state manager (as after archiving), and the full
      // file parse (parseFile) supplies the date lines.
      const vaultScanner = (
        mockPlugin as unknown as {
          vaultScanner: {
            getParser: () => { parseFile: () => Task[] };
          };
        }
      ).vaultScanner;
      vaultScanner.getParser = () => ({ parseFile: () => [fullTask] });

      await taskUpdateCoordinator.updateTaskByPath(
        'test.md',
        0,
        'TODO',
        'task-list',
      );

      const stored = taskStateManager.findTaskByPathAndLine('test.md', 0);
      expect(stored?.scheduledDateRepeat).not.toBeNull();
      expect(stored?.scheduledDate).not.toBeNull();
    });

    it('does not roll a recurring task when it is CANCELLED', async () => {
      const task: Task = {
        ...createBaseTask(),
        path: 'test.md',
        line: 0,
        state: 'TODO',
        completed: false,
        deadlineDate: new Date('2026-03-10'),
        deadlineDateRepeat: { type: '+', unit: 'w', value: 1, raw: '+1w' },
      };
      taskStateManager.addTask(task);
      const spy = recurrenceSpy();
      (mockPlugin.taskEditor.updateTaskState as jest.Mock).mockClear();

      await taskUpdateCoordinator.updateTaskState(task, 'CANCELLED');

      expect(mockPlugin.taskEditor.updateTaskState).toHaveBeenCalledWith(
        task,
        'CANCELLED',
        { recordCompletion: false, forceVaultApi: false },
      );
      expect(spy).not.toHaveBeenCalled();
    });

    it('does not roll when a repeat is added to a canceled task', async () => {
      const task: Task = {
        ...createBaseTask(),
        path: 'test.md',
        line: 0,
        state: 'CANCELED',
        completed: true,
        scheduledDate: new Date('2026-03-10'),
        scheduledDateRepeat: { type: '+', unit: 'w', value: 1, raw: '+1w' },
      };
      taskStateManager.addTask(task);
      const spy = recurrenceSpy();

      await taskUpdateCoordinator.updateTaskScheduledDate(
        task,
        new Date('2026-03-10'),
        { type: '+', unit: 'w', value: 1, raw: '+1w' },
      );

      expect(spy).not.toHaveBeenCalled();
    });

    it('rolls when a deadline repeat is added to a DONE task', async () => {
      const task: Task = {
        ...createBaseTask(),
        path: 'test.md',
        line: 0,
        state: 'DONE',
        completed: true,
        deadlineDate: new Date('2026-03-10'),
        deadlineDateRepeat: { type: '+', unit: 'w', value: 1, raw: '+1w' },
      };
      taskStateManager.addTask(task);
      const spy = recurrenceSpy();

      await taskUpdateCoordinator.updateTaskDeadlineDate(
        task,
        new Date('2026-03-10'),
        { type: '+', unit: 'w', value: 1, raw: '+1w' },
      );

      expect(spy).toHaveBeenCalled();
    });

    it('a re-added task with a repeat rolls forward on completion', async () => {
      const fullTask: Task = {
        ...createBaseTask(),
        path: 'test.md',
        line: 0,
        state: 'TODO',
        completed: false,
        scheduledDate: new Date('2026-03-10'),
        scheduledDateRepeat: { type: '+', unit: 'w', value: 1, raw: '+1w' },
      };
      const vaultScanner = (
        mockPlugin as unknown as {
          vaultScanner: { getParser: () => { parseFile: () => Task[] } };
        }
      ).vaultScanner;
      vaultScanner.getParser = () => ({ parseFile: () => [fullTask] });

      await taskUpdateCoordinator.updateTaskByPath(
        'test.md',
        0,
        'TODO',
        'task-list',
      );
      const stored = taskStateManager.findTaskByPathAndLine('test.md', 0);
      expect(stored).toBeDefined();

      const spy = recurrenceSpy();
      await taskUpdateCoordinator.updateTaskState(stored as Task, 'DONE');

      expect(spy).toHaveBeenCalled();
    });

    it('keeps repeatCount when resolving a recurring task from the editor', async () => {
      const parser = TaskParser.create(keywordManager, null);
      mockPlugin.vaultScanner.getParser.mockReturnValue(parser);

      const editorLines = [
        '- [ ] TODO Pay rent',
        '  SCHEDULED: <2026-03-10 Tue +1w>',
        '  > [!repeats]- Repeats: 5 (latest 50)',
        '  > - #5 · closed 2026-03-10 Tue 09:12',
      ];
      const editor = {
        getLine: (i: number) => editorLines[i],
        lineCount: () => editorLines.length,
      };
      mockApp.workspace.getLeavesOfType.mockReturnValue([
        { view: createMarkdownViewStub('test.md', editor) },
      ]);

      const task: Task = {
        ...createBaseTask(),
        path: 'test.md',
        line: 0,
        rawText: editorLines[0],
        state: 'TODO',
        completed: false,
        scheduledDate: new Date('2026-03-10'),
        scheduledDateRepeat: { type: '+', unit: 'w', value: 1, raw: '+1w' },
        repeatCount: null,
      };
      taskStateManager.addTask(task);

      const spy = recurrenceSpy();
      await taskUpdateCoordinator.updateTask({
        type: 'state',
        task,
        newState: 'DONE',
        source: 'editor',
      });

      expect(spy).toHaveBeenCalled();
      expect(spy.mock.calls[0][0].repeatCount).toBe(5);
    });
  });

  describe('recurrence roll-forward write routing and state gating', () => {
    /**
     * performRecurrenceUpdate resolves its parser via app.plugins, which the
     * harness mockApp does not carry by default. Provide a minimal parser so
     * the roll-forward actually reaches the write.
     */
    function enableRecurrenceFire(): void {
      (mockApp as unknown as { plugins: unknown }).plugins = {
        getPlugin: () => ({
          vaultScanner: {
            getParser: () => ({
              getDateLineType: (line: string) =>
                line.includes('SCHEDULED') ? 'scheduled' : null,
            }),
          },
        }),
      };
    }

    function recurringTask(overrides: Partial<Task> = {}): Task {
      return {
        ...createBaseTask(),
        path: 'test.md',
        line: 0,
        state: 'TODO',
        completed: false,
        scheduledDate: new Date('2026-03-10'),
        scheduledDateRepeat: { type: '+', unit: 'w', value: 1, raw: '+1w' },
        ...overrides,
      };
    }

    function performRecurrence(
      task: Task,
      source: 'editor' | 'task-list',
    ): Promise<unknown> {
      return (
        taskUpdateCoordinator as unknown as {
          recurrenceCoordinator: {
            performRecurrenceUpdate: (
              task: Task,
              source: 'editor' | 'task-list',
            ) => Promise<unknown>;
          };
        }
      ).recurrenceCoordinator.performRecurrenceUpdate(task, source);
    }

    function recurrenceScheduleSpy(): jest.SpyInstance {
      return jest.spyOn(
        (
          taskUpdateCoordinator as unknown as {
            recurrenceCoordinator: { scheduleRecurrence: () => void };
          }
        ).recurrenceCoordinator,
        'scheduleRecurrence',
      );
    }

    it('schedules the roll-forward with the triggering update source', async () => {
      const task = recurringTask();
      taskStateManager.addTask(task);
      const spy = recurrenceScheduleSpy();

      await taskUpdateCoordinator.updateTaskState(task, 'DONE');
      expect(spy).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        'editor',
      );

      spy.mockClear();
      await taskUpdateCoordinator.updateTaskByPath(
        'test.md',
        0,
        'DONE',
        'task-list',
      );
      expect(spy).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        'task-list',
      );
    });

    it('rolls forward through the editor write path for an editor-source update', async () => {
      enableRecurrenceFire();
      const task = recurringTask();
      taskStateManager.addTask(task);

      await performRecurrence(task, 'editor');

      expect(mockPlugin.taskEditor.applyRecurrenceUpdate).toHaveBeenCalled();
      expect(
        mockPlugin.taskEditor.applyRecurrenceUpdate.mock.calls[0][1]
          .forceVaultApi,
      ).toBe(false);
    });

    it('rolls forward through the vault write path for a task-list-source update', async () => {
      enableRecurrenceFire();
      const task = recurringTask();
      taskStateManager.addTask(task);

      await performRecurrence(task, 'task-list');

      expect(mockPlugin.taskEditor.applyRecurrenceUpdate).toHaveBeenCalled();
      expect(
        mockPlugin.taskEditor.applyRecurrenceUpdate.mock.calls[0][1]
          .forceVaultApi,
      ).toBe(true);
    });

    it('does not reset the state when the task is no longer completed at fire time', async () => {
      enableRecurrenceFire();
      const task = recurringTask({
        state: 'DOING',
        completed: false,
        rawText: 'DOING Task text',
      });
      taskStateManager.addTask(task);

      await performRecurrence(task, 'task-list');

      expect(mockPlugin.taskEditor.applyRecurrenceUpdate).toHaveBeenCalled();
      expect(
        mockPlugin.taskEditor.applyRecurrenceUpdate.mock.calls[0][1].newState,
      ).toBeUndefined();
      expect(taskStateManager.findTaskByPathAndLine('test.md', 0)?.state).toBe(
        'DOING',
      );
    });

    it('still resets the state when the task is completed at fire time', async () => {
      enableRecurrenceFire();
      const task = recurringTask({
        state: 'DONE',
        completed: true,
        rawText: 'DONE Task text',
      });
      taskStateManager.addTask(task);

      await performRecurrence(task, 'task-list');

      expect(mockPlugin.taskEditor.applyRecurrenceUpdate).toHaveBeenCalled();
      expect(
        mockPlugin.taskEditor.applyRecurrenceUpdate.mock.calls[0][1].newState,
      ).toBe('TODO');
      expect(taskStateManager.findTaskByPathAndLine('test.md', 0)?.state).toBe(
        'TODO',
      );
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    taskUpdateCoordinator.destroy();
  });
});
