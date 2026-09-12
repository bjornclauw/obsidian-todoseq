import { groupTasks, GroupByField } from '../src/utils/task-group';
import { createBaseTask } from './helpers/test-helper';

describe('groupTasks', () => {
  test('returns an empty array for no tasks', () => {
    expect(groupTasks([], 'folder')).toEqual([]);
  });

  describe('folder', () => {
    test('groups by directory and preserves first-appearance order', () => {
      const tasks = [
        createBaseTask({ path: 'projects/alpha.md' }),
        createBaseTask({ path: 'notes/beta.md' }),
        createBaseTask({ path: 'projects/gamma.md' }),
      ];

      const groups = groupTasks(tasks, 'folder');

      expect(groups.map((g) => g.label)).toEqual(['projects/', 'notes/']);
      expect(groups[0].tasks).toHaveLength(2);
      expect(groups[1].tasks).toHaveLength(1);
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

      expect(groups.map((g) => g.label)).toEqual(['(No heading)', 'Section']);
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
    const fields: GroupByField[] = ['folder', 'file', 'heading'];

    for (const field of fields) {
      const flattened = groupTasks(tasks, field).flatMap((g) => g.tasks);
      expect(flattened).toHaveLength(tasks.length);
      expect(new Set(flattened)).toEqual(new Set(tasks));
    }
  });
});
