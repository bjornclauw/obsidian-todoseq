import {
  sortTasksWithThreeBlockSystem,
  buildKeywordSortConfig,
  KeywordSortConfig,
  SortMethod,
  SortDirection,
  getNaturalDirection,
  isSortMethod,
} from '../../utils/task-sort';
import { Task } from '../../types/task';
import TodoTracker from '../../main';
import { KeywordManager } from '../../utils/keyword-manager';

export type { SortMethod };

export type TaskListViewMode =
  'showAll' | 'sortCompletedLast' | 'hideCompleted';

export class TaskListFilter {
  private plugin: TodoTracker;
  private keywordManager: KeywordManager;
  private cachedKeywordConfig: KeywordSortConfig | null = null;
  private cachedKeywords: string | null = null;

  constructor(plugin: TodoTracker, keywordManager: KeywordManager) {
    this.plugin = plugin;
    this.keywordManager = keywordManager;
  }

  getViewMode(contentEl: HTMLElement): TaskListViewMode {
    const attr = contentEl.getAttr('data-view-mode');
    if (typeof attr === 'string') {
      if (attr === 'default') return 'showAll';
      if (attr === 'sortCompletedLast') return 'sortCompletedLast';
      if (attr === 'hideCompleted') return 'hideCompleted';
      if (
        attr === 'showAll' ||
        attr === 'sortCompletedLast' ||
        attr === 'hideCompleted'
      )
        return attr;
    }
    return 'showAll';
  }

  setViewMode(contentEl: HTMLElement, mode: TaskListViewMode): void {
    contentEl.setAttr('data-view-mode', mode);
  }

  getSortMethod(
    contentEl: HTMLElement,
    defaultSortMethod: SortMethod,
  ): SortMethod {
    const attr = contentEl.getAttr('data-sort-method');
    if (isSortMethod(attr)) return attr;
    if (isSortMethod(defaultSortMethod)) return defaultSortMethod;
    return 'default';
  }

  setSortMethod(contentEl: HTMLElement, method: SortMethod): void {
    contentEl.setAttr('data-sort-method', method);
  }

  filterTasksByViewMode(tasks: Task[], mode: TaskListViewMode): Task[] {
    if (mode === 'hideCompleted') {
      return tasks.filter((t) => !t.completed);
    }
    return tasks.slice();
  }

  transformForView(
    tasks: Task[],
    mode: TaskListViewMode,
    sortMethod: SortMethod,
    direction: SortDirection | 'natural' = 'natural',
  ): Task[] {
    const now = new Date();

    let completedSetting: 'showAll' | 'sortToEnd' | 'hide';
    switch (mode) {
      case 'hideCompleted':
        completedSetting = 'hide';
        break;
      case 'sortCompletedLast':
        completedSetting = 'sortToEnd';
        break;
      case 'showAll':
      default:
        completedSetting = 'showAll';
        break;
    }

    const futureSetting = this.plugin.settings.futureTaskSorting;

    let keywordConfig: KeywordSortConfig | undefined;
    if (
      sortMethod === 'sortByKeyword' ||
      sortMethod === 'sortByUrgency' ||
      sortMethod === 'sortByPriority' ||
      sortMethod === 'sortByScheduled' ||
      sortMethod === 'sortByDeadline' ||
      sortMethod === 'sortByClosedDate' ||
      sortMethod === 'sortByStarted'
    ) {
      keywordConfig = this.getKeywordSortConfig();
    }

    const effectiveDirection: SortDirection =
      direction === 'natural' ? getNaturalDirection(sortMethod) : direction;

    const sortedTasks = sortTasksWithThreeBlockSystem(
      tasks,
      now,
      futureSetting,
      completedSetting,
      sortMethod,
      keywordConfig,
      {
        upcomingPeriod: this.plugin.settings.upcomingPeriod,
        defaultDeadlineWarningPeriod:
          this.plugin.settings.defaultDeadlineWarningPeriod,
        defaultScheduledWarningPeriod:
          this.plugin.settings.defaultScheduledWarningPeriod,
        skipScheduledWarningPeriodIfDeadline:
          this.plugin.settings.skipScheduledWarningPeriodIfDeadline,
        skipDeadlinePrewarningIfScheduled:
          this.plugin.settings.skipDeadlinePrewarningIfScheduled,
      },
      effectiveDirection,
    );

    return sortedTasks;
  }

  getKeywordSortConfig(): KeywordSortConfig {
    const keywords = this.keywordManager.getAllKeywords().join(',');
    if (!this.cachedKeywordConfig || this.cachedKeywords !== keywords) {
      this.cachedKeywords = keywords;
      this.cachedKeywordConfig = buildKeywordSortConfig(this.keywordManager);
    }

    return this.cachedKeywordConfig;
  }
}
