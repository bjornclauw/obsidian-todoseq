import { TaskParser } from '../src/parser/task-parser';
import { createTestKeywordManager } from './helpers/test-helper';

describe('TaskParser - recurring completion log', () => {
  const keywordManager = createTestKeywordManager();
  const parser = TaskParser.create(keywordManager, null);

  it('reads the running total from a [!repeats] callout after the date lines', () => {
    const content = [
      '- [ ] TODO Pay rent',
      '  SCHEDULED: <2026-04-01 Wed +1m>',
      '  > [!repeats]- Repeats: 3 (latest 50)',
      '  > - #3 · closed 2026-03-01 Sun 09:12 · due 2026-03-01 Sun',
      '  > - #2 · closed 2026-02-01 Sat 08:40 · due 2026-02-01 Sat',
    ].join('\n');

    const tasks = parser.parseFile(content, 'test.md');

    expect(tasks).toHaveLength(1);
    expect(tasks[0].repeatCount).toBe(3);
    // Date lines still parse and the log does not leak into the task text.
    expect(tasks[0].scheduledDate).toBeTruthy();
    expect(tasks[0].text).toBe('Pay rent');
  });

  it('reads the total for heading tasks', () => {
    const content = [
      '### TODO Pay rent',
      'SCHEDULED: <2026-04-01 Wed +1m>',
      '> [!repeats]- Repeats: 2 (latest 50)',
      '> - #2 · closed 2026-03-01 Sun 09:12 · due 2026-03-01 Sun',
      '> - #1 · closed 2026-02-01 Sat 08:40 · due 2026-02-01 Sat',
    ].join('\n');

    const tasks = parser.parseFile(content, 'test.md');

    expect(tasks).toHaveLength(1);
    expect(tasks[0].repeatCount).toBe(2);
    expect(tasks[0].scheduledDate).toBeTruthy();
  });

  it('leaves repeatCount null when there is no log', () => {
    const content = '- [ ] TODO Pay rent\n  SCHEDULED: <2026-04-01 Wed +1m>';
    const tasks = parser.parseFile(content, 'test.md');
    expect(tasks[0].repeatCount).toBeNull();
  });

  it('keeps parsing the CLOSED line when a log is present', () => {
    const content = [
      '- [ ] TODO Pay rent',
      '  SCHEDULED: <2026-04-01 Wed +1m>',
      '  CLOSED: [2026-03-01 Sun 09:12]',
      '  > [!repeats]- Repeats: 1 (latest 50)',
      '  > - #1 · closed 2026-03-01 Sun 09:12 · due 2026-03-01 Sun',
    ].join('\n');

    const tasks = parser.parseFile(content, 'test.md');

    expect(tasks[0].repeatCount).toBe(1);
    expect(tasks[0].closedDate).toBeTruthy();
  });
});
