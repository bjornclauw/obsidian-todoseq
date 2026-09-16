import {
  WORK_LOG_ENTRY_RE,
  buildWorkLogEntry,
  buildWorkLogTitle,
  formatDuration,
  isWorkLogLine,
  parseDuration,
  parseWorkLogEntry,
  parseWorkLogTotal,
} from '../src/utils/work-log';

describe('work-log utils', () => {
  describe('parseWorkLogTotal', () => {
    it('reads the running total from a callout title', () => {
      expect(parseWorkLogTotal('  > [!work]- Total: 3h 15m (latest 50)')).toBe(
        195,
      );
    });

    it('handles quoted callouts, minutes-only and a missing suffix', () => {
      expect(parseWorkLogTotal('> > [!work]- Total: 45m')).toBe(45);
      expect(parseWorkLogTotal('> [!work]- Total: 2h')).toBe(120);
    });

    it('returns null for entry lines and unrelated lines', () => {
      expect(parseWorkLogTotal('> - 45m · 2026-09-14 09:00–09:45')).toBeNull();
      expect(parseWorkLogTotal('  SCHEDULED: <2026-09-14 Mon>')).toBeNull();
      expect(parseWorkLogTotal('> [!note]- Total: 3h')).toBeNull();
    });
  });

  describe('isWorkLogLine', () => {
    it('recognises the title and entry lines', () => {
      expect(isWorkLogLine('> [!work]- Total: 45m (latest 50)')).toBe(true);
      expect(isWorkLogLine('  > - 45m · 2026-09-14 09:00–09:45')).toBe(true);
    });

    it('rejects ordinary lines and repeat-log entries', () => {
      expect(isWorkLogLine('> [!note]- something')).toBe(false);
      expect(isWorkLogLine('> - #2 · closed 2026-03-01 Sun 09:12')).toBe(false);
      expect(WORK_LOG_ENTRY_RE.test('- plain list item')).toBe(false);
    });
  });

  describe('parseWorkLogEntry', () => {
    it('parses a start–stop pair', () => {
      const entry = parseWorkLogEntry('  > - 1h 30m · 2026-09-13 14:10–15:40');
      expect(entry?.minutes).toBe(90);
      expect(entry?.start).toEqual(new Date(2026, 8, 13, 14, 10));
      expect(entry?.end).toEqual(new Date(2026, 8, 13, 15, 40));
    });

    it('parses a hand-typed duration without times', () => {
      const entry = parseWorkLogEntry('> - 45m');
      expect(entry?.minutes).toBe(45);
      expect(entry?.start).toBeNull();
      expect(entry?.end).toBeNull();
    });

    it('accepts a plain hyphen between the times', () => {
      const entry = parseWorkLogEntry('> - 30m · 2026-09-14 09:00-09:30');
      expect(entry?.start).toEqual(new Date(2026, 8, 14, 9, 0));
      expect(entry?.end).toEqual(new Date(2026, 8, 14, 9, 30));
    });

    it('returns null for repeat-log entries and non-entries', () => {
      expect(
        parseWorkLogEntry('> - #2 · closed 2026-03-01 Sun 09:12'),
      ).toBeNull();
      expect(parseWorkLogEntry('> [!work]- Total: 3h')).toBeNull();
    });
  });

  describe('duration helpers', () => {
    it('formats minutes as h/m text', () => {
      expect(formatDuration(195)).toBe('3h 15m');
      expect(formatDuration(120)).toBe('2h');
      expect(formatDuration(45)).toBe('45m');
      expect(formatDuration(0)).toBe('0m');
    });

    it('parses h/m text back to minutes', () => {
      expect(parseDuration('3h 15m')).toBe(195);
      expect(parseDuration('2h')).toBe(120);
      expect(parseDuration('45m')).toBe(45);
      expect(parseDuration('')).toBeNull();
      expect(parseDuration('soon')).toBeNull();
    });
  });

  describe('builders', () => {
    it('builds a collapsed title with the running total', () => {
      expect(buildWorkLogTitle(195, '  ')).toBe('  > [!work]- Total: 3h 15m');
    });

    it('builds a start–stop entry', () => {
      const start = new Date(2026, 8, 13, 14, 10);
      const end = new Date(2026, 8, 13, 15, 40);
      expect(buildWorkLogEntry(90, start, end, '  ')).toBe(
        '  > - 1h 30m · 2026-09-13 14:10–15:40',
      );
    });
  });
});
