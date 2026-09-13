import { groupTasks, GroupByField } from '../src/utils/task-group';
import { createBaseTask, createDate } from './helpers/test-helper';
import { LocaleUtils } from '../src/utils/locale-utils';

describe('groupTasks', () => {
  test('returns an empty array for no tasks', () => {
    expect(groupTasks([], 'folder')).toEqual([]);
  });

  describe('folder', () => {
    test('groups by directory in alphabetical order', () => {
      const tasks = [
        createBaseTask({ path: 'projects/alpha.md' }),
        createBaseTask({ path: 'notes/beta.md' }),
        createBaseTask({ path: 'projects/gamma.md' }),
      ];

      const groups = groupTasks(tasks, 'folder');

      expect(groups.map((g) => g.label)).toEqual(['notes/', 'projects/']);
      expect(groups[1].tasks).toHaveLength(2);
      expect(groups[0].tasks).toHaveLength(1);
    });

    test('labels the vault root as /', () => {
      const tasks = [createBaseTask({ path: 'root-note.md' })];

      const groups = groupTasks(tasks, 'folder');

      expect(groups).toHaveLength(1);
      expect(groups[0].label).toBe('/');
      expect(groups[0].key).toBe('');
    });

    test('labels nested folders with their full path', () => {
      const tasks = [createBaseTask({ path: 'a/b/c/deep.md' })];

      const groups = groupTasks(tasks, 'folder');

      expect(groups[0].label).toBe('a/b/c/');
      expect(groups[0].key).toBe('a/b/c');
    });
  });

  describe('file', () => {
    test('labels the file without its extension', () => {
      const tasks = [createBaseTask({ path: 'projects/roadmap.md' })];

      const groups = groupTasks(tasks, 'file');

      expect(groups).toHaveLength(1);
      expect(groups[0].label).toBe('roadmap');
    });

    test('keeps the same filename in different folders as distinct groups', () => {
      const tasks = [
        createBaseTask({ path: 'a/note.md' }),
        createBaseTask({ path: 'b/note.md' }),
      ];

      const groups = groupTasks(tasks, 'file');

      expect(groups).toHaveLength(2);
      expect(groups.map((g) => g.label)).toEqual(['note', 'note']);
      expect(groups[0].key).toBe('a/note.md');
      expect(groups[1].key).toBe('b/note.md');
    });

    test('handles files without an extension', () => {
      const tasks = [createBaseTask({ path: 'README' })];

      const groups = groupTasks(tasks, 'file');

      expect(groups[0].label).toBe('README');
    });
  });

  describe('heading', () => {
    test('groups by parentHeading and merges non-adjacent matches', () => {
      const tasks = [
        createBaseTask({ parentHeading: 'Alpha' }),
        createBaseTask({ parentHeading: 'Beta' }),
        createBaseTask({ parentHeading: 'Alpha' }),
      ];

      const groups = groupTasks(tasks, 'heading');

      expect(groups.map((g) => g.label)).toEqual(['Alpha', 'Beta']);
      expect(groups[0].tasks).toHaveLength(2);
      expect(groups[1].tasks).toHaveLength(1);
    });

    test('uses a fallback label for tasks with no heading', () => {
      const tasks = [
        createBaseTask({ parentHeading: undefined }),
        createBaseTask({ parentHeading: 'Section' }),
      ];

      const groups = groupTasks(tasks, 'heading');

      expect(groups.map((g) => g.label)).toEqual(['Section', '(No heading)']);
    });

    test('distinguishes the no-heading key from a real heading', () => {
      const noHeading = groupTasks(
        [createBaseTask({ parentHeading: undefined })],
        'heading',
      );
      const realHeading = groupTasks(
        [createBaseTask({ parentHeading: 'Section' })],
        'heading',
      );

      expect(noHeading[0].key).not.toBe(realHeading[0].key);
    });
  });

  test('preserves task order within a group', () => {
    const tasks = [
      createBaseTask({ path: 'a/one.md', line: 1 }),
      createBaseTask({ path: 'a/two.md', line: 2 }),
      createBaseTask({ path: 'a/three.md', line: 3 }),
    ];

    const groups = groupTasks(tasks, 'folder');

    expect(groups[0].tasks.map((t) => t.line)).toEqual([1, 2, 3]);
  });

  test('every field returns groups with the same tasks as the input', () => {
    const tasks = [
      createBaseTask({ path: 'a/one.md', parentHeading: 'A' }),
      createBaseTask({ path: 'a/two.md', parentHeading: undefined }),
      createBaseTask({ path: 'b/one.md', parentHeading: 'A' }),
    ];
    const fields: GroupByField[] = [
      'folder',
      'file',
      'heading',
      'status',
      'priority',
      'scheduled',
    ];

    for (const field of fields) {
      const flattened = groupTasks(tasks, field).flatMap((g) => g.tasks);
      expect(flattened).toHaveLength(tasks.length);
      expect(new Set(flattened)).toEqual(new Set(tasks));
    }
  });

  describe('status', () => {
    test('groups by state keyword in first-appearance order', () => {
      const tasks = [
        createBaseTask({ state: 'TODO', text: 'a' }),
        createBaseTask({ state: 'DONE', text: 'b', completed: true }),
        createBaseTask({ state: 'TODO', text: 'c' }),
      ];

      const groups = groupTasks(tasks, 'status');

      expect(groups.map((g) => g.label)).toEqual(['TODO', 'DONE']);
      expect(groups[0].tasks).toHaveLength(2);
      expect(groups[0].key).toBe('TODO');
    });

    test('orders groups by a supplied state ranker, honouring direction', () => {
      const rank = (state: string): number =>
        ({ DOING: 0, TODO: 1, DONE: 2 })[state] ?? 99;
      const tasks = [
        createBaseTask({ state: 'DONE', text: 'a' }),
        createBaseTask({ state: 'TODO', text: 'b' }),
        createBaseTask({ state: 'DOING', text: 'c' }),
      ];

      const asc = groupTasks(tasks, 'status', 'asc', { stateRank: rank });
      expect(asc.map((g) => g.label)).toEqual(['DOING', 'TODO', 'DONE']);

      const desc = groupTasks(tasks, 'status', 'desc', { stateRank: rank });
      expect(desc.map((g) => g.label)).toEqual(['DONE', 'TODO', 'DOING']);
    });
  });

  describe('priority', () => {
    test('orders groups High → Low with no-priority last by default', () => {
      const tasks = [
        createBaseTask({ priority: null }),
        createBaseTask({ priority: 'high' }),
        createBaseTask({ priority: 'med' }),
        createBaseTask({ priority: 'low' }),
      ];

      const groups = groupTasks(tasks, 'priority');

      expect(groups.map((g) => g.label)).toEqual([
        'High',
        'Medium',
        'Low',
        'No priority',
      ]);
      expect(groups.map((g) => g.key)).toEqual(['high', 'med', 'low', 'none']);
    });

    test('asc orders Low → High, still with no-priority last', () => {
      const tasks = [
        createBaseTask({ priority: null }),
        createBaseTask({ priority: 'high' }),
        createBaseTask({ priority: 'med' }),
        createBaseTask({ priority: 'low' }),
      ];

      const groups = groupTasks(tasks, 'priority', 'asc');

      expect(groups.map((g) => g.label)).toEqual([
        'Low',
        'Medium',
        'High',
        'No priority',
      ]);
    });
  });

  describe('tag', () => {
    test('duplicates a multi-tag task into each tag group, No tag last', () => {
      const tasks = [
        createBaseTask({ text: 'a', tags: ['work', 'urgent'] }),
        createBaseTask({ text: 'b', tags: ['home'] }),
        createBaseTask({ text: 'c', tags: [] }),
        createBaseTask({ text: 'd', tags: ['urgent'] }),
      ];

      const groups = groupTasks(tasks, 'tag');

      expect(groups.map((g) => g.label)).toEqual([
        '#home',
        '#urgent',
        '#work',
        'No tag',
      ]);
      expect(
        groups.find((g) => g.label === '#urgent')?.tasks.map((t) => t.text),
      ).toEqual(['a', 'd']);
      expect(
        groups.find((g) => g.label === '#work')?.tasks.map((t) => t.text),
      ).toEqual(['a']);
      expect(
        groups.find((g) => g.label === 'No tag')?.tasks.map((t) => t.text),
      ).toEqual(['c']);
    });

    test('dedupes repeated tags within one task', () => {
      const groups = groupTasks(
        [createBaseTask({ text: 'a', tags: ['edge', 'edge'] })],
        'tag',
      );
      expect(groups).toHaveLength(1);
      expect(groups[0].tasks).toHaveLength(1);
    });

    test('merges case-variant tags into one group', () => {
      const groups = groupTasks(
        [
          createBaseTask({ text: 'a', tags: ['Work'] }),
          createBaseTask({ text: 'b', tags: ['work'] }),
        ],
        'tag',
      );
      expect(groups).toHaveLength(1);
      expect(groups[0].label).toBe('#Work');
      expect(groups[0].tasks.map((t) => t.text)).toEqual(['a', 'b']);
    });

    test('orders tags alphabetically and reverses with desc, No tag last', () => {
      const tasks = [
        createBaseTask({ text: 'a', tags: ['zeta'] }),
        createBaseTask({ text: 'b', tags: ['alpha'] }),
        createBaseTask({ text: 'c', tags: [] }),
      ];

      expect(groupTasks(tasks, 'tag').map((g) => g.label)).toEqual([
        '#alpha',
        '#zeta',
        'No tag',
      ]);
      expect(groupTasks(tasks, 'tag', 'desc').map((g) => g.label)).toEqual([
        '#zeta',
        '#alpha',
        'No tag',
      ]);
    });
  });

  describe('date fields', () => {
    beforeEach(() => LocaleUtils.setLocale('en-US'));
    afterEach(() => LocaleUtils.setLocale(null));

    test('groups by calendar day and labels with a localized date', () => {
      const tasks = [
        createBaseTask({ scheduledDate: createDate(2026, 3, 5, 9) }),
        createBaseTask({ scheduledDate: createDate(2026, 3, 5, 17) }),
        createBaseTask({ scheduledDate: createDate(2026, 3, 6) }),
      ];

      const groups = groupTasks(tasks, 'scheduled');

      expect(groups.map((g) => g.key)).toEqual(['2026-03-05', '2026-03-06']);
      expect(groups[0].tasks).toHaveLength(2);
      expect(groups[0].label).toContain('2026');
      expect(groups[1].label).toContain('2026');
    });

    test('uses a No <field> fallback group for missing dates', () => {
      expect(groupTasks([createBaseTask()], 'scheduled')[0].key).toBe('');
      expect(groupTasks([createBaseTask()], 'scheduled')[0].label).toBe(
        'No scheduled',
      );
      expect(
        groupTasks([createBaseTask({ deadlineDate: null })], 'deadline')[0]
          .label,
      ).toBe('No deadline');
      expect(
        groupTasks([createBaseTask({ closedDate: null })], 'closed')[0].label,
      ).toBe('No closed');
      expect(
        groupTasks([createBaseTask({ startedDate: null })], 'started')[0].label,
      ).toBe('No started');
    });

    test('separates different calendar days', () => {
      const groups = groupTasks(
        [
          createBaseTask({ deadlineDate: createDate(2026, 3, 5) }),
          createBaseTask({ deadlineDate: createDate(2026, 3, 7) }),
        ],
        'deadline',
      );
      expect(groups.map((g) => g.key)).toEqual(['2026-03-05', '2026-03-07']);
    });

    test('desc orders dates latest-first, keeping the missing group last', () => {
      const groups = groupTasks(
        [
          createBaseTask({ scheduledDate: createDate(2026, 3, 5) }),
          createBaseTask({ scheduledDate: null }),
          createBaseTask({ scheduledDate: createDate(2026, 3, 7) }),
        ],
        'scheduled',
        'desc',
      );
      expect(groups.map((g) => g.key)).toEqual([
        '2026-03-07',
        '2026-03-05',
        '',
      ]);
    });
  });

  describe('direction', () => {
    test('reverses the group order without reversing tasks within a group', () => {
      const tasks = [
        createBaseTask({ path: 'a/x.md' }),
        createBaseTask({ path: 'b/y.md' }),
        createBaseTask({ path: 'a/z.md' }),
      ];

      const desc = groupTasks(tasks, 'folder', 'desc');

      expect(desc.map((g) => g.label)).toEqual(['b/', 'a/']);
      expect(
        desc.find((g) => g.label === 'a/')?.tasks.map((t) => t.path),
      ).toEqual(['a/x.md', 'a/z.md']);
    });
  });
});
