import { Task } from '../types/task';
import { TaskStateManager } from '../services/task-state-manager';
import {
  getStateTransitionManager,
  TaskUpdateCoordinator,
} from '../services/task-update-coordinator';
import { KeywordManager } from '../utils/keyword-manager';
import type { StateTransitionSettings } from '../settings/settings-types';

/**
 * Version of the public API surface. Bump when a backwards-incompatible
 * change is made so external consumers can detect it.
 */
export const TODOSEQ_API_VERSION = 1;

/**
 * Minimal view of the plugin required by {@link TodoseqApi}. Kept small so the
 * API can be unit-tested without constructing a full Obsidian plugin.
 */
export interface TodoseqApiHost {
  taskStateManager: TaskStateManager;
  taskUpdateCoordinator: TaskUpdateCoordinator | null;
  keywordManager: KeywordManager;
  settings: { stateTransitions?: StateTransitionSettings };
  scanVault(): Promise<void>;
}

/**
 * Public API exposed to other Obsidian plugins as `app.plugins.plugins.todoseq.api`.
 *
 * All task writes go through the same `TaskUpdateCoordinator` used by the
 * plugin's own views, so external changes participate in the recurrence,
 * metadata and state-transition handling exactly like an in-app edit.
 */
export interface TodoseqApi {
  /** Version of this API surface. */
  readonly version: number;

  /**
   * Get all currently known tasks.
   * @returns A shallow copy of the task array.
   */
  getTasks(): Task[];

  /**
   * Subscribe to task changes. The callback fires immediately with the current
   * tasks and again whenever the task set changes.
   * @param callback Receives the full task array on each change.
   * @returns An unsubscribe function.
   */
  onTasksChanged(callback: (tasks: Task[]) => void): () => void;

  /**
   * Toggle a task's completion: complete it if open, reactivate it if
   * completed. Resolves with the new state keyword, or `null` when no task was
   * found at the given location.
   */
  toggleTask(
    path: string,
    line: number,
    cellIndex?: number,
  ): Promise<string | null>;

  /**
   * Set a task's state keyword explicitly.
   * @returns The new state keyword, or `null` when no task was found.
   */
  setTaskState(
    path: string,
    line: number,
    newState: string,
    cellIndex?: number,
  ): Promise<string | null>;

  /** Trigger a full vault rescan. */
  rescan(): Promise<void>;
}

export class TodoseqApiImpl implements TodoseqApi {
  public readonly version: number = TODOSEQ_API_VERSION;

  constructor(private host: TodoseqApiHost) {}

  getTasks(): Task[] {
    return this.host.taskStateManager.getTasks();
  }

  onTasksChanged(callback: (tasks: Task[]) => void): () => void {
    return this.host.taskStateManager.subscribe((tasks) => callback(tasks));
  }

  async toggleTask(
    path: string,
    line: number,
    cellIndex?: number,
  ): Promise<string | null> {
    const task = this.findTask(path, line, cellIndex);
    if (!task) {
      return null;
    }

    const transitionManager = getStateTransitionManager(
      this.host.taskUpdateCoordinator,
      this.host.keywordManager,
      this.host.settings?.stateTransitions,
    );
    const newState = this.host.keywordManager.isCompleted(task.state)
      ? transitionManager.getNextState(task.state)
      : transitionManager.getNextCompletedOrArchivedState(task.state);

    return this.setTaskState(path, line, newState, cellIndex);
  }

  async setTaskState(
    path: string,
    line: number,
    newState: string,
    cellIndex?: number,
  ): Promise<string | null> {
    const task = this.findTask(path, line, cellIndex);
    if (!task) {
      return null;
    }

    if (task.state === newState) {
      return newState;
    }

    const coordinator = this.host.taskUpdateCoordinator;
    if (!coordinator) {
      throw new Error(
        'TODOseq is not fully initialized; task state cannot be updated yet.',
      );
    }

    await coordinator.updateTaskByPath(path, line, newState, 'api', cellIndex);
    return newState;
  }

  async rescan(): Promise<void> {
    await this.host.scanVault();
  }

  private findTask(
    path: string,
    line: number,
    cellIndex?: number,
  ): Task | null {
    return (
      this.host.taskStateManager.findTaskByPathAndLine(path, line, cellIndex) ??
      null
    );
  }
}
