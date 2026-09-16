import { TaskParser } from '../src/parser/task-parser';
import { createTestKeywordManager } from './helpers/test-helper';

describe('TaskParser - work log', () => {
  const keywordManager = createTestKeywordManager();
  const parser = TaskParser.create(keywordManager, null);

  it('reads the TIMER line and the [!work] running total', () => {
    const content = [
      '- [ ] DOING Fix the export bug',
      '  SCHEDULED: <2026-09-14 Mon>',
      '  TIMER: [2026-09-14 Mon 10:02]',
      '  > [!work]- Total: 3h 15m (latest 50)',
      '  >',
      '  > - 45m · 2026-09-14 09:00–09:45',
      '  > - 1h 30m · 2026-09-13 14:10–15:40',
    ].join('\n');

    const tasks = parser.parseFile(content, 'test.md');

    expect(tasks).toHaveLength(1);
    expect(tasks[0].timerStart).toEqual(new Date(2026, 8, 14, 10, 2));
    expect(tasks[0].workLogTotalMinutes).toBe(195);
    // The date line before TIMER still parses and the log stays out of text.
    expect(tasks[0].scheduledDate).toBeTruthy();
    expect(tasks[0].text).toBe('Fix the export bug');
  });

  it('reads the total for heading tasks', () => {
    const content = [
      '### DOING Fix the export bug',
      'TIMER: [2026-09-14 Mon 10:02]',
      '> [!work]- Total: 45m (latest 50)',
      '> - 45m · 2026-09-14 09:00–09:45',
    ].join('\n');

    const tasks = parser.parseFile(content, 'test.md');

    expect(tasks).toHaveLength(1);
    expect(tasks[0].timerStart).toEqual(new Date(2026, 8, 14, 10, 2));
    expect(tasks[0].workLogTotalMinutes).toBe(45);
  });

  it('leaves the fields empty when there is no work log', () => {
    const content = '- [ ] TODO Pay rent\n  SCHEDULED: <2026-04-01 Wed>';
    const tasks = parser.parseFile(content, 'test.md');
    expect(tasks[0].timerStart).toBeNull();
    expect(tasks[0].workLogTotalMinutes).toBeNull();
  });

  it('parses dates that follow the TIMER line', () => {
    const content = [
      '- [ ] DOING Fix the export bug',
      '  TIMER: [2026-09-14 Mon 10:02]',
      '  DEADLINE: <2026-09-16 Wed>',
    ].join('\n');

    const tasks = parser.parseFile(content, 'test.md');

    expect(tasks[0].timerStart).toEqual(new Date(2026, 8, 14, 10, 2));
    expect(tasks[0].deadlineDate).toBeTruthy();
  });
});
