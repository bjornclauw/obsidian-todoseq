import { TaskParser } from '../src/parser/task-parser';
import { createTestKeywordManager } from './helpers/test-helper';

describe('TaskParser.parseTaskBlock', () => {
  const keywordManager = createTestKeywordManager();
  const parser = TaskParser.create(keywordManager, null);

  it('parses a task together with its following date lines', () => {
    const lines = [
      undefined as unknown as string,
      '- [ ] TODO Pay rent',
      '  SCHEDULED: <2026-03-10 Tue +1w>',
      '  DEADLINE: <2026-03-12 Thu>',
      '',
      'Some other paragraph',
    ];

    const task = parser.parseTaskBlock(lines, 1, 'test.md');

    expect(task).not.toBeNull();
    expect(task?.line).toBe(1);
    expect(task?.state).toBe('TODO');
    expect(task?.scheduledDate).toBeTruthy();
    expect(task?.scheduledDateRepeat?.raw).toBe('+1w');
    expect(task?.deadlineDate).toBeTruthy();
  });

  it('accepts a sparse array (holes before the task index)', () => {
    const lines: string[] = [];
    lines.length = 6;
    lines[3] = 'TODO Ship release';
    lines[4] = '  SCHEDULED: <2026-04-01 Wed>';

    const task = parser.parseTaskBlock(lines, 3, 'test.md');

    expect(task?.line).toBe(3);
    expect(task?.text).toBe('Ship release');
    expect(task?.scheduledDate).toBeTruthy();
  });

  it('parses heading tasks', () => {
    const lines = [
      '### TODO Write docs',
      'SCHEDULED: <2026-04-01 Wed>',
      'DESCRIPTION: keep it short',
    ];

    const task = parser.parseTaskBlock(lines, 0, 'test.md');

    expect(task?.state).toBe('TODO');
    expect(task?.headingLevel).toBe(3);
    expect(task?.scheduledDate).toBeTruthy();
    expect(task?.description).toBe('keep it short');
  });

  it('parses a specific table cell task', () => {
    const row =
      '| no | - [ ] TODO Cell task <br>SCHEDULED: <2026-03-10 Tue +1w> |';

    const task = parser.parseTaskBlock([row], 0, 'test.md', undefined, 1);

    expect(task).not.toBeNull();
    expect(task?.isTableTask).toBe(true);
    expect(task?.tableCell?.cellIndex).toBe(1);
    expect(task?.scheduledDateRepeat?.raw).toBe('+1w');
  });

  it('returns null for a line that is not a task', () => {
    expect(
      parser.parseTaskBlock(['Just a paragraph'], 0, 'test.md'),
    ).toBeNull();
  });

  it('returns null for an out-of-range index', () => {
    expect(parser.parseTaskBlock(['TODO Task'], 5, 'test.md')).toBeNull();
    expect(parser.parseTaskBlock(['TODO Task'], -1, 'test.md')).toBeNull();
  });
});
