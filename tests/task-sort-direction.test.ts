import {
  getNaturalDirection,
  getSortFunction,
  sortTasksWithThreeBlockSystem,
  KeywordSortConfig,
} from '../src/utils/task-sort';
import { Task } from '../src/types/task';
import { createBaseTask } from './helpers/test-helper';

const makeTask = (overrides: Partial<Task> = {}): Task =>
  createBaseTask({
    path: 'a.md',
    line: 0,
    rawText: 'TODO t',
    text: 't',
    ...overrides,
  });

const textsOf = (tasks: Task[], cmp: (a: Task, b: Task) => number): string[] =>
  [...tasks].sort(cmp).map((task) => task.text);

describe('task-sort direction + secondary key', () => {
  describe('getNaturalDirection', () => {
    it('is desc for priority, urgency, closed and started; asc otherwise', () => {
      expect(getNaturalDirection('sortByPriority')).toBe('desc');
      expect(getNaturalDirection('sortByUrgency')).toBe('desc');
      expect(getNaturalDirection('sortByClosedDate')).toBe('desc');
      expect(getNaturalDirection('sortByStarted')).toBe('desc');
      expect(getNaturalDirection('sortByScheduled')).toBe('asc');
      expect(getNaturalDirection('sortByDeadline')).toBe('asc');
      expect(getNaturalDirection('sortByKeyword')).toBe('asc');
      expect(getNaturalDirection('sortByTag')).toBe('asc');
      expect(getNaturalDirection('default')).toBe('asc');
    });
  });

  describe('priority', () => {
    const tasks = [
      makeTask({ text: 'low', priority: 'low' }),
      makeTask({ text: 'none', priority: null }),
      makeTask({ text: 'high', priority: 'high' }),
      makeTask({ text: 'med', priority: 'med' }),
    ];

    it('defaults to high → low with no-priority last', () => {
      expect(textsOf(tasks, getSortFunction('sortByPriority'))).toEqual([
        'high',
        'med',
        'low',
        'none',
      ]);
    });

    it('reverses to low → high but keeps no-priority last on asc', () => {
      expect(
        textsOf(tasks, getSortFunction('sortByPriority', undefined, 'asc')),
      ).toEqual(['low', 'med', 'high', 'none']);
    });
  });

  describe('scheduled dates', () => {
    const early = new Date('2026-03-01');
    const late = new Date('2026-03-10');
    const tasks = [
      makeTask({ text: 'late', scheduledDate: late }),
      makeTask({ text: 'none', scheduledDate: null }),
      makeTask({ text: 'early', scheduledDate: early }),
    ];

    it('ascending puts earlier first and no-date last', () => {
      expect(
        textsOf(tasks, getSortFunction('sortByScheduled', undefined, 'asc')),
      ).toEqual(['early', 'late', 'none']);
    });

    it('descending puts later first but still no-date last', () => {
      expect(
        textsOf(tasks, getSortFunction('sortByScheduled', undefined, 'desc')),
      ).toEqual(['late', 'early', 'none']);
    });
  });

  describe('urgency', () => {
    const tasks = [
      makeTask({ text: 'mid', urgency: 3 }),
      makeTask({ text: 'none', urgency: null }),
      makeTask({ text: 'top', urgency: 9 }),
    ];

    it('defaults to highest first with unscored last', () => {
      expect(textsOf(tasks, getSortFunction('sortByUrgency'))).toEqual([
        'top',
        'mid',
        'none',
      ]);
    });

    it('ascending puts lowest first with unscored last', () => {
      expect(
        textsOf(tasks, getSortFunction('sortByUrgency', undefined, 'asc')),
      ).toEqual(['mid', 'top', 'none']);
    });
  });

  describe('tag', () => {
    const tasks = [
      makeTask({ text: 'work', tags: ['work'] }),
      makeTask({ text: 'untagged', tags: [] }),
      makeTask({ text: 'alpha', tags: ['alpha'] }),
      makeTask({ text: 'multi', tags: ['zeta', 'beta'] }),
    ];

    it('sorts by the alphabetically-first tag, untagged last', () => {
      expect(textsOf(tasks, getSortFunction('sortByTag'))).toEqual([
        'alpha',
        'multi',
        'work',
        'untagged',
      ]);
    });

    it('reverses with desc but keeps untagged last', () => {
      expect(
        textsOf(tasks, getSortFunction('sortByTag', undefined, 'desc')),
      ).toEqual(['work', 'multi', 'alpha', 'untagged']);
    });

    it('compares tags case-insensitively', () => {
      const tagged = [
        makeTask({ text: 'upper', tags: ['Beta'] }),
        makeTask({ text: 'lower', tags: ['alpha'] }),
      ];
      expect(textsOf(tagged, getSortFunction('sortByTag'))).toEqual([
        'lower',
        'upper',
      ]);
    });
  });

  describe('keyword', () => {
    const config: KeywordSortConfig = {
      activeKeywords: new Set(['DOING']),
      activeKeywordsOrder: ['DOING'],
      inactiveKeywords: new Set(['TODO']),
      inactiveKeywordsOrder: ['TODO'],
      waitingKeywords: new Set(),
      waitingKeywordsOrder: [],
      completedKeywords: new Set(['DONE']),
      completedKeywordsOrder: ['DONE'],
    };
    const tasks = [
      makeTask({ text: 'todo', state: 'TODO' }),
      makeTask({ text: 'doing', state: 'DOING' }),
      makeTask({ text: 'done', state: 'DONE', completed: true }),
    ];

    it('asc orders by keyword group', () => {
      expect(textsOf(tasks, getSortFunction('sortByKeyword', config))).toEqual([
        'doing',
        'todo',
        'done',
      ]);
    });

    it('desc reverses the keyword order', () => {
      expect(
        textsOf(tasks, getSortFunction('sortByKeyword', config, 'desc')),
      ).toEqual(['done', 'todo', 'doing']);
    });
  });

  describe('default/filepath', () => {
    it('honours desc by reversing path+line order', () => {
      const tasks = [
        makeTask({ text: 'b', path: 'b.md', line: 0 }),
        makeTask({ text: 'a', path: 'a.md', line: 0 }),
      ];
      expect(textsOf(tasks, getSortFunction('default'))).toEqual(['a', 'b']);
      expect(
        textsOf(tasks, getSortFunction('default', undefined, 'desc')),
      ).toEqual(['b', 'a']);
    });
  });

  describe('secondary key', () => {
    const early = new Date('2026-03-01');
    const late = new Date('2026-03-10');

    it('orders within the primary group by the secondary key', () => {
      const tasks = [
        makeTask({ text: 'high-late', priority: 'high', scheduledDate: late }),
        makeTask({
          text: 'high-early',
          priority: 'high',
          scheduledDate: early,
        }),
        makeTask({ text: 'none-early', priority: null, scheduledDate: early }),
      ];

      const cmp = getSortFunction('sortByPriority', undefined, 'desc', {
        method: 'sortByScheduled',
        direction: 'asc',
      });

      expect(textsOf(tasks, cmp)).toEqual([
        'high-early',
        'high-late',
        'none-early',
      ]);
    });

    it('wins over the implicit tie-breaker', () => {
      const tasks = [
        makeTask({ text: 'first-file', line: 0, priority: 'low' }),
        makeTask({ text: 'second-file', line: 1, priority: 'high' }),
      ];
      const sameDate = new Date('2026-03-01');
      tasks.forEach((t) => (t.scheduledDate = sameDate));

      const cmp = getSortFunction('sortByScheduled', undefined, 'asc', {
        method: 'sortByPriority',
        direction: 'desc',
      });

      expect(textsOf(tasks, cmp)).toEqual(['second-file', 'first-file']);
    });

    it('is used when the primary field is missing on both tasks', () => {
      const tasks = [
        makeTask({ text: 'low', priority: 'low', scheduledDate: null }),
        makeTask({ text: 'high', priority: 'high', scheduledDate: null }),
      ];

      const cmp = getSortFunction('sortByScheduled', undefined, 'asc', {
        method: 'sortByPriority',
        direction: 'desc',
      });

      expect(textsOf(tasks, cmp)).toEqual(['high', 'low']);
    });
  });

  describe('sortTasksWithThreeBlockSystem', () => {
    const now = new Date('2026-03-05T12:00:00');
    const tasks = [
      makeTask({ text: 'low', priority: 'low' }),
      makeTask({ text: 'high', priority: 'high' }),
    ];

    it('preserves the natural direction when omitted', () => {
      const sorted = sortTasksWithThreeBlockSystem(
        tasks,
        now,
        'showAll',
        'showAll',
        'sortByPriority',
      );
      expect(sorted.map((t) => t.text)).toEqual(['high', 'low']);
    });

    it('honours an explicit direction', () => {
      const sorted = sortTasksWithThreeBlockSystem(
        tasks,
        now,
        'showAll',
        'showAll',
        'sortByPriority',
        undefined,
        undefined,
        'asc',
      );
      expect(sorted.map((t) => t.text)).toEqual(['low', 'high']);
    });
  });
});
