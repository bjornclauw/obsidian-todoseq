import { Task, DateRepeatInfo, WarningPeriodInfo } from '../../types/task';
import TodoTracker from '../../main';
import { TodoseqParameters } from './code-block-parser';
import { TFile, setIcon, Notice } from 'obsidian';
import { StateMenuBuilder } from '../components/state-menu-builder';
import { TaskContextMenu } from '../components/task-context-menu';
import {
  getTodayDailyNote,
  isTaskOnTodayDailyNote,
} from '../../utils/daily-note-utils';
import {
  getTaskRemovalRange,
  modifyLinesForMigration,
  readTaskBlockFromVault,
} from '../../utils/task-sub-bullets';
import { EmbeddedTaskItemRenderer } from './embedded-task-item-renderer';
import { groupTasks, getNaturalGroupDirection } from '../../utils/task-group';

/**
 * Snapshot of the last rendered (non-collapsible) list for a container, used
 * to update rows in place when the same tasks are shown in the same order.
 */
interface RenderedListSnapshot {
  paramsSignature: string;
  keys: string[];
  tasks: Task[];
}

/**
 * Renders interactive task lists within code blocks.
 * Handles task state changes and navigation.
 */
export class EmbeddedTaskListRenderer {
  private plugin: TodoTracker;
  private menuBuilder: StateMenuBuilder;
  private taskContextMenu: TaskContextMenu;
  private itemRenderer: EmbeddedTaskItemRenderer;
  private renderedLists = new WeakMap<HTMLElement, RenderedListSnapshot>();

  constructor(plugin: TodoTracker) {
    this.plugin = plugin;
    this.menuBuilder = new StateMenuBuilder(plugin);

    // Create task context menu for right-click actions
    this.taskContextMenu = new TaskContextMenu(
      {
        onGoToTask: (task) => this.itemRenderer.navigateToTask(task),
        onCopyTask: (task) => this.copyTaskToClipboard(task),
        onCopyTaskToToday: async (task) => await this.copyTaskToToday(task),
        onMoveTaskToToday: async (task) => await this.moveTaskToToday(task),
        onMigrateTaskToToday: async (task) =>
          await this.migrateTaskToToday(task),
        onPriorityChange: (task, priority) =>
          this.handlePriorityChange(task, priority),
        onScheduledDateChange: (task, date, repeat, warningPeriod) =>
          this.handleScheduledDateChange(task, date, repeat, warningPeriod),
        onDeadlineDateChange: (task, date, repeat, warningPeriod) =>
          this.handleDeadlineDateChange(task, date, repeat, warningPeriod),
      },
      {
        weekStartsOn: plugin.settings.weekStartsOn,
        migrateToTodayState: plugin.settings.migrateToTodayState,
      },
      plugin.app,
      this.plugin.taskStateManager,
    );

    this.itemRenderer = new EmbeddedTaskItemRenderer(
      plugin,
      this.menuBuilder,
      this.taskContextMenu,
    );
  }

  /**
   * Copy task to clipboard in Org mode format
   */
  private async copyTaskToClipboard(task: Task): Promise<void> {
    const allLines = await readTaskBlockFromVault(this.plugin.app, task);
    const textToCopy = allLines.join('\n');
    navigator.clipboard.writeText(textToCopy).then(
      () => {
        new Notice('Task copied to clipboard');
      },
      () => {
        new Notice('Failed to copy task');
      },
    );
  }

  /**
   * Copy task to today's daily note
   */
  private async copyTaskToToday(task: Task): Promise<void> {
    const todayNote = await getTodayDailyNote(this.plugin.app);
    if (!todayNote) {
      new Notice('Failed to get or create today daily note');
      return;
    }

    if (isTaskOnTodayDailyNote(task, todayNote)) {
      new Notice('Task is already on today daily note');
      return;
    }

    const allLines = await readTaskBlockFromVault(this.plugin.app, task);
    const currentContent = await this.plugin.app.vault.read(todayNote);
    const newContent =
      currentContent.trimEnd() + '\n\n' + allLines.join('\n') + '\n';
    await this.plugin.app.vault.modify(todayNote, newContent);
    new Notice('Task copied to today daily note');
  }

  /**
   * Move task to today's daily note
   */
  private async moveTaskToToday(task: Task): Promise<void> {
    const todayNote = await getTodayDailyNote(this.plugin.app);
    if (!todayNote) {
      new Notice('Failed to get or create today daily note');
      return;
    }

    if (isTaskOnTodayDailyNote(task, todayNote)) {
      new Notice('Task is already on today daily note');
      return;
    }

    const allLines = await readTaskBlockFromVault(this.plugin.app, task);

    const todayContent = await this.plugin.app.vault.read(todayNote);
    const newTodayContent =
      todayContent.trimEnd() + '\n\n' + allLines.join('\n') + '\n';
    await this.plugin.app.vault.modify(todayNote, newTodayContent);

    const sourceFile = this.plugin.app.vault.getAbstractFileByPath(task.path);
    if (!(sourceFile instanceof TFile)) {
      new Notice('Failed to find source file');
      return;
    }

    const sourceContent = await this.plugin.app.vault.read(sourceFile);
    const sourceLines = sourceContent.split('\n');
    const { start, end } = getTaskRemovalRange(sourceLines, task);
    const newSourceLines = [
      ...sourceLines.slice(0, start),
      ...sourceLines.slice(end + 1),
    ];
    await this.plugin.app.vault.modify(sourceFile, newSourceLines.join('\n'));
    new Notice('Task moved to today daily note');
  }

  /**
   * Migrate task to today's daily note
   * Copies the task to today's daily note and updates the source task
   * to the migrated state keyword.
   */
  private async migrateTaskToToday(task: Task): Promise<void> {
    const todayNote = await getTodayDailyNote(this.plugin.app);
    if (!todayNote) {
      new Notice('Failed to get or create today daily note');
      return;
    }

    if (isTaskOnTodayDailyNote(task, todayNote)) {
      new Notice('Task is already on today daily note');
      return;
    }

    const allLines = await readTaskBlockFromVault(this.plugin.app, task);

    const todayContent = await this.plugin.app.vault.read(todayNote);
    const newTodayContent =
      todayContent.trimEnd() + '\n\n' + allLines.join('\n') + '\n';
    await this.plugin.app.vault.modify(todayNote, newTodayContent);

    const sourceFile = this.plugin.app.vault.getAbstractFileByPath(task.path);
    if (!(sourceFile instanceof TFile)) {
      new Notice('Failed to find source file');
      return;
    }

    const sourceContent = await this.plugin.app.vault.read(sourceFile);
    const sourceLines = sourceContent.split('\n');
    const migrateState = this.plugin.settings.migrateToTodayState;
    const taskKeyword = task.state || 'TODO';
    const modified = modifyLinesForMigration(
      sourceLines,
      task,
      taskKeyword,
      migrateState,
    );
    await this.plugin.app.vault.modify(sourceFile, modified.join('\n'));
    new Notice('Task migrated to today daily note');
  }

  /**
   * Handle priority change from context menu
   * Uses TaskUpdateCoordinator for optimistic UI updates
   */
  private async handlePriorityChange(
    task: Task,
    priority: 'high' | 'med' | 'low' | null,
  ): Promise<void> {
    // Get the coordinator from the plugin (no window-cast needed; this.plugin
    // is the same instance exposed globally and is reliably available here).
    const coordinator = this.plugin.taskUpdateCoordinator;

    if (!coordinator) {
      console.error('TODOseq: TaskUpdateCoordinator not available');
      return;
    }

    try {
      // Get the current task from state manager to ensure we have the latest data
      // The task parameter might be stale if the task was updated previously
      const currentTask = this.plugin.taskStateManager.findTaskByPathAndLine(
        task.path,
        task.line,
        task.tableCell?.cellIndex,
      );
      if (!currentTask) {
        console.error('TODOseq: Task not found in state manager');
        return;
      }

      // Use TaskUpdateCoordinator for optimistic UI updates.
      // Mirrors the date-change handlers in this class, which already use the plugin reference.
      await coordinator.updateTaskPriority(currentTask, priority);
    } catch (error) {
      console.error('TODOseq: Failed to update task priority:', error);
    }
  }

  /**
   * Handle scheduled date change from context menu
   * Uses TaskUpdateCoordinator for optimistic UI updates
   */
  private async handleScheduledDateChange(
    task: Task,
    date: Date | null,
    repeat?: DateRepeatInfo | null,
    warningPeriod?: WarningPeriodInfo | null,
  ): Promise<void> {
    try {
      // Use TaskUpdateCoordinator for optimistic UI updates
      await this.plugin.taskUpdateCoordinator?.updateTaskScheduledDate(
        task,
        date,
        repeat,
        warningPeriod,
      );
    } catch (error) {
      console.error('TODOseq: Failed to update scheduled date:', error);
    }
  }

  /**
   * Handle deadline date change from context menu
   * Uses TaskUpdateCoordinator for optimistic UI updates
   */
  private async handleDeadlineDateChange(
    task: Task,
    date: Date | null,
    repeat?: DateRepeatInfo | null,
    warningPeriod?: WarningPeriodInfo | null,
  ): Promise<void> {
    try {
      // Use TaskUpdateCoordinator for optimistic UI updates
      await this.plugin.taskUpdateCoordinator?.updateTaskDeadlineDate(
        task,
        date,
        repeat,
        warningPeriod,
      );
    } catch (error) {
      console.error('TODOseq: Failed to update deadline date:', error);
    }
  }

  /**
   * Render a task list within the given container element
   * @param container The container element to render into
   * @param tasks Tasks to render
   * @param params Code block parameters for context
   * @param totalTasksCount Total number of tasks before applying limit
   * @param isCollapsed Current collapse state (for collapsible lists)
   * @param toggleCollapse Callback to toggle collapse state
   * @param containerId Unique ID for this code block (used for toggle callback)
   */
  renderTaskList(
    container: HTMLElement,
    tasks: Task[],
    params: TodoseqParameters,
    totalTasksCount?: number,
    isCollapsed?: boolean,
    toggleCollapse?: (containerId: string) => void,
    containerId?: string,
  ): void {
    // Re-rendering rebuilds the list DOM, which can make the containing view
    // jump (e.g. after changing a task's state). Remember the scroll position
    // of the nearest scrollable ancestor and restore it after the rebuild.
    const scrollParent = this.getScrollParent(container);
    const previousScrollTop = scrollParent ? scrollParent.scrollTop : null;
    const restoreScroll = () => {
      if (scrollParent && previousScrollTop !== null) {
        scrollParent.scrollTop = previousScrollTop;
      }
    };

    // Handle collapsible mode with incremental updates to prevent flicker
    if (params.collapse) {
      const hasTitle = !!params.title;
      const taskListContainer = container.querySelector(
        '.todoseq-embedded-task-list-container',
      );

      // Check if we can do an incremental update (container exists with correct structure)
      if (taskListContainer) {
        // Incremental update - keep header, just update state and content
        this.updateCollapsibleList(
          taskListContainer as HTMLElement,
          tasks,
          params,
          isCollapsed ?? true,
          totalTasksCount,
          hasTitle,
          toggleCollapse,
          containerId,
        );
        restoreScroll();
        return;
      }

      // Full render needed. Build detached and swap in one mutation so the
      // block never collapses to zero height mid-update.
      const staging = createDiv();

      // Create task list container
      const newContainer = staging.createDiv({
        cls: 'todoseq-embedded-task-list-container',
      });

      // Add collapse state class
      newContainer.addClass(
        isCollapsed
          ? 'todoseq-embedded-task-list-collapsed'
          : 'todoseq-embedded-task-list-expanded',
      );

      if (hasTitle) {
        // When title is set: render title row as collapsible toggle
        this.renderCollapsibleTitle(
          newContainer,
          params,
          isCollapsed ?? true,
          totalTasksCount ?? tasks.length,
          toggleCollapse,
          containerId,
        );
      } else {
        // When no title: render a consistent header that serves as toggle
        this.renderCollapsibleHeaderNoTitle(
          newContainer,
          params,
          isCollapsed ?? true,
          totalTasksCount ?? tasks.length,
          toggleCollapse,
          containerId,
        );
      }

      if (isCollapsed) {
        // Render collapsed footer with total result count
        this.renderCollapsedFooter(newContainer, tasks.length, totalTasksCount);
      } else {
        // Render expanded content
        if (hasTitle) {
          // For title case: include search settings header (no toggle params)
          // Pass renderHeader=true to show search options below the title
          this.renderExpandedContent(
            newContainer,
            tasks,
            params,
            totalTasksCount,
            undefined,
            undefined,
            isCollapsed,
            true, // Render search options header when expanded with title
          );
        } else {
          // For no-title case: header already exists, just add task list to avoid flicker
          this.renderExpandedContent(
            newContainer,
            tasks,
            params,
            totalTasksCount,
            toggleCollapse,
            containerId,
            isCollapsed,
            false, // Don't render header - it already exists
          );
        }
      }

      container.replaceChildren(...Array.from(staging.childNodes));
    } else {
      // Fast path: when the same tasks are shown in the same order, update the
      // changed rows in place instead of rebuilding the list. This avoids the
      // flicker / viewport jump and lets the state keyword animate.
      const paramsSignature = this.listParamsSignature(params, totalTasksCount);
      const previous = this.renderedLists.get(container);
      if (
        !params.groupBy &&
        previous &&
        previous.paramsSignature === paramsSignature &&
        this.sameTaskOrder(previous.keys, tasks) &&
        this.sameStaticRows(previous.tasks, tasks)
      ) {
        this.updateVisibleRows(previous.tasks, tasks, container);
        this.renderedLists.set(container, {
          paramsSignature,
          keys: this.taskKeys(tasks),
          tasks,
        });
        restoreScroll();
        return;
      }

      // Standard non-collapsible rendering. Build the new content detached
      // first, then swap it in with a single DOM mutation, so the block never
      // collapses to zero height mid-update (which nudges the editor).
      const staging = createDiv();
      const taskListContainer = staging.createDiv({
        cls: 'todoseq-embedded-task-list-container',
      });

      this.renderStandardContent(
        taskListContainer,
        tasks,
        params,
        totalTasksCount,
      );

      container.replaceChildren(...Array.from(staging.childNodes));

      this.renderedLists.set(container, {
        paramsSignature,
        keys: this.taskKeys(tasks),
        tasks,
      });
    }

    restoreScroll();
  }

  /** Stable identity for a task row within an embedded list. */
  private taskKeys(tasks: Task[]): string[] {
    return tasks.map(
      (task) =>
        `${task.path}\u0000${task.line}\u0000${task.tableCell?.cellIndex ?? ''}`,
    );
  }

  /** True when the previously rendered keys match the new tasks in order. */
  private sameTaskOrder(previousKeys: string[], tasks: Task[]): boolean {
    const keys = this.taskKeys(tasks);
    if (previousKeys.length !== keys.length) return false;
    for (let i = 0; i < keys.length; i++) {
      if (previousKeys[i] !== keys[i]) return false;
    }
    return true;
  }

  private listParamsSignature(
    params: TodoseqParameters,
    totalTasksCount?: number,
  ): string {
    return `${JSON.stringify(params)}|${totalTasksCount ?? ''}`;
  }

  /**
   * Signature of the row content that {@link updateTaskRow} does NOT repaint —
   * everything except state/completed and the fields that legitimately change
   * alongside a state transition (urgency, CLOSED, STARTED). When any of these
   * differ between renders the in-place fast path must be skipped so the row is
   * rebuilt and the change is shown.
   */
  private staticRowSignature(task: Task): string {
    return [
      task.priority ?? '',
      task.description ?? '',
      task.scheduledDate ? task.scheduledDate.getTime() : '',
      task.deadlineDate ? task.deadlineDate.getTime() : '',
      task.subtaskCount,
      task.subtaskCompletedCount,
      task.repeatCount ?? '',
      task.text,
    ].join('\u0001');
  }

  private sameStaticRows(previous: Task[], next: Task[]): boolean {
    if (previous.length !== next.length) return false;
    for (let i = 0; i < next.length; i++) {
      if (
        this.staticRowSignature(previous[i]) !==
        this.staticRowSignature(next[i])
      ) {
        return false;
      }
    }
    return true;
  }

  /** Content signature used to decide whether a row actually changed. */
  private taskSignature(task: Task): string {
    return [
      task.state,
      task.completed ? '1' : '0',
      task.priority ?? '',
      task.rawText,
      task.description ?? '',
      task.scheduledDate ? task.scheduledDate.getTime() : '',
      task.deadlineDate ? task.deadlineDate.getTime() : '',
      task.closedDate ? task.closedDate.getTime() : '',
      task.startedDate ? task.startedDate.getTime() : '',
      task.subtaskCount,
      task.subtaskCompletedCount,
      task.repeatCount ?? '',
    ].join('\u0001');
  }

  private updateVisibleRows(
    previous: Task[],
    next: Task[],
    container: HTMLElement,
  ): void {
    const list = container.querySelector('.todoseq-embedded-task-list');
    if (!list) return;
    const rows = Array.from(list.children).filter((el): el is HTMLLIElement =>
      el.instanceOf(HTMLLIElement),
    );
    next.forEach((task, index) => {
      const row = rows[index];
      if (!row) return;
      if (this.taskSignature(previous[index]) === this.taskSignature(task)) {
        return;
      }
      this.itemRenderer.updateTaskRow(row, task);
    });
  }

  /**
   * Find the nearest ancestor that actually scrolls, so its scroll position
   * can be preserved across a re-render.
   */
  private getScrollParent(el: HTMLElement): HTMLElement | null {
    const view = el.ownerDocument?.defaultView;
    let node = el.parentElement;
    while (node) {
      const overflowY = view?.getComputedStyle(node).overflowY;
      if (
        (overflowY === 'auto' || overflowY === 'scroll') &&
        node.scrollHeight > node.clientHeight
      ) {
        return node;
      }
      node = node.parentElement;
    }
    return null;
  }

  /**
   * Update an existing collapsible list without full re-render
   * This prevents flicker by keeping the header in place
   */
  private updateCollapsibleList(
    container: HTMLElement,
    tasks: Task[],
    params: TodoseqParameters,
    isCollapsed: boolean,
    totalTasksCount?: number,
    hasTitle?: boolean,
    toggleCollapse?: (containerId: string) => void,
    containerId?: string,
  ): void {
    // Update collapse state class
    container.removeClass('todoseq-embedded-task-list-collapsed');
    container.removeClass('todoseq-embedded-task-list-expanded');
    container.addClass(
      isCollapsed
        ? 'todoseq-embedded-task-list-collapsed'
        : 'todoseq-embedded-task-list-expanded',
    );

    // Update chevron direction in header
    const chevronSpan = container.querySelector(
      '.todoseq-collapse-toggle-icon',
    );
    if (chevronSpan) {
      if (isCollapsed) {
        chevronSpan.removeClass('is-expanded');
      } else {
        chevronSpan.addClass('is-expanded');
      }
    }

    // Update aria-expanded on header/title
    const headerEl = container.querySelector('[role="button"][aria-expanded]');
    if (headerEl) {
      headerEl.setAttribute('aria-expanded', String(!isCollapsed));
    }

    // Remove old content elements (footer, task list(s), group headers,
    // truncated indicator, empty state)
    const oldFooter = container.querySelector('.todoseq-result-count-footer');
    const oldTaskLists = container.querySelectorAll(
      '.todoseq-embedded-task-list',
    );
    const oldGroupHeaders = container.querySelectorAll(
      '.todoseq-embedded-task-group-header',
    );
    const oldTruncated = container.querySelector(
      '.todoseq-embedded-task-list-truncated',
    );
    const oldEmpty = container.querySelector(
      '.todoseq-embedded-task-list-empty',
    );
    const oldHeader = container.querySelector(
      '.todoseq-embedded-task-list-header',
    );

    if (oldFooter) oldFooter.remove();
    oldTaskLists.forEach((el) => el.remove());
    oldGroupHeaders.forEach((el) => el.remove());
    if (oldTruncated) oldTruncated.remove();
    if (oldEmpty) oldEmpty.remove();
    // Remove old header when hasTitle is true (title case) to prevent duplicates
    if (hasTitle && oldHeader) oldHeader.remove();

    // Render new content based on state
    if (isCollapsed) {
      this.renderCollapsedFooter(container, tasks.length, totalTasksCount);
    } else {
      // Render expanded content
      if (hasTitle) {
        // For title case: include search settings header (no toggle params)
        // Pass renderHeader=true to show search options below the title
        this.renderExpandedContent(
          container,
          tasks,
          params,
          totalTasksCount,
          undefined,
          undefined,
          isCollapsed,
          true, // Render search options header when expanded with title
        );
      } else {
        // For no-title case: header already exists, just add task list to avoid flicker
        this.renderExpandedContent(
          container,
          tasks,
          params,
          totalTasksCount,
          toggleCollapse, // Pass toggle params to make header interactive
          containerId,
          isCollapsed,
          false, // Don't render header - it already exists
        );
      }
    }
  }

  /**
   * Render the title row as a collapsible toggle
   * Uses the existing todoseq-embedded-task-list-title element with chevron icon
   */
  private renderCollapsibleTitle(
    container: HTMLElement,
    params: TodoseqParameters,
    isCollapsed: boolean,
    taskCount: number,
    toggleCollapse?: (containerId: string) => void,
    containerId?: string,
  ): HTMLElement {
    const titleEl = container.createDiv({
      cls: 'todoseq-embedded-task-list-title',
      text: params.title,
      attr: {
        role: 'button',
        tabindex: '0',
        'aria-expanded': String(!isCollapsed),
        'aria-label': isCollapsed
          ? `Expand task list, ${taskCount} tasks`
          : 'Collapse task list',
      },
    });

    // Add click handler if toggle function is provided
    if (toggleCollapse && containerId) {
      titleEl.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleCollapse(containerId);
      });

      // Keyboard handler for accessibility
      titleEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggleCollapse(containerId);
        }
      });
    }

    // Create chevron icon container inside the title element
    const chevronSpan = titleEl.createSpan({
      cls: 'todoseq-collapse-toggle-icon',
    });
    setIcon(chevronSpan, 'chevron-right');
    if (!isCollapsed) {
      chevronSpan.addClass('is-expanded');
    }

    return titleEl;
  }

  /**
   * Format the sort summary value (without the "Sort: " label), including any
   * explicit direction and an optional secondary key. Returns null when neither
   * the primary nor secondary sort is set.
   */
  private sortSummaryValue(params: TodoseqParameters): string | null {
    const keys: string[] = [];
    if (params.sortMethod !== 'default') {
      keys.push(this.formatSortKey(params.sortMethod, params.sortDirection));
    }
    if (params.secondarySortMethod) {
      keys.push(
        this.formatSortKey(
          params.secondarySortMethod,
          params.secondarySortDirection,
        ),
      );
    }
    return keys.length > 0 ? keys.join(', ') : null;
  }

  private formatSortKey(
    field: string,
    direction: 'asc' | 'desc' | undefined,
  ): string {
    return direction ? `${field} ${direction}` : field;
  }

  /**
   * Format the group-by summary value (without the "Group: " label), including
   * an explicit direction, or null when no grouping is set.
   */
  private groupSummaryValue(params: TodoseqParameters): string | null {
    if (params.groupBy === undefined) return null;
    return params.groupByDirection
      ? `${params.groupBy} ${params.groupByDirection}`
      : params.groupBy;
  }

  /**
   * Build a ranker for `status` grouping from the effective keyword order:
   * active → inactive → waiting → completed, with unknown states last.
   */
  private getStateRank(): (state: string) => number {
    const keywordManager = this.plugin.keywordManager;
    const order = [
      ...keywordManager.getKeywordsForGroup('activeKeywords'),
      ...keywordManager.getKeywordsForGroup('inactiveKeywords'),
      ...keywordManager.getKeywordsForGroup('waitingKeywords'),
      ...keywordManager.getKeywordsForGroup('completedKeywords'),
    ];
    const ranks = new Map<string, number>();
    order.forEach((keyword, index) => {
      const key = keyword.toUpperCase();
      if (!ranks.has(key)) ranks.set(key, index);
    });
    return (state) => ranks.get(state.toUpperCase()) ?? Number.MAX_SAFE_INTEGER;
  }

  /**
   * Render a compact query summary for the collapsible header
   */
  private renderQuerySummary(
    header: HTMLElement,
    params: TodoseqParameters,
  ): void {
    const parts: string[] = [];
    if (params.searchQuery) {
      parts.push(params.searchQuery);
    }
    const sortValue = this.sortSummaryValue(params);
    if (sortValue) {
      parts.push(`sort: ${sortValue}`);
    }
    const groupValue = this.groupSummaryValue(params);
    if (groupValue) {
      parts.push(`group: ${groupValue}`);
    }

    if (parts.length > 0) {
      header.createSpan({
        cls: 'todoseq-query-summary',
        text: parts.join(' • '),
      });
    } else {
      // Default text when no query is specified
      header.createSpan({
        cls: 'todoseq-query-summary',
        text: 'All tasks',
      });
    }
  }

  /**
   * Render a collapsible header when no title is set
   * This header stays in place for both collapsed and expanded states,
   * preventing flicker on toggle by maintaining consistent DOM structure.
   */
  private renderCollapsibleHeaderNoTitle(
    container: HTMLElement,
    params: TodoseqParameters,
    isCollapsed: boolean,
    taskCount: number,
    toggleCollapse?: (containerId: string) => void,
    containerId?: string,
  ): HTMLElement {
    const header = container.createDiv({
      cls: 'todoseq-embedded-task-list-header',
      attr: {
        role: 'button',
        tabindex: '0',
        'aria-expanded': String(!isCollapsed),
        'aria-label': isCollapsed
          ? `Expand task list, ${taskCount} tasks`
          : 'Collapse task list',
      },
    });

    // Add click handler if toggle function is provided
    if (toggleCollapse && containerId) {
      header.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleCollapse(containerId);
      });

      // Keyboard handler for accessibility
      header.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggleCollapse(containerId);
        }
      });
    }

    // Show search query using the same format for both states
    if (params.showQuery !== false && params.searchQuery) {
      header.createSpan({
        cls: 'todoseq-embedded-task-list-search',
        text: `Search: ${params.searchQuery}`,
      });
    }

    // Show sort method if specified
    const sortValue = this.sortSummaryValue(params);
    if (sortValue) {
      header.createSpan({
        cls: 'todoseq-embedded-task-list-sort',
        text: `Sort: ${sortValue}`,
      });
    }

    // Show completed filter if specified
    if (params.completed !== undefined) {
      header.createSpan({
        cls: 'todoseq-embedded-task-list-completed',
        text: `Completed: ${params.completed}`,
      });
    }

    // Show future filter if specified
    if (params.future !== undefined) {
      header.createSpan({
        cls: 'todoseq-embedded-task-list-future',
        text: `Future: ${params.future}`,
      });
    }

    // Show limit if specified
    if (params.limit !== undefined) {
      header.createSpan({
        cls: 'todoseq-embedded-task-list-limit',
        text: `Limit: ${params.limit}`,
      });
    }

    // Show group-by if specified
    const groupValue = this.groupSummaryValue(params);
    if (groupValue) {
      header.createSpan({
        cls: 'todoseq-embedded-task-list-group',
        text: `Group: ${groupValue}`,
      });
    }

    // Create chevron icon container after the header content
    const chevronSpan = header.createSpan({
      cls: 'todoseq-collapse-toggle-icon',
    });
    setIcon(chevronSpan, 'chevron-right');
    // Add is-expanded class when expanded
    if (!isCollapsed) {
      chevronSpan.addClass('is-expanded');
    }

    return header;
  }

  /**
   * Render just the task list (without header) for expanded collapsible mode
   * The header is already rendered separately to maintain consistent DOM structure
   */
  private renderExpandedTaskList(
    container: HTMLElement,
    tasks: Task[],
    params: TodoseqParameters,
    totalTasksCount?: number,
  ): void {
    // Create task list
    const taskList = container.createEl('ul', {
      cls: 'todoseq-embedded-task-list',
    });

    // Render each task
    tasks.forEach((task, index) => {
      const taskItem = this.itemRenderer.createTaskListItem(
        task,
        index,
        params,
      );
      taskList.appendChild(taskItem);
    });

    // Add truncated indicator if results were limited
    if (
      params.limit &&
      totalTasksCount !== undefined &&
      totalTasksCount > params.limit
    ) {
      const truncatedIndicator = container.createDiv({
        cls: 'todoseq-embedded-task-list-truncated',
      });
      const moreTasksCount = totalTasksCount - params.limit;
      truncatedIndicator.textContent = `${moreTasksCount} more task${moreTasksCount > 1 ? 's' : ''} not shown`;
    }

    // Add empty state if no tasks
    if (tasks.length === 0) {
      this.renderEmptyState(container);
    }
  }

  /**
   * Render the collapsed footer showing result count
   */
  private renderCollapsedFooter(
    container: HTMLElement,
    taskCount: number,
    totalTasksCount?: number,
  ): void {
    const count = totalTasksCount ?? taskCount;
    const footer = container.createDiv({
      cls: 'todoseq-result-count-footer',
    });
    footer.textContent = `${count} matching task${count !== 1 ? 's' : ''}`;
  }

  /**
   * Check if the parameters contain any header content to display.
   * This includes search query, sort method, completed filter, future filter, or limit.
   */
  private hasHeaderContent(params: TodoseqParameters): boolean {
    const showQueryHeader = params.showQuery !== false;
    return (
      showQueryHeader &&
      !!(
        params.searchQuery ||
        this.sortSummaryValue(params) !== null ||
        params.completed !== undefined ||
        params.future !== undefined ||
        params.limit !== undefined ||
        params.groupBy !== undefined
      )
    );
  }

  /**
   * Render the header content spans (search, sort, completed, future, limit) into a header element.
   * This is shared between static and toggle headers.
   */
  private renderHeaderContentSpans(
    header: HTMLElement,
    params: TodoseqParameters,
  ): void {
    if (params.searchQuery) {
      header.createSpan({
        cls: 'todoseq-embedded-task-list-search',
        text: `Search: ${params.searchQuery}`,
      });
    }

    const sortValue = this.sortSummaryValue(params);
    if (sortValue) {
      header.createSpan({
        cls: 'todoseq-embedded-task-list-sort',
        text: `Sort: ${sortValue}`,
      });
    }

    if (params.completed !== undefined) {
      header.createSpan({
        cls: 'todoseq-embedded-task-list-completed',
        text: `Completed: ${params.completed}`,
      });
    }

    if (params.future !== undefined) {
      header.createSpan({
        cls: 'todoseq-embedded-task-list-future',
        text: `Future: ${params.future}`,
      });
    }

    if (params.limit !== undefined) {
      header.createSpan({
        cls: 'todoseq-embedded-task-list-limit',
        text: `Limit: ${params.limit}`,
      });
    }

    const groupValue = this.groupSummaryValue(params);
    if (groupValue) {
      header.createSpan({
        cls: 'todoseq-embedded-task-list-group',
        text: `Group: ${groupValue}`,
      });
    }
  }

  /**
   * Render a static (non-toggle) header with query information.
   * Used for standard content and expanded title mode.
   */
  private renderStaticHeader(
    container: HTMLElement,
    params: TodoseqParameters,
  ): void {
    const header = container.createDiv({
      cls: 'todoseq-embedded-task-list-header',
    });
    this.renderHeaderContentSpans(header, params);
  }

  /**
   * Render a toggle header that can collapse/expand the task list.
   * Used for collapsible lists without a title.
   */
  private renderToggleHeader(
    container: HTMLElement,
    params: TodoseqParameters,
    toggleCollapse: (containerId: string) => void,
    containerId: string,
    isCollapsed: boolean,
  ): void {
    const header = container.createDiv({
      cls: 'todoseq-embedded-task-list-header',
      attr: {
        role: 'button',
        tabindex: '0',
        'aria-expanded': String(!isCollapsed),
        'aria-label': 'Collapse task list',
      },
    });

    header.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleCollapse(containerId);
    });

    header.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleCollapse(containerId);
      }
    });

    this.renderHeaderContentSpans(header, params);

    // Add chevron icon for toggle functionality
    const chevronSpan = header.createSpan({
      cls: 'todoseq-collapse-toggle-icon',
    });
    setIcon(chevronSpan, 'chevron-right');
    // Expanded state - add is-expanded class
    chevronSpan.addClass('is-expanded');
  }

  /**
   * Render expanded content (standard task list content)
   * @param toggleCollapse When provided, adds toggle functionality to the header (for no-title collapsible lists)
   * @param containerId Container ID for toggle callback
   * @param isCollapsed Current collapse state (used for chevron direction)
   * @param renderHeader When true, renders the header; when false, assumes header already exists
   */
  private renderExpandedContent(
    container: HTMLElement,
    tasks: Task[],
    params: TodoseqParameters,
    totalTasksCount?: number,
    toggleCollapse?: (containerId: string) => void,
    containerId?: string,
    isCollapsed?: boolean,
    renderHeader?: boolean,
  ): void {
    // Render header only when explicitly requested and there's content or toggle capability
    // When renderHeader=false, existing header is preserved to prevent flicker
    if (renderHeader) {
      const hasContent = this.hasHeaderContent(params);
      const isToggleMode =
        toggleCollapse && containerId && isCollapsed !== undefined;

      if (isToggleMode) {
        // Toggle header: always render when in toggle mode (even without content)
        // This ensures the collapse/expand functionality is available
        this.renderToggleHeader(
          container,
          params,
          toggleCollapse,
          containerId,
          isCollapsed,
        );
      } else if (hasContent) {
        // Static header: only render when there's actual content to display
        this.renderStaticHeader(container, params);
      }
    }

    this.renderTaskItems(container, tasks, params);

    // Add truncated indicator if results were limited
    if (
      params.limit &&
      totalTasksCount !== undefined &&
      totalTasksCount > params.limit
    ) {
      const truncatedIndicator = container.createDiv({
        cls: 'todoseq-embedded-task-list-truncated',
      });
      const moreTasksCount = totalTasksCount - params.limit;
      truncatedIndicator.textContent = `${moreTasksCount} more task${moreTasksCount > 1 ? 's' : ''} not shown`;
    }

    // Add empty state if no tasks
    if (tasks.length === 0) {
      this.renderEmptyState(container);
    }
  }

  /**
   * Render the task rows. With `group-by` set, render a header (label + count)
   * followed by a sibling list per group in first-appearance order; otherwise
   * render a single flat list.
   */
  private renderTaskItems(
    container: HTMLElement,
    tasks: Task[],
    params: TodoseqParameters,
  ): void {
    if (params.groupBy) {
      const direction =
        params.groupByDirection ?? getNaturalGroupDirection(params.groupBy);
      const options =
        params.groupBy === 'status'
          ? { stateRank: this.getStateRank() }
          : undefined;
      for (const group of groupTasks(
        tasks,
        params.groupBy,
        direction,
        options,
      )) {
        const header = container.createDiv({
          cls: 'todoseq-embedded-task-group-header',
        });
        header.createSpan({
          cls: 'todoseq-embedded-task-group-label',
          text: group.label,
        });
        header.createSpan({
          cls: 'todoseq-embedded-task-group-count',
          text: String(group.tasks.length),
        });

        const groupList = container.createEl('ul', {
          cls: 'todoseq-embedded-task-list',
        });
        group.tasks.forEach((task, index) => {
          groupList.appendChild(
            this.itemRenderer.createTaskListItem(task, index, params),
          );
        });
      }
      return;
    }

    const taskList = container.createEl('ul', {
      cls: 'todoseq-embedded-task-list',
    });
    tasks.forEach((task, index) => {
      taskList.appendChild(
        this.itemRenderer.createTaskListItem(task, index, params),
      );
    });
  }

  /**
   * Render standard non-collapsible content
   */
  private renderStandardContent(
    container: HTMLElement,
    tasks: Task[],
    params: TodoseqParameters,
    totalTasksCount?: number,
  ): void {
    // Add title if provided
    if (params.title) {
      container.createDiv({
        cls: 'todoseq-embedded-task-list-title',
        text: params.title,
      });
    }

    // Add header with search/sort info using shared helper
    const hasContent = this.hasHeaderContent(params);
    if (hasContent) {
      this.renderStaticHeader(container, params);
    }

    // Add bottom border to title if there's no header and no task list border will be added
    if (params.title && !hasContent) {
      const titleEl = container.querySelector(
        '.todoseq-embedded-task-list-title',
      );
      if (titleEl) {
        titleEl.addClass('todoseq-embedded-task-list-title-bordered');
      }
    }

    this.renderTaskItems(container, tasks, params);

    // Add truncated indicator if results were limited
    if (
      params.limit &&
      totalTasksCount !== undefined &&
      totalTasksCount > params.limit
    ) {
      const truncatedIndicator = container.createDiv({
        cls: 'todoseq-embedded-task-list-truncated',
      });
      const moreTasksCount = totalTasksCount - params.limit;
      truncatedIndicator.textContent = `${moreTasksCount} more task${moreTasksCount > 1 ? 's' : ''} not shown`;
    }

    // Add empty state if no tasks
    if (tasks.length === 0) {
      this.renderEmptyState(container);
    }
  }

  /**
   * Render empty state message
   */
  private renderEmptyState(container: HTMLElement): void {
    const emptyState = container.createDiv({
      cls: 'todoseq-embedded-task-list-empty',
    });

    // Check if we should show scanning message
    // This includes both plugin scanning and Obsidian's internal index building
    const isScanning =
      this.plugin.vaultScanner?.shouldShowScanningMessage() ?? false;

    // Check if the initial scan has completed at least once
    const hasCompletedInitialScan =
      this.plugin.vaultScanner?.hasCompletedInitialScan() ?? false;

    // Check if we're in initial load state (before first scan has started)
    // This prevents "No tasks found" from flashing before the scan begins
    const allTasks = this.plugin.vaultScanner?.getTasks() ?? [];
    const isInitialLoad =
      !isScanning && !hasCompletedInitialScan && allTasks.length === 0;

    if (isScanning || isInitialLoad) {
      emptyState.createDiv({
        cls: 'todoseq-embedded-task-list-empty-title',
        text: isScanning ? 'Scanning vault...' : 'Loading tasks...',
      });
      emptyState.createDiv({
        cls: 'todoseq-embedded-task-list-empty-subtitle',
        text: isScanning
          ? 'Please wait while your tasks are being indexed'
          : 'Please wait while your vault is being indexed',
      });
    } else {
      emptyState.createDiv({
        cls: 'todoseq-embedded-task-list-empty-title',
        text: 'No tasks found',
      });
      emptyState.createDiv({
        cls: 'todoseq-embedded-task-list-empty-subtitle',
        text: 'Try adjusting your search or sort parameters',
      });
    }
  }

  /**
   * Render an error message in the container
   * @param container The container element
   * @param errorMessage The error message to display
   */
  renderError(container: HTMLElement, errorMessage: string): void {
    container.empty();

    const errorContainer = container.createDiv({
      cls: 'todoseq-embedded-task-list-error',
    });

    errorContainer.createDiv({
      cls: 'todoseq-embedded-task-list-error-title',
      text: 'Error rendering task list',
    });

    errorContainer.createDiv({
      cls: 'todoseq-embedded-task-list-error-message',
      text: errorMessage,
    });

    errorContainer.createDiv({
      cls: 'todoseq-embedded-task-list-error-help',
      text: 'Check your search and sort parameters for syntax errors.',
    });
  }

  /**
   * Update settings - no longer need to refresh menu builder since it now directly accesses the plugin's keyword manager
   */
  public updateSettings(): void {
    // Menu builder now directly accesses the plugin's keyword manager, so no need to recreate it
    // Update context menu configuration
    if (this.taskContextMenu) {
      this.taskContextMenu.updateConfig({
        weekStartsOn: this.plugin.settings.weekStartsOn,
        migrateToTodayState: this.plugin.settings.migrateToTodayState,
      });
    }
  }
}
