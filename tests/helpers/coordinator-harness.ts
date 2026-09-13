import { TaskUpdateCoordinator } from '../../src/services/task-update-coordinator';
import { TaskStateManager } from '../../src/services/task-state-manager';
import { KeywordManager } from '../../src/utils/keyword-manager';
import type { Task } from '../../src/types/task';
import type { TodoTrackerSettings } from '../../src/settings/settings-types';
import { createBaseSettings, createTestKeywordManager } from './test-helper';

/** The TaskWriter surface mocked by the coordinator tests. */
export interface CoordinatorTaskEditorMock {
  updateTaskState: jest.Mock;
  updateTaskCycleState: jest.Mock;
  updateTaskScheduledDate: jest.Mock;
  removeTaskScheduledDate: jest.Mock;
  updateTaskDeadlineDate: jest.Mock;
  removeTaskDeadlineDate: jest.Mock;
  updateTaskPriority: jest.Mock;
  removeTaskPriority: jest.Mock;
  updateTaskClosedDate: jest.Mock;
  removeTaskClosedDate: jest.Mock;
  updateTaskStartedDate: jest.Mock;
  updateTaskRecurrence: jest.Mock;
  applyRecurrenceUpdate: jest.Mock;
}

export interface CoordinatorHarness {
  mockApp: {
    vault: {
      getAbstractFileByPath: jest.Mock;
      process: jest.Mock;
      read: jest.Mock;
    };
    workspace: { getActiveViewOfType: jest.Mock };
  };
  mockPlugin: {
    app: CoordinatorHarness['mockApp'];
    settings: ReturnType<typeof createBaseSettings>;
    isUserInitiatedUpdate: boolean;
    taskEditor: CoordinatorTaskEditorMock;
    taskStateManager: TaskStateManager;
    embeddedTaskListProcessor: { refreshAllEmbeddedTaskLists: jest.Mock };
    refreshVisibleEditorDecorations: jest.Mock;
    vaultScanner: {
      processIncrementalChange: jest.Mock;
      addSkipIncrementalChange: jest.Mock;
      getParser: jest.Mock;
    };
  };
  keywordManager: KeywordManager;
  stateManager: TaskStateManager;
  coordinator: TaskUpdateCoordinator;
  taskEditor: CoordinatorTaskEditorMock;
}

/**
 * Builds the common mock App/plugin/state-manager/coordinator used by the
 * `task-update-coordinator-*` suites. Per-file behavior (file contents, task
 * editor return values) is still set up by each test.
 */
export function createCoordinatorHarness(
  options: {
    settings?: Partial<TodoTrackerSettings>;
    changeTracker?: unknown;
  } = {},
): CoordinatorHarness {
  // The coordinator's embed DOM update reads window.activeDocument.
  const doc =
    typeof document !== 'undefined'
      ? document
      : ({ querySelectorAll: () => [] } as unknown as Document);
  if (typeof window !== 'undefined') {
    (window as unknown as { activeDocument: Document }).activeDocument = doc;
  }

  const taskEditor: CoordinatorTaskEditorMock = {
    updateTaskState: jest.fn(),
    updateTaskCycleState: jest.fn(),
    updateTaskScheduledDate: jest.fn(),
    removeTaskScheduledDate: jest.fn(),
    updateTaskDeadlineDate: jest.fn(),
    removeTaskDeadlineDate: jest.fn(),
    updateTaskPriority: jest.fn(),
    removeTaskPriority: jest.fn(),
    updateTaskClosedDate: jest.fn(),
    removeTaskClosedDate: jest.fn(),
    updateTaskStartedDate: jest.fn(),
    updateTaskRecurrence: jest.fn(),
    applyRecurrenceUpdate: jest.fn(),
  };

  const mockApp = {
    vault: {
      getAbstractFileByPath: jest.fn(),
      process: jest.fn(),
      read: jest.fn(),
    },
    workspace: {
      getActiveViewOfType: jest.fn(),
    },
  };

  const settings = createBaseSettings(options.settings);
  const keywordManager = createTestKeywordManager(settings);
  const stateManager = new TaskStateManager(keywordManager);

  const mockPlugin = {
    app: mockApp,
    settings,
    isUserInitiatedUpdate: false,
    taskEditor,
    taskStateManager: stateManager,
    embeddedTaskListProcessor: {
      refreshAllEmbeddedTaskLists: jest.fn(),
    },
    refreshVisibleEditorDecorations: jest.fn(),
    vaultScanner: {
      processIncrementalChange: jest.fn(),
      addSkipIncrementalChange: jest.fn(),
      getParser: jest.fn(),
    },
  };

  const coordinator = new TaskUpdateCoordinator(
    mockPlugin as never,
    stateManager,
    keywordManager,
    options.changeTracker as never,
  );

  // Default implementations mirroring the real writer's snapshots closely
  // enough for the coordinator's finalize/recurrence logic. Tests may override.
  taskEditor.updateTaskState.mockImplementation(
    async (task: Task, newState: string) => ({
      ...task,
      state: newState,
      rawText: task.rawText.replace(task.state, newState),
    }),
  );
  taskEditor.updateTaskScheduledDate.mockImplementation(
    async (
      task: Task,
      newDate: Date,
      repeat: Task['scheduledDateRepeat'],
      warningPeriod: Task['scheduledWarningPeriod'],
    ) => ({
      ...task,
      scheduledDate: newDate,
      scheduledDateRepeat: repeat,
      scheduledWarningPeriod: warningPeriod,
      lineDelta: 1,
    }),
  );
  taskEditor.removeTaskScheduledDate.mockImplementation(async (task: Task) => ({
    ...task,
    scheduledDate: null,
    scheduledDateRepeat: null,
    lineDelta: -1,
  }));
  taskEditor.updateTaskDeadlineDate.mockImplementation(
    async (
      task: Task,
      newDate: Date,
      repeat: Task['deadlineDateRepeat'],
      warningPeriod: Task['deadlineWarningPeriod'],
    ) => ({
      ...task,
      deadlineDate: newDate,
      deadlineDateRepeat: repeat,
      deadlineWarningPeriod: warningPeriod,
      lineDelta: 1,
    }),
  );
  taskEditor.removeTaskDeadlineDate.mockImplementation(async (task: Task) => ({
    ...task,
    deadlineDate: null,
    deadlineDateRepeat: null,
    lineDelta: -1,
  }));
  taskEditor.updateTaskPriority.mockImplementation(
    async (task: Task, newPriority: Task['priority']) => ({
      ...task,
      priority: newPriority,
    }),
  );
  taskEditor.removeTaskPriority.mockImplementation(async (task: Task) => ({
    ...task,
    priority: null,
  }));
  taskEditor.applyRecurrenceUpdate.mockImplementation(
    async (task: Task, options: Record<string, unknown>) => {
      const result = { ...task };
      if (options.newScheduledDate !== undefined) {
        result.scheduledDate = options.newScheduledDate as Date | null;
        result.scheduledDateRepeat =
          (options.newScheduledRepeat as Task['scheduledDateRepeat']) ??
          task.scheduledDateRepeat;
        result.scheduledWarningPeriod =
          options.newScheduledWarningPeriod !== undefined
            ? (options.newScheduledWarningPeriod as Task['scheduledWarningPeriod'])
            : task.scheduledWarningPeriod;
      }
      if (options.newDeadlineDate !== undefined) {
        result.deadlineDate = options.newDeadlineDate as Date | null;
        result.deadlineDateRepeat =
          (options.newDeadlineRepeat as Task['deadlineDateRepeat']) ??
          task.deadlineDateRepeat;
        result.deadlineWarningPeriod =
          options.newDeadlineWarningPeriod !== undefined
            ? (options.newDeadlineWarningPeriod as Task['deadlineWarningPeriod'])
            : task.deadlineWarningPeriod;
      }
      if (options.newState !== undefined) {
        result.state = options.newState as string;
        result.completed = false;
        result.rawText = task.rawText.replace(
          task.state,
          options.newState as string,
        );
      }
      return result;
    },
  );

  return {
    mockApp,
    mockPlugin,
    keywordManager,
    stateManager,
    coordinator,
    taskEditor,
  };
}
