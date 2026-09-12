import { TaskParser } from '../src/parser/task-parser';
import {
  createBaseSettings,
  createTestKeywordManager,
} from './helpers/test-helper';

describe('TaskParser - parentHeading context', () => {
  const createParser = (includeCommentBlocks = false) => {
    const settings = createBaseSettings();
    return TaskParser.create(
      createTestKeywordManager(settings),
      null,
      undefined,
      { includeCommentBlocks },
    );
  };

  test('assigns the nearest preceding heading to a task', () => {
    const parser = createParser();
    const tasks = parser.parseFile(
      ['## Work', '- [ ] TODO write report'].join('\n'),
      'test.md',
    );

    expect(tasks).toHaveLength(1);
    expect(tasks[0].parentHeading).toBe('Work');
  });

  test('leaves parentHeading undefined before any heading', () => {
    const parser = createParser();
    const tasks = parser.parseFile('- [ ] TODO orphan task', 'test.md');

    expect(tasks).toHaveLength(1);
    expect(tasks[0].parentHeading).toBeUndefined();
  });

  test('uses the nearest preceding heading across multiple headings', () => {
    const parser = createParser();
    const tasks = parser.parseFile(
      [
        '# Section A',
        '- [ ] TODO task a',
        '## Section B',
        '- [ ] TODO task b',
        '### Section C',
        '- [ ] TODO task c',
      ].join('\n'),
      'test.md',
    );

    expect(tasks.map((t) => t.parentHeading)).toEqual([
      'Section A',
      'Section B',
      'Section C',
    ]);
  });

  test('tracks heading levels independently', () => {
    const parser = createParser();
    const tasks = parser.parseFile(
      ['# One', '- [ ] TODO a', '### Three', '- [ ] TODO b'].join('\n'),
      'test.md',
    );

    expect(tasks.map((t) => t.parentHeading)).toEqual(['One', 'Three']);
  });

  test('strips trailing hashes from the heading text', () => {
    const parser = createParser();
    const tasks = parser.parseFile(
      ['## Title ##', '- [ ] TODO task'].join('\n'),
      'test.md',
    );

    expect(tasks[0].parentHeading).toBe('Title');
  });

  test('keeps inline markdown in the heading text unchanged', () => {
    const parser = createParser();
    const tasks = parser.parseFile(
      ['## **Bold** heading', '- [ ] TODO task'].join('\n'),
      'test.md',
    );

    expect(tasks[0].parentHeading).toBe('**Bold** heading');
  });

  test('does not change context for headings inside a fenced code block', () => {
    const parser = createParser();
    const tasks = parser.parseFile(
      [
        '# Real Heading',
        '```',
        '## Not a heading',
        '- [ ] TODO inside fence',
        '```',
        '- [ ] TODO after fence',
      ].join('\n'),
      'test.md',
    );

    const afterFence = tasks.find((t) => t.text === 'after fence');
    expect(afterFence?.parentHeading).toBe('Real Heading');
    expect(tasks.some((t) => t.parentHeading === 'Not a heading')).toBe(false);
  });

  test('a heading task belongs to the prior heading, later tasks to its text', () => {
    const parser = createParser();
    const tasks = parser.parseFile(
      [
        '## Section A',
        '# TODO Heading Task',
        '## Section B',
        '- [ ] TODO normal',
      ].join('\n'),
      'test.md',
    );

    const headingTask = tasks.find((t) => t.headingLevel === 1);
    expect(headingTask?.text).toBe('Heading Task');
    expect(headingTask?.parentHeading).toBe('Section A');

    const normal = tasks.find((t) => t.headingLevel === undefined);
    expect(normal?.parentHeading).toBe('Section B');
  });

  test('a heading task at the top has no parent heading', () => {
    const parser = createParser();
    const tasks = parser.parseFile('# TODO Top task', 'test.md');

    expect(tasks).toHaveLength(1);
    expect(tasks[0].parentHeading).toBeUndefined();
  });

  test('assigns context to table-cell tasks', () => {
    const parser = createParser();
    const tasks = parser.parseFile(
      ['# Tables', '| - [ ] TODO cell task |'].join('\n'),
      'test.md',
    );

    expect(tasks).toHaveLength(1);
    expect(tasks[0].isTableTask).toBe(true);
    expect(tasks[0].parentHeading).toBe('Tables');
  });

  test('assigns context to footnote tasks', () => {
    const parser = createParser();
    const tasks = parser.parseFile(
      ['# Footnotes', '[^1]: TODO footnote task'].join('\n'),
      'test.md',
    );

    expect(tasks).toHaveLength(1);
    expect(tasks[0].parentHeading).toBe('Footnotes');
  });

  test('assigns context to comment-block tasks when enabled', () => {
    const parser = createParser(true);
    const tasks = parser.parseFile(
      ['# Comments', '%% - [ ] TODO hidden task %%'].join('\n'),
      'test.md',
    );

    expect(tasks).toHaveLength(1);
    expect(tasks[0].parentHeading).toBe('Comments');
  });
});
