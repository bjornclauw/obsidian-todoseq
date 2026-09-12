import {
  REPEAT_LOG_ENTRY_RE,
  buildRepeatLogEntry,
  buildRepeatLogTitle,
  isRepeatLogLine,
  parseRepeatLogTotal,
} from '../src/utils/repeat-log';

describe('repeat-log utils', () => {
  describe('parseRepeatLogTotal', () => {
    it('reads the running total from a callout title', () => {
      expect(
        parseRepeatLogTotal('  > [!repeats]- Repeats: 412 (latest 50)'),
      ).toBe(412);
    });

    it('handles quoted callouts and a missing (latest n) suffix', () => {
      expect(parseRepeatLogTotal('> > [!repeats]- Repeats: 7')).toBe(7);
    });

    it('returns null for entry lines and unrelated lines', () => {
      expect(
        parseRepeatLogTotal('> - #7 · closed 2026-03-01 Sun 09:12'),
      ).toBeNull();
      expect(parseRepeatLogTotal('  SCHEDULED: <2026-03-01 Sun>')).toBeNull();
      expect(parseRepeatLogTotal('> [!note]- Repeats: 3')).toBeNull();
    });
  });

  describe('isRepeatLogLine', () => {
    it('recognises the title and entry lines', () => {
      expect(isRepeatLogLine('> [!repeats]- Repeats: 1 (latest 50)')).toBe(
        true,
      );
      expect(isRepeatLogLine('  > - #1 · closed 2026-03-01 Sun 09:12')).toBe(
        true,
      );
    });

    it('rejects ordinary lines', () => {
      expect(isRepeatLogLine('> [!note]- something')).toBe(false);
      expect(REPEAT_LOG_ENTRY_RE.test('- plain list item')).toBe(false);
    });
  });

  describe('builders', () => {
    it('builds a collapsed title with total and limit', () => {
      expect(buildRepeatLogTitle(3, 50, '  ')).toBe(
        '  > [!repeats]- Repeats: 3 (latest 50)',
      );
    });

    it('builds an entry with closed time and occurrence date', () => {
      const closed = new Date(2026, 2, 1, 9, 12);
      const due = new Date(2026, 1, 1);
      const entry = buildRepeatLogEntry(4, closed, due, '  ');
      expect(entry).toBe(
        '  > - #4 · closed 2026-03-01 Sun 09:12 · due 2026-02-01 Sun',
      );
    });

    it('omits the due part when there is no occurrence date', () => {
      const closed = new Date(2026, 2, 1, 9, 12);
      expect(buildRepeatLogEntry(1, closed, null, '')).toBe(
        '> - #1 · closed 2026-03-01 Sun 09:12',
      );
    });
  });
});
