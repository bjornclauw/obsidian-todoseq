/**
 * @jest-environment jsdom
 */

import {
  TaskListView,
  TaskListViewMode,
  SortMethod,
} from '../src/view/task-list/task-list-view';
import { installObsidianDomMocks } from './helpers/obsidian-dom-mock';
import { createBaseTask, createBaseSettings } from './helpers/test-helper';
import { Task } from '../src/types/task';
import { createSavedSearch } from '../src/services/saved-search-manager';

// Mock obsidian
jest.mock('obsidian', () => ({
  ItemView: class MockItemView {
    contentEl: HTMLElement;
    app = { workspace: {}, vault: {} };
    register = jest.fn();
    registerDomEvent = jest.fn(
      (
        el: EventTarget,
        type: string,
        callback: EventListenerOrEventListenerObject,
        options?: AddEventListenerOptions,
      ) => {
        el.addEventListener(type, callback, options);
      },
    );
    constructor() {
      this.contentEl = activeDocument.createElement('div');
      // Add Obsidian's getAttr/setAttr methods
      (this.contentEl as any).getAttr = function (name: string) {
        return this.getAttribute(name);
      };
      (this.contentEl as any).setAttr = function (
        name: string,
        value: string | boolean | number,
      ) {
        if (value === true) {
          this.setAttribute(name, '');
        } else if (value === false || value === null || value === undefined) {
          this.removeAttribute(name);
        } else {
          this.setAttribute(name, String(value));
        }
      };
    }
  },
  WorkspaceLeaf: jest.fn(),
  TFile: jest.fn(),
  Platform: { isMobile: false, isMacOS: false },
  MarkdownView: jest.fn(),
  setIcon: jest.fn(),
  setTooltip: jest.fn(),
  Notice: jest.fn(),
  ConfirmationModal: jest.fn().mockImplementation(() => {
    const instance: any = {
      setTitle: jest.fn().mockReturnThis(),
      setContent: jest.fn().mockReturnThis(),
      addButton: jest.fn(function (this: any, cb: (btn: any) => void) {
        const btn: any = {
          setButtonText: jest.fn().mockReturnThis(),
          setDestructive: jest.fn().mockReturnThis(),
          onClick: jest.fn(function (this: any, handler: () => void) {
            this._clickHandler = handler;
            return this;
          }),
        };
        cb(btn);
        this._lastButton = btn;
        return this;
      }),
      addCancelButton: jest.fn().mockReturnThis(),
      open: jest.fn(),
    };
    return instance;
  }),
}));

// Mock dependencies
jest.mock('../src/view/components/state-menu-builder', () => ({
  StateMenuBuilder: jest.fn().mockImplementation(() => ({
    buildStateMenu: jest.fn().mockReturnValue({ showAtPosition: jest.fn() }),
  })),
}));

jest.mock('../src/view/components/task-context-menu', () => ({
  TaskContextMenu: jest.fn().mockImplementation(() => ({
    showAtMouseEvent: jest.fn(),
    cleanup: jest.fn(),
    updateConfig: jest.fn(),
  })),
}));

jest.mock('../src/view/task-list/task-item-renderer', () => ({
  TaskItemRenderer: jest.fn().mockImplementation(() => ({
    buildText: jest.fn().mockReturnValue(activeDocument.createElement('span')),
    buildTaskListItem: jest.fn().mockImplementation((task: Task) => {
      const li = activeDocument.createElement('li');
      li.setAttribute('data-path', task.path);
      li.setAttribute('data-line', String(task.line));
      li.classList.add('todoseq-task-item');
      return li;
    }),
    updateTaskElementContent: jest.fn(),
    renderTaskTextWithLinks: jest.fn(),
  })),
}));

jest.mock('../src/view/task-list/task-drag-drop', () => ({
  TaskDragDropHandler: jest.fn().mockImplementation(() => ({
    initialize: jest.fn(),
    destroy: jest.fn(),
  })),
}));

jest.mock('../src/view/task-list/task-list-filter', () => ({
  TaskListFilter: jest.fn().mockImplementation(() => ({
    transformForView: jest
      .fn()
      .mockImplementation((tasks: Task[]) => tasks.slice()),
    filterTasksByViewMode: jest
      .fn()
      .mockImplementation((tasks: Task[]) => tasks.slice()),
  })),
}));

jest.mock('../src/services/task-update-coordinator', () => ({
  getStateTransitionManager: jest.fn().mockReturnValue({
    getNextState: jest.fn().mockReturnValue('DOING'),
    isCompletedState: jest.fn().mockReturnValue(false),
  }),
}));

jest.mock('../src/utils/daily-note-utils', () => ({
  getTodayDailyNote: jest.fn().mockResolvedValue(null),
  isTaskOnTodayDailyNote: jest.fn().mockReturnValue(false),
}));

jest.mock('../src/utils/task-sub-bullets', () => ({
  getTaskRemovalRange: jest.fn().mockReturnValue({ start: 0, end: 0 }),
  modifyLinesForMigration: jest.fn().mockReturnValue([]),
  readTaskBlockFromVault: jest.fn().mockResolvedValue(['TODO Test task']),
}));

jest.mock('../src/search/search', () => ({
  Search: {
    evaluate: jest.fn().mockResolvedValue(true),
    getError: jest.fn().mockReturnValue(null),
  },
}));

jest.mock('../src/main', () => ({
  TASK_VIEW_ICON: 'list-todo',
  default: class MockTodoTracker {
    settings = createBaseSettings();
    app = { workspace: {}, vault: {} };
    taskUpdateCoordinator = {};
    keywordManager = {};
    taskStateManager = { getTasks: jest.fn().mockReturnValue([]) };
  },
}));

beforeAll(() => {
  installObsidianDomMocks();
});

describe('TaskListView', () => {
  let view: TaskListView;
  let taskStateManagerMock: Record<string, unknown>;
  let pluginMock: Record<string, unknown>;

  beforeEach(() => {
    const tasks = [
      createBaseTask({
        path: 'test1.md',
        line: 0,
        text: 'Task 1',
        state: 'TODO',
        completed: false,
      }),
      createBaseTask({
        path: 'test2.md',
        line: 1,
        text: 'Task 2',
        state: 'DONE',
        completed: true,
      }),
    ];

    taskStateManagerMock = {
      getTasks: jest.fn().mockReturnValue(tasks),
      subscribe: jest.fn().mockReturnValue(jest.fn()),
      findTaskByPathAndLine: jest.fn().mockReturnValue(tasks[0]),
      getKeywordManager: jest.fn().mockReturnValue({}),
    };

    pluginMock = {
      settings: createBaseSettings(),
      saveSettings: jest.fn().mockResolvedValue(undefined),
      app: {
        workspace: {
          getLeavesOfType: jest.fn().mockReturnValue([]),
        },
        vault: {
          getAbstractFileByPath: jest.fn().mockReturnValue(null),
        },
      },
      taskUpdateCoordinator: {
        updateTaskState: jest.fn().mockResolvedValue(undefined),
        updateTaskPriority: jest.fn().mockResolvedValue(undefined),
        updateTaskScheduledDate: jest.fn().mockResolvedValue(undefined),
        updateTaskDeadlineDate: jest.fn().mockResolvedValue(undefined),
      },
      keywordManager: {},
      taskStateManager: taskStateManagerMock,
      propertySearchEngine: null,
    };

    const leafMock = {};

    view = new TaskListView(
      leafMock as any,
      taskStateManagerMock as any,
      'showAll' as TaskListViewMode,
      pluginMock as any,
      {} as any,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getViewType', () => {
    it('should return the correct view type', () => {
      expect(view.getViewType()).toBe('todoseq-view');
    });
  });

  describe('getDisplayText', () => {
    it('should return Todoseq as display text', () => {
      expect(view.getDisplayText()).toBe('TODOseq');
    });
  });

  describe('getIcon', () => {
    it('should return the task view icon', () => {
      expect(view.getIcon()).toBe('list-todo');
    });
  });

  describe('updateTasks', () => {
    it('should update tasks reference', () => {
      const newTasks = [createBaseTask({ text: 'New task' })];
      view.updateTasks(newTasks);
      expect(view.tasks).toBe(newTasks);
    });
  });

  describe('view mode accessors', () => {
    it('should set and get view mode', () => {
      // Ensure contentEl exists
      if (!view['contentEl']) {
        view['contentEl'] = activeDocument.createElement('div');
      }
      view.setViewMode('hideCompleted');
      expect(view['getViewMode']()).toBe('hideCompleted');
    });

    it('should migrate old mode names', () => {
      if (!view['contentEl']) {
        view['contentEl'] = activeDocument.createElement('div');
      }
      view['contentEl'].setAttribute('data-view-mode', 'default');
      expect(view['getViewMode']()).toBe('showAll');
    });

    it('should default to showAll for invalid mode', () => {
      if (!view['contentEl']) {
        view['contentEl'] = activeDocument.createElement('div');
      }
      view['contentEl'].setAttribute('data-view-mode', 'invalid');
      expect(view['getViewMode']()).toBe('showAll');
    });
  });

  describe('sort method accessors', () => {
    it('should set and get sort method', () => {
      if (!view['contentEl']) {
        view['contentEl'] = activeDocument.createElement('div');
      }
      view.setSortMethod('sortByPriority');
      expect(view['getSortMethod']()).toBe('sortByPriority');
    });

    it('should fallback to default sort method', () => {
      if (!view['contentEl']) {
        view['contentEl'] = activeDocument.createElement('div');
      }
      view['defaultSortMethod'] = 'sortByDeadline' as SortMethod;
      expect(view['getSortMethod']()).toBe('sortByDeadline');
    });
  });

  describe('sort direction accessors', () => {
    it('should set and get an explicit sort direction', () => {
      if (!view['contentEl']) {
        view['contentEl'] = activeDocument.createElement('div');
      }
      view['setSortDirection']('asc');
      expect(view['getSortDirection']()).toBe('asc');
    });

    it('should fall back to the setting, then natural', () => {
      if (!view['contentEl']) {
        view['contentEl'] = activeDocument.createElement('div');
      }
      (pluginMock.settings as any).taskListSortDirection = 'desc';
      expect(view['getSortDirection']()).toBe('desc');
      (pluginMock.settings as any).taskListSortDirection = 'natural';
      expect(view['getSortDirection']()).toBe('natural');
    });

    it('should resolve the effective direction for the current method', () => {
      if (!view['contentEl']) {
        view['contentEl'] = activeDocument.createElement('div');
      }
      view.setSortMethod('sortByPriority');
      expect(view['getEffectiveSortDirection']()).toBe('desc');
      view['setSortDirection']('asc');
      expect(view['getEffectiveSortDirection']()).toBe('asc');
    });
  });

  describe('group-by accessors', () => {
    it('should set and get the grouping field', () => {
      if (!view['contentEl']) {
        view['contentEl'] = activeDocument.createElement('div');
      }
      view['setGroupBy']('folder');
      expect(view['getGroupBy']()).toBe('folder');
    });

    it('should fall back to the setting, then none', () => {
      if (!view['contentEl']) {
        view['contentEl'] = activeDocument.createElement('div');
      }
      view['contentEl'].setAttribute('data-group-by', 'bogus');
      (pluginMock.settings as any).taskListGroupBy = 'priority';
      expect(view['getGroupBy']()).toBe('priority');
      (pluginMock.settings as any).taskListGroupBy = 'none';
      expect(view['getGroupBy']()).toBe('none');
    });

    it('should set and get an explicit group direction', () => {
      if (!view['contentEl']) {
        view['contentEl'] = activeDocument.createElement('div');
      }
      view['setGroupDirection']('desc');
      expect(view['getGroupDirection']()).toBe('desc');
    });

    it('should resolve the effective group direction for the field', () => {
      if (!view['contentEl']) {
        view['contentEl'] = activeDocument.createElement('div');
      }
      view['setGroupBy']('priority');
      expect(view['getEffectiveGroupDirection']()).toBe('desc');
      view['setGroupDirection']('asc');
      expect(view['getEffectiveGroupDirection']()).toBe('asc');
    });
  });

  describe('buildRenderItems', () => {
    it('should return task items only when grouping is off', () => {
      const tasks = [
        createBaseTask({ path: 'a.md', line: 0, text: 'A' }),
        createBaseTask({ path: 'a.md', line: 1, text: 'B' }),
      ];
      view['setGroupBy']('none');
      const items = view['buildRenderItems'](tasks);
      expect(items).toHaveLength(2);
      expect(items.every((item: any) => item.kind === 'task')).toBe(true);
    });

    it('should emit a header followed by its tasks for folder grouping', () => {
      const tasks = [
        createBaseTask({ path: 'a/one.md', line: 0, text: 'A' }),
        createBaseTask({ path: 'b/two.md', line: 0, text: 'B' }),
      ];
      view['setGroupBy']('folder');
      const items = view['buildRenderItems'](tasks);
      expect(items.map((item: any) => item.kind)).toEqual([
        'header',
        'task',
        'header',
        'task',
      ]);
      expect((items[0] as any).group.label).toBe('a/');
      expect((items[2] as any).group.label).toBe('b/');
    });

    it('should honour an explicit group direction', () => {
      const tasks = [
        createBaseTask({ path: 'a/one.md', line: 0, text: 'A' }),
        createBaseTask({ path: 'b/two.md', line: 0, text: 'B' }),
      ];
      view['setGroupBy']('folder');
      view['setGroupDirection']('desc');
      const items = view['buildRenderItems'](tasks);
      expect((items[0] as any).group.label).toBe('b/');
    });

    it('should duplicate a multi-tag task with distinct item keys', () => {
      const tasks = [
        createBaseTask({
          path: 'a.md',
          line: 0,
          text: 'multi',
          tags: ['work', 'urgent'],
        }),
      ];
      view['setGroupBy']('tag');
      const items = view['buildRenderItems'](tasks);
      const taskItems = items.filter((item: any) => item.kind === 'task');
      expect(taskItems).toHaveLength(2);
      expect((taskItems[0] as any).itemKey).not.toBe(
        (taskItems[1] as any).itemKey,
      );
    });

    it('should tag task items with their group key', () => {
      const tasks = [
        createBaseTask({ path: 'a/one.md', line: 0, text: 'A' }),
        createBaseTask({ path: 'a/two.md', line: 1, text: 'B' }),
      ];
      view['setGroupBy']('folder');
      const items = view['buildRenderItems'](tasks);
      expect((items[0] as any).kind).toBe('header');
      expect((items[0] as any).group.key).toBe('a');
      const taskItems = items.filter((item: any) => item.kind === 'task');
      expect(taskItems).toHaveLength(2);
      expect(taskItems.every((item: any) => item.groupKey === 'a')).toBe(true);
    });
  });

  describe('snapGroupedSliceEnd', () => {
    const buildPlan = () => {
      const tasks = [
        createBaseTask({ path: 'a/one.md', line: 0, text: 'A' }),
        createBaseTask({ path: 'b/two.md', line: 0, text: 'B' }),
      ];
      view['setGroupBy']('folder');
      return view['buildRenderItems'](tasks);
    };

    it('should keep a cut that lands on a task', () => {
      const items = buildPlan();
      expect(view['snapGroupedSliceEnd'](items, 0, 2)).toBe(2);
    });

    it('should drop a trailing header instead of loading its whole group', () => {
      const items = buildPlan();
      // [0,3) would end on the second header; drop it.
      expect(view['snapGroupedSliceEnd'](items, 0, 3)).toBe(2);
    });

    it('should keep the header with its first task for a one-item slice', () => {
      const items = buildPlan();
      // A slice of just the first header must include its first task.
      expect(view['snapGroupedSliceEnd'](items, 0, 1)).toBe(2);
    });

    it('should clamp to the item count and allow zero', () => {
      const items = buildPlan();
      expect(view['snapGroupedSliceEnd'](items, 0, 0)).toBe(0);
      expect(view['snapGroupedSliceEnd'](items, 0, 99)).toBe(items.length);
    });

    it('should never leave a batch ending on a header', () => {
      const items = buildPlan();
      for (let start = 0; start <= items.length; start++) {
        for (let end = start; end <= items.length; end++) {
          const snapped = view['snapGroupedSliceEnd'](items, start, end);
          if (snapped > start && snapped < items.length) {
            expect((items[snapped - 1] as any).kind).not.toBe('header');
          }
        }
      }
    });
  });

  describe('buildGroupHeaderItem', () => {
    it('should render a header li with label and count', () => {
      const group = {
        key: 'a/',
        label: 'a/',
        tasks: [createBaseTask(), createBaseTask()],
      };
      const li = view['buildGroupHeaderItem'](group);
      expect(li.classList.contains('todoseq-task-group-header')).toBe(true);
      expect(
        li.querySelector('.todoseq-embedded-task-group-label')?.textContent,
      ).toBe('a/');
      expect(
        li.querySelector('.todoseq-embedded-task-group-count')?.textContent,
      ).toBe('2');
    });
  });

  describe('collapsible group headers', () => {
    it('should render the header as an expanded toggle by default', () => {
      const group = {
        key: 'a/',
        label: 'a/',
        tasks: [createBaseTask()],
      };
      const li = view['buildGroupHeaderItem'](group);
      expect(li.getAttribute('role')).toBe('button');
      expect(li.getAttribute('tabindex')).toBe('0');
      expect(li.getAttribute('aria-expanded')).toBe('true');
      expect(li.classList.contains('is-collapsed')).toBe(false);
      const chevron = li.querySelector('.todoseq-collapse-toggle-icon');
      expect(chevron?.classList.contains('is-expanded')).toBe(true);
    });

    it('should render a collapsed header with the chevron rotated back', () => {
      const group = {
        key: 'a/',
        label: 'a/',
        tasks: [createBaseTask()],
      };
      const li = view['buildGroupHeaderItem'](group, true);
      expect(li.getAttribute('aria-expanded')).toBe('false');
      expect(li.classList.contains('is-collapsed')).toBe(true);
      const chevron = li.querySelector('.todoseq-collapse-toggle-icon');
      expect(chevron?.classList.contains('is-expanded')).toBe(false);
    });

    it('should remove collapsed rows and restore them on expand', () => {
      view['setGroupBy']('folder');
      const container = activeDocument.createElement('div');
      const list = activeDocument.createElement('ul');
      list.classList.add('todoseq-task-list');
      container.appendChild(list);
      view['taskListContainer'] = container;

      const tasks = [
        createBaseTask({ path: 'a/one.md', line: 0, text: 'A' }),
        createBaseTask({ path: 'b/two.md', line: 0, text: 'B' }),
      ];
      const items = view['buildRenderItems'](tasks);
      view['cachedRenderItems'] = items;
      view['loadedTaskCount'] = items.length;
      for (const item of items) {
        list.appendChild(view['buildRenderItemElement'](item));
      }

      const headerA = list.querySelector(
        'li.todoseq-task-group-header',
      ) as HTMLElement;
      expect(list.querySelectorAll('li.todoseq-task-item').length).toBe(2);

      view['toggleGroupCollapsed'](headerA);
      expect(view['isGroupCollapsed']('a')).toBe(true);
      expect(headerA.getAttribute('aria-expanded')).toBe('false');
      expect(headerA.classList.contains('is-collapsed')).toBe(true);
      expect(list.querySelectorAll('li.todoseq-task-item').length).toBe(1);

      view['toggleGroupCollapsed'](headerA);
      expect(view['isGroupCollapsed']('a')).toBe(false);
      expect(headerA.getAttribute('aria-expanded')).toBe('true');
      expect(list.querySelectorAll('li.todoseq-task-item').length).toBe(2);
    });

    it('should apply the live collapsed state to lazily built rows', () => {
      view['setGroupBy']('folder');
      view['setGroupCollapsed']('a', true);

      const header = view['buildRenderItemElement']({
        kind: 'header',
        group: { key: 'a', label: 'a/', tasks: [createBaseTask()] },
      });
      expect(header.classList.contains('is-collapsed')).toBe(true);
      expect(header.getAttribute('aria-expanded')).toBe('false');

      const task = view['buildRenderItemElement']({
        kind: 'task',
        task: createBaseTask({ path: 'a/one.md', line: 0, text: 'A' }),
        itemKey: 'a\u00000',
        groupKey: 'a',
      });
      expect(task.classList.contains('todoseq-task-item-collapsed')).toBe(true);
    });

    it('should build rows visible again once the group is expanded', () => {
      view['setGroupBy']('folder');
      view['setGroupCollapsed']('a', true);
      view['setGroupCollapsed']('a', false);

      const task = view['buildRenderItemElement']({
        kind: 'task',
        task: createBaseTask({ path: 'a/one.md', line: 0, text: 'A' }),
        itemKey: 'a\u00000',
        groupKey: 'a',
      });
      expect(task.classList.contains('todoseq-task-item-collapsed')).toBe(
        false,
      );
    });

    it('should ask the lazy loader to fill after a collapse toggle', () => {
      view['setGroupBy']('folder');
      const container = activeDocument.createElement('div');
      const list = activeDocument.createElement('ul');
      list.classList.add('todoseq-task-list');
      container.appendChild(list);
      view['taskListContainer'] = container;

      const header = view['buildGroupHeaderItem']({
        key: 'a',
        label: 'a/',
        tasks: [createBaseTask()],
      });
      list.appendChild(header);

      const maybeLoadMore = jest.fn();
      view['maybeLoadMore'] = maybeLoadMore;
      view['toggleGroupCollapsed'](header);
      expect(maybeLoadMore).toHaveBeenCalledTimes(1);
    });
  });

  describe('search query', () => {
    it('should set and get search query', () => {
      if (!view['contentEl']) {
        view['contentEl'] = activeDocument.createElement('div');
      }
      view['setSearchQuery']('test query');
      expect(view['getSearchQuery']()).toBe('test query');
    });

    it('should default to empty string', () => {
      if (!view['contentEl']) {
        view['contentEl'] = activeDocument.createElement('div');
      }
      expect(view['getSearchQuery']()).toBe('');
    });
  });

  describe('search options dropdown', () => {
    it('shows the options dropdown when the search field is focused', async () => {
      const input = document.createElement('input');
      input.type = 'search';
      document.body.appendChild(input);
      view['searchInputEl'] = input;

      view['setupSearchSuggestions']();
      input.focus();
      await new Promise((resolve) => window.setTimeout(resolve, 0));

      expect(document.querySelector('.todoseq-dropdown.show')).not.toBeNull();
      input.remove();
    });

    it('shows the options dropdown when the search field is clicked', async () => {
      const input = document.createElement('input');
      input.type = 'search';
      document.body.appendChild(input);
      view['searchInputEl'] = input;

      view['setupSearchSuggestions']();
      input.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      await new Promise((resolve) => window.setTimeout(resolve, 0));

      expect(document.querySelector('.todoseq-dropdown.show')).not.toBeNull();
      input.remove();
    });

    it('wires the search input listeners only once across repeated setup', () => {
      const input = document.createElement('input');
      input.className = 'todoseq-search-input';
      document.body.appendChild(input);
      view['searchInputEl'] = input;

      view['setupSearchSuggestions']();
      view['setupSearchSuggestions']();

      // 4 input listeners.
      expect(
        view['registerDomEvent'] as unknown as jest.Mock,
      ).toHaveBeenCalledTimes(4);
      input.remove();
    });

    it('reinitializes search wiring on a view reused across a plugin reload', async () => {
      const input = document.createElement('input');
      input.className = 'todoseq-search-input';
      view['contentEl'].appendChild(input);

      // State left behind when a view survives a disable/enable without onOpen
      // running: cached refs are null but the panel DOM is intact.
      view['searchInputEl'] = null;
      view['wiredInputEl'] = null;
      view['optionsDropdown'] = null;
      view['suggestionDropdown'] = null;

      view.reinitializeSearchWiringIfStale();

      expect(view['searchInputEl']).toBe(input);
      expect(
        view['registerDomEvent'] as unknown as jest.Mock,
      ).toHaveBeenCalledTimes(4);

      input.focus();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      expect(document.querySelector('.todoseq-dropdown.show')).not.toBeNull();
    });
  });

  describe('filterTasksByViewMode', () => {
    it('should hide completed tasks', () => {
      const tasks = [
        createBaseTask({ completed: false }),
        createBaseTask({ completed: true }),
      ];
      const result = view['filterTasksByViewMode'](tasks, 'hideCompleted');
      expect(result).toHaveLength(1);
      expect(result[0].completed).toBe(false);
    });

    it('should return all tasks for showAll', () => {
      const tasks = [
        createBaseTask({ completed: false }),
        createBaseTask({ completed: true }),
      ];
      const result = view['filterTasksByViewMode'](tasks, 'showAll');
      expect(result).toHaveLength(2);
    });
  });

  describe('announceTaskStateChange', () => {
    it('should update aria live region', () => {
      const region = activeDocument.createElement('div');
      view['ariaLiveRegion'] = region;

      const task = createBaseTask({ text: 'Test task', state: 'DOING' });
      view['announceTaskStateChange'](task, 'TODO');

      expect(region.textContent).toContain('Test task');
      expect(region.textContent).toContain('TODO');
      expect(region.textContent).toContain('DOING');
    });

    it('should not throw when aria live region is null', () => {
      view['ariaLiveRegion'] = null;
      const task = createBaseTask({ text: 'Test task', state: 'DOING' });
      expect(() => view['announceTaskStateChange'](task, 'TODO')).not.toThrow();
    });
  });

  describe('handleSearchHistoryDebounce', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should start debounce timer when both dropdowns closed', () => {
      const captureSpy = jest
        .spyOn(view as any, 'captureSearchToHistory')
        .mockImplementation(() => {});
      const setTimeoutSpy = jest.spyOn(window, 'setTimeout');

      view['searchHistoryDebounceTimer'] = null;
      view['suggestionDropdown'] = null;
      view['optionsDropdown'] = null;

      view['handleSearchHistoryDebounce']('test query');

      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 3000);

      jest.advanceTimersByTime(3000);

      expect(captureSpy).toHaveBeenCalledWith('test query');

      setTimeoutSpy.mockRestore();
      captureSpy.mockRestore();
    });

    it('should not start timer when suggestion dropdown is visible', () => {
      const setTimeoutSpy = jest.spyOn(window, 'setTimeout');
      view['suggestionDropdown'] = {
        isVisible: jest.fn().mockReturnValue(true),
      } as any;
      view['optionsDropdown'] = {
        isVisible: jest.fn().mockReturnValue(false),
      } as any;
      view['searchHistoryDebounceTimer'] = null;

      view['handleSearchHistoryDebounce']('test query');

      expect(setTimeoutSpy).not.toHaveBeenCalled();
      setTimeoutSpy.mockRestore();
    });

    it('should not start timer when options dropdown is visible', () => {
      const setTimeoutSpy = jest.spyOn(window, 'setTimeout');
      view['suggestionDropdown'] = {
        isVisible: jest.fn().mockReturnValue(false),
      } as any;
      view['optionsDropdown'] = {
        isVisible: jest.fn().mockReturnValue(true),
      } as any;
      view['searchHistoryDebounceTimer'] = null;

      view['handleSearchHistoryDebounce']('test query');

      expect(setTimeoutSpy).not.toHaveBeenCalled();
      setTimeoutSpy.mockRestore();
    });

    it('should clear existing timer before starting new one', () => {
      const clearTimeoutSpy = jest.spyOn(window, 'clearTimeout');
      view['searchHistoryDebounceTimer'] = 123 as unknown as number;
      view['suggestionDropdown'] = null;
      view['optionsDropdown'] = null;

      view['handleSearchHistoryDebounce']('new query');

      expect(clearTimeoutSpy).toHaveBeenCalledWith(123);
      clearTimeoutSpy.mockRestore();
    });

    it('should still set timer for whitespace-only query', () => {
      const setTimeoutSpy = jest.spyOn(window, 'setTimeout');

      view['searchHistoryDebounceTimer'] = null;
      view['suggestionDropdown'] = null;
      view['optionsDropdown'] = null;

      view['handleSearchHistoryDebounce']('  ');

      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 3000);

      setTimeoutSpy.mockRestore();
    });

    it('should capture only the last query when called rapidly', () => {
      const captureSpy = jest
        .spyOn(view as any, 'captureSearchToHistory')
        .mockImplementation(() => {});

      view['searchHistoryDebounceTimer'] = null;
      view['suggestionDropdown'] = null;
      view['optionsDropdown'] = null;

      view['handleSearchHistoryDebounce']('first query');
      view['handleSearchHistoryDebounce']('second query');
      view['handleSearchHistoryDebounce']('final query');

      expect(captureSpy).not.toHaveBeenCalled();

      jest.advanceTimersByTime(3000);

      expect(captureSpy).toHaveBeenCalledTimes(1);
      expect(captureSpy).toHaveBeenCalledWith('final query');

      captureSpy.mockRestore();
    });
  });

  describe('handleDropdownVisibilityChange', () => {
    it('should clear debounce timer when any dropdown visible', () => {
      const clearTimeoutSpy = jest.spyOn(window, 'clearTimeout');
      view['searchHistoryDebounceTimer'] = 456 as unknown as number;
      view['suggestionDropdown'] = {
        isVisible: jest.fn().mockReturnValue(true),
      } as any;
      view['optionsDropdown'] = {
        isVisible: jest.fn().mockReturnValue(false),
      } as any;

      view['handleDropdownVisibilityChange'](true);

      expect(clearTimeoutSpy).toHaveBeenCalledWith(456);
      expect(view['searchHistoryDebounceTimer']).toBeNull();
      clearTimeoutSpy.mockRestore();
    });

    it('should restart debounce timer when both dropdowns close', () => {
      jest.useFakeTimers();
      const handleDebounceSpy = jest
        .spyOn(view as any, 'handleSearchHistoryDebounce')
        .mockImplementation(() => {});

      view['searchHistoryDebounceTimer'] = null;
      view['suggestionDropdown'] = {
        isVisible: jest.fn().mockReturnValue(false),
      } as any;
      view['optionsDropdown'] = {
        isVisible: jest.fn().mockReturnValue(false),
      } as any;
      view['getSearchQuery'] = jest.fn().mockReturnValue('active query');

      view['handleDropdownVisibilityChange'](false);

      expect(handleDebounceSpy).toHaveBeenCalledWith('active query');

      handleDebounceSpy.mockRestore();
      jest.useRealTimers();
    });

    it('should not restart debounce when query is empty', () => {
      const handleDebounceSpy = jest
        .spyOn(view as any, 'handleSearchHistoryDebounce')
        .mockImplementation(() => {});

      view['suggestionDropdown'] = {
        isVisible: jest.fn().mockReturnValue(false),
      } as any;
      view['optionsDropdown'] = {
        isVisible: jest.fn().mockReturnValue(false),
      } as any;
      view['getSearchQuery'] = jest.fn().mockReturnValue('');

      view['handleDropdownVisibilityChange'](false);

      expect(handleDebounceSpy).not.toHaveBeenCalled();
      handleDebounceSpy.mockRestore();
    });
  });

  describe('captureSearchToHistory', () => {
    it('should delegate to optionsDropdown.addToHistory', () => {
      const addToHistory = jest.fn();
      view['optionsDropdown'] = { addToHistory } as any;

      view['captureSearchToHistory']('search term');

      expect(addToHistory).toHaveBeenCalledWith('search term', false);
    });

    it('should not throw when optionsDropdown is null', () => {
      view['optionsDropdown'] = null;
      expect(() => view['captureSearchToHistory']('search term')).not.toThrow();
    });
  });

  describe('updateContextMenuConfig', () => {
    it('should update context menu with new settings', () => {
      const updateConfig = jest.fn();
      view['taskContextMenu'] = { updateConfig } as any;
      view['plugin'] = {
        settings: {
          weekStartsOn: 'Monday',
          migrateToTodayState: 'MIGRATED',
        },
      } as any;

      view.updateContextMenuConfig();

      expect(updateConfig).toHaveBeenCalledWith({
        weekStartsOn: 'Monday',
        migrateToTodayState: 'MIGRATED',
      });
    });

    it('should not throw when taskContextMenu is null', () => {
      view['taskContextMenu'] = null;
      expect(() => view.updateContextMenuConfig()).not.toThrow();
    });
  });

  describe('onClose', () => {
    it('should clean up all listeners and timers', async () => {
      const removeEventListenerSpy = jest.spyOn(window, 'removeEventListener');

      const handler = jest.fn();
      const unsubscribeMock = jest.fn();
      view['_searchKeyHandler'] = handler;
      view['searchHistoryDebounceTimer'] = 100 as unknown as number;
      view['searchRefreshDebounceTimer'] = 200 as unknown as number;
      view['taskRefreshTimeout'] = 300 as unknown as number;
      view['unsubscribeFromStateManager'] = unsubscribeMock;
      view['resizeObserver'] = { disconnect: jest.fn() } as any;
      view['sentinelObserver'] = { disconnect: jest.fn() } as any;
      view['scrollEventListener'] = jest.fn();
      view['lazyLoadScrollHandler'] = jest.fn();
      view['taskListContainer'] = activeDocument.createElement('div');
      view['taskElementCache'] = { clear: jest.fn() } as any;
      view['renderQueue'] = { clear: jest.fn() } as any;
      view['optionsDropdown'] = { cleanup: jest.fn() } as any;
      view['suggestionDropdown'] = { cleanup: jest.fn() } as any;
      view['taskContextMenu'] = { cleanup: jest.fn() } as any;
      view['taskDragDropHandler'] = { destroy: jest.fn() } as any;

      await view.onClose();

      expect(removeEventListenerSpy).toHaveBeenCalledWith('keydown', handler);
      expect(view['_searchKeyHandler']).toBeUndefined();
      expect(unsubscribeMock).toHaveBeenCalled();
      expect(view['optionsDropdown']).toBeNull();
      expect(view['suggestionDropdown']).toBeNull();
      expect(view['taskDragDropHandler']).toBeNull();

      removeEventListenerSpy.mockRestore();
    });

    it('should handle null cleanup gracefully', async () => {
      view['_searchKeyHandler'] = undefined;
      view['searchHistoryDebounceTimer'] = null;
      view['searchRefreshDebounceTimer'] = null;
      view['taskRefreshTimeout'] = null;
      view['unsubscribeFromStateManager'] = null;
      view['resizeObserver'] = null;
      view['sentinelObserver'] = null;
      view['scrollEventListener'] = null;
      view['lazyLoadScrollHandler'] = null;
      view['taskListContainer'] = null;
      view['optionsDropdown'] = null;
      view['suggestionDropdown'] = null;
      view['taskContextMenu'] = null;
      view['taskDragDropHandler'] = null;
      view['taskElementCache'] = { clear: jest.fn() } as any;
      view['renderQueue'] = { clear: jest.fn() } as any;

      await expect(view.onClose()).resolves.not.toThrow();
    });
  });

  describe('updateTasks', () => {
    it('should update suggestion and options dropdown task references', () => {
      const updateTasks1 = jest.fn();
      const updateTasks2 = jest.fn();
      view['optionsDropdown'] = { updateTasks: updateTasks1 } as any;
      view['suggestionDropdown'] = { updateTasks: updateTasks2 } as any;

      const newTasks = [createBaseTask({ text: 'Updated task' })];
      view.updateTasks(newTasks);

      expect(view.tasks).toBe(newTasks);
      expect(updateTasks1).toHaveBeenCalledWith(newTasks);
      expect(updateTasks2).toHaveBeenCalledWith(newTasks);
    });

    it('should handle null dropdowns gracefully', () => {
      view['optionsDropdown'] = null;
      view['suggestionDropdown'] = null;

      const newTasks = [createBaseTask({ text: 'Updated task' })];
      expect(() => view.updateTasks(newTasks)).not.toThrow();
      expect(view.tasks).toBe(newTasks);
    });
  });

  describe('openTaskLocationForRenderer', () => {
    it('should delegate to openTaskLocation', () => {
      const openTaskLocationSpy = jest
        .spyOn(view as any, 'openTaskLocation')
        .mockResolvedValue(undefined);

      const task = createBaseTask({ text: 'Test task' });
      view['openTaskLocationForRenderer'](task);

      expect(openTaskLocationSpy).toHaveBeenCalled();
      const callArgs = openTaskLocationSpy.mock.calls[0];
      expect(callArgs[1]).toBe(task);
      expect(callArgs[0]).toBeInstanceOf(MouseEvent);

      openTaskLocationSpy.mockRestore();
    });
  });

  // ---------------------------------------------------------------------
  // Regression: handlers must read taskUpdateCoordinator from the field
  // captured in the constructor, NOT from window.todoSeqPlugin. This is
  // the contract enforced by the constructor-injection refactor.
  // ---------------------------------------------------------------------
  describe('taskUpdateCoordinator injection (no window globals)', () => {
    let originalWindowPlugin: unknown;

    // Build the fake "tasks" that the state manager will resolve to, so we
    // can assert the call args without leaking through private members.
    const innerTasks = [
      createBaseTask({
        path: 'inner-1.md',
        line: 0,
        text: 'Inner 1',
        state: 'TODO',
      }),
      createBaseTask({
        path: 'inner-2.md',
        line: 1,
        text: 'Inner 2',
        state: 'DOING',
      }),
    ];

    beforeEach(() => {
      // Force the state manager to return innerTasks[0] for any lookup
      taskStateManagerMock.findTaskByPathAndLine = jest
        .fn()
        .mockReturnValue(innerTasks[0]);

      // updateSettings() reads plugin.vaultScanner.getKeywordManager() —
      // add a stub so the test that exercises updateSettings does not throw.
      // Other tests in this describe don't call updateSettings, but having
      // the stub doesn't affect them.
      (pluginMock as Record<string, unknown>).vaultScanner = {
        getKeywordManager: jest.fn().mockReturnValue({
          getSettings: jest.fn().mockReturnValue({}),
          getAllKeywords: jest.fn().mockReturnValue([]),
          getCheckboxState: jest.fn().mockReturnValue(' '),
          isActive: jest.fn().mockReturnValue(false),
          isCompleted: jest.fn().mockReturnValue(false),
          isArchived: jest.fn().mockReturnValue(false),
          getActiveSet: jest.fn().mockReturnValue(new Set()),
          getWaitingSet: jest.fn().mockReturnValue(new Set()),
        }),
      };

      // Plant a poisoned window.todoSeqPlugin. Any code path that still
      // reads the global would invoke the mock fns below, which we then
      // assert were never called.
      originalWindowPlugin = (window as unknown as Record<string, unknown>)
        .todoSeqPlugin;
      (window as unknown as Record<string, unknown>).todoSeqPlugin = {
        taskUpdateCoordinator: {
          updateTaskPriority: jest.fn().mockResolvedValue(undefined),
          updateTaskScheduledDate: jest.fn().mockResolvedValue(undefined),
          updateTaskDeadlineDate: jest.fn().mockResolvedValue(undefined),
          updateTaskState: jest.fn().mockResolvedValue(undefined),
          updateTask: jest.fn().mockResolvedValue(undefined),
        },
      };
    });

    afterEach(() => {
      delete (pluginMock as Record<string, unknown>).vaultScanner;
      if (originalWindowPlugin === undefined) {
        delete (window as unknown as Record<string, unknown>).todoSeqPlugin;
      } else {
        (window as unknown as Record<string, unknown>).todoSeqPlugin =
          originalWindowPlugin;
      }
    });

    it('captures plugin.taskUpdateCoordinator into a field in the constructor', () => {
      expect(view['taskUpdateCoordinator']).toBe(
        pluginMock.taskUpdateCoordinator,
      );
    });

    it('re-syncs the field from the plugin inside updateSettings', () => {
      const replacement = {
        updateTaskPriority: jest.fn().mockResolvedValue(undefined),
        updateTaskScheduledDate: jest.fn().mockResolvedValue(undefined),
        updateTaskDeadlineDate: jest.fn().mockResolvedValue(undefined),
        updateTaskState: jest.fn().mockResolvedValue(undefined),
      };
      pluginMock.taskUpdateCoordinator = replacement;
      view.updateSettings();

      expect(view['taskUpdateCoordinator']).toBe(replacement);
    });

    describe('handleContextMenuPriorityChange', () => {
      it('delegates to the captured field (not the window global)', async () => {
        const task = createBaseTask({ path: 'inner-1.md', line: 0 });
        await view['handleContextMenuPriorityChange'](task, 'high');

        expect(
          pluginMock.taskUpdateCoordinator.updateTaskPriority,
        ).toHaveBeenCalledTimes(1);
        const args = (
          pluginMock.taskUpdateCoordinator.updateTaskPriority as jest.Mock
        ).mock.calls[0];
        expect(args[0]).toBe(innerTasks[0]); // resolved by TaskStateManager
        expect(args[1]).toBe('high');

        const windowCoord = (
          window as unknown as {
            todoSeqPlugin: {
              taskUpdateCoordinator: { updateTaskPriority: jest.Mock };
            };
          }
        ).todoSeqPlugin.taskUpdateCoordinator;
        expect(windowCoord.updateTaskPriority).not.toHaveBeenCalled();
      });

      it('logs and returns when the coordinator field is null', async () => {
        const errSpy = jest
          .spyOn(console, 'error')
          .mockImplementation(() => undefined);
        view['taskUpdateCoordinator'] = null;

        const task = createBaseTask({ path: 'inner-1.md', line: 0 });
        await view['handleContextMenuPriorityChange'](task, 'high');

        expect(errSpy).toHaveBeenCalled();
        const allMessages = errSpy.mock.calls
          .map((c) => c.join(' '))
          .join('\n');
        expect(allMessages).toMatch(/TaskUpdateCoordinator/);
        expect(
          pluginMock.taskUpdateCoordinator.updateTaskPriority,
        ).not.toHaveBeenCalled();
        errSpy.mockRestore();
      });

      it('logs and returns when the task cannot be resolved in the state manager', async () => {
        const errSpy = jest
          .spyOn(console, 'error')
          .mockImplementation(() => undefined);
        taskStateManagerMock.findTaskByPathAndLine = jest
          .fn()
          .mockReturnValue(null);

        const task = createBaseTask({ path: 'missing.md', line: 5 });
        await view['handleContextMenuPriorityChange'](task, 'low');

        expect(errSpy).toHaveBeenCalled();
        const allMessages = errSpy.mock.calls
          .map((c) => c.join(' '))
          .join('\n');
        expect(allMessages).toMatch(/Task not found/);
        expect(
          pluginMock.taskUpdateCoordinator.updateTaskPriority,
        ).not.toHaveBeenCalled();
        errSpy.mockRestore();
      });

      it('logs failures from the coordinator without leaking window access', async () => {
        const errSpy = jest
          .spyOn(console, 'error')
          .mockImplementation(() => undefined);
        (
          pluginMock.taskUpdateCoordinator.updateTaskPriority as jest.Mock
        ).mockRejectedValueOnce(new Error('boom'));

        const task = createBaseTask({ path: 'inner-1.md', line: 0 });
        await view['handleContextMenuPriorityChange'](task, 'med');

        expect(errSpy).toHaveBeenCalled();
        const allMessages = errSpy.mock.calls
          .map((c) => c.join(' '))
          .join('\n');
        expect(allMessages).toMatch(/Failed to update task priority/);
        errSpy.mockRestore();
      });
    });

    describe('handleContextMenuScheduledDateChange', () => {
      it('delegates to the captured field (not the window global)', async () => {
        const task = createBaseTask({ path: 'inner-1.md', line: 0 });
        const date = new Date(2026, 0, 1);

        await view['handleContextMenuScheduledDateChange'](
          task,
          date,
          null,
          null,
        );

        expect(
          pluginMock.taskUpdateCoordinator.updateTaskScheduledDate,
        ).toHaveBeenCalledTimes(1);
        expect(
          pluginMock.taskUpdateCoordinator.updateTaskScheduledDate,
        ).toHaveBeenCalledWith(innerTasks[0], date, null, null);

        const windowCoord = (
          window as unknown as {
            todoSeqPlugin: {
              taskUpdateCoordinator: { updateTaskScheduledDate: jest.Mock };
            };
          }
        ).todoSeqPlugin.taskUpdateCoordinator;
        expect(windowCoord.updateTaskScheduledDate).not.toHaveBeenCalled();
      });
    });

    describe('handleContextMenuDeadlineDateChange', () => {
      it('delegates to the captured field (not the window global)', async () => {
        const task = createBaseTask({ path: 'inner-1.md', line: 0 });
        const date = new Date(2026, 0, 15);

        await view['handleContextMenuDeadlineDateChange'](
          task,
          date,
          null,
          null,
        );

        expect(
          pluginMock.taskUpdateCoordinator.updateTaskDeadlineDate,
        ).toHaveBeenCalledTimes(1);
        expect(
          pluginMock.taskUpdateCoordinator.updateTaskDeadlineDate,
        ).toHaveBeenCalledWith(innerTasks[0], date, null, null);

        const windowCoord = (
          window as unknown as {
            todoSeqPlugin: {
              taskUpdateCoordinator: { updateTaskDeadlineDate: jest.Mock };
            };
          }
        ).todoSeqPlugin.taskUpdateCoordinator;
        expect(windowCoord.updateTaskDeadlineDate).not.toHaveBeenCalled();
      });
    });

    describe('updateTaskState', () => {
      it('delegates to the captured field (not the window global)', async () => {
        const task = createBaseTask({ path: 'inner-1.md', line: 0 });
        await view['updateTaskState'](task, 'DOING');

        expect(
          pluginMock.taskUpdateCoordinator.updateTaskState,
        ).toHaveBeenCalledTimes(1);
        expect(
          pluginMock.taskUpdateCoordinator.updateTaskState,
        ).toHaveBeenCalledWith(task, 'DOING', 'task-list');

        const windowCoord = (
          window as unknown as {
            todoSeqPlugin: {
              taskUpdateCoordinator: { updateTaskState: jest.Mock };
            };
          }
        ).todoSeqPlugin.taskUpdateCoordinator;
        expect(windowCoord.updateTaskState).not.toHaveBeenCalled();
      });

      it('logs and returns when the coordinator field is null', async () => {
        const errSpy = jest
          .spyOn(console, 'error')
          .mockImplementation(() => undefined);
        view['taskUpdateCoordinator'] = null;

        const task = createBaseTask({ path: 'inner-1.md', line: 0 });
        await view['updateTaskState'](task, 'DOING');

        expect(errSpy).toHaveBeenCalled();
        const allMessages = errSpy.mock.calls
          .map((c) => c.join(' '))
          .join('\n');
        expect(allMessages).toMatch(/TaskUpdateCoordinator/);
        expect(
          pluginMock.taskUpdateCoordinator.updateTaskState,
        ).not.toHaveBeenCalled();
        errSpy.mockRestore();
      });
    });
  });

  describe('saved search delete', () => {
    it('confirmed delete removes the search', () => {
      const search = createSavedSearch('Agenda', 'state:active');
      pluginMock.settings.savedSearches = [search];

      (view as any).deleteSavedSearch(search);

      const { ConfirmationModal } = jest.requireMock('obsidian') as {
        ConfirmationModal: jest.Mock;
      };
      expect(ConfirmationModal).toHaveBeenCalled();
      const modal = ConfirmationModal.mock.results.at(-1)!.value;
      expect(modal.setTitle).toHaveBeenCalledWith('Delete saved search');
      expect(modal.setContent).toHaveBeenCalledWith(
        'Are you sure you want to delete the saved search "Agenda"?',
      );
      expect(modal.open).toHaveBeenCalled();

      modal._lastButton._clickHandler(new MouseEvent('click'));

      expect(
        pluginMock.settings.savedSearches.find((s) => s.id === search.id),
      ).toBeUndefined();
      expect(pluginMock.saveSettings).toHaveBeenCalled();
      const { Notice } = jest.requireMock('obsidian') as {
        Notice: jest.Mock;
      };
      expect(Notice).toHaveBeenCalledWith('Saved search "Agenda" deleted');
    });

    it('cancel (no confirm) does nothing', () => {
      const search = createSavedSearch('Agenda', 'state:active');
      pluginMock.settings.savedSearches = [search];

      (view as any).deleteSavedSearch(search);

      const { ConfirmationModal } = jest.requireMock('obsidian') as {
        ConfirmationModal: jest.Mock;
      };
      expect(ConfirmationModal).toHaveBeenCalled();

      expect(
        pluginMock.settings.savedSearches.find((s) => s.id === search.id),
      ).toBeDefined();
      expect(pluginMock.saveSettings).not.toHaveBeenCalled();
    });

    it('edit-dialog confirmed delete closes dialog and removes search', () => {
      const search = createSavedSearch('Agenda', 'state:active');
      pluginMock.settings.savedSearches = [search];

      (view as any).openEditSavedSearchDialog(search);

      const deleteBtn = document.querySelector(
        '.todoseq-saved-search-btn-delete',
      );
      expect(deleteBtn).not.toBeNull();
      deleteBtn!.click();

      const { ConfirmationModal } = jest.requireMock('obsidian') as {
        ConfirmationModal: jest.Mock;
      };
      expect(ConfirmationModal).toHaveBeenCalled();

      const modal = ConfirmationModal.mock.results.at(-1)!.value;
      modal._lastButton._clickHandler(new MouseEvent('click'));

      expect(document.querySelector('.todoseq-saved-search-modal')).toBeNull();
      expect(
        pluginMock.settings.savedSearches.find((s) => s.id === search.id),
      ).toBeUndefined();
      expect(pluginMock.saveSettings).toHaveBeenCalled();
    });

    it('edit-dialog cancel keeps both the dialog and the search', () => {
      const search = createSavedSearch('Agenda', 'state:active');
      pluginMock.settings.savedSearches = [search];

      (view as any).openEditSavedSearchDialog(search);

      const deleteBtn = document.querySelector(
        '.todoseq-saved-search-btn-delete',
      );
      expect(deleteBtn).not.toBeNull();
      deleteBtn!.click();

      const { ConfirmationModal } = jest.requireMock('obsidian') as {
        ConfirmationModal: jest.Mock;
      };
      expect(ConfirmationModal).toHaveBeenCalled();

      expect(
        document.querySelector('.todoseq-saved-search-modal'),
      ).not.toBeNull();
      expect(
        pluginMock.settings.savedSearches.find((s) => s.id === search.id),
      ).toBeDefined();
      expect(pluginMock.saveSettings).not.toHaveBeenCalled();
    });
  });
});
