import { LocaleUtils } from '../src/utils/locale-utils';

describe('LocaleUtils', () => {
  afterEach(() => {
    LocaleUtils.setLocale(null);
  });

  it('defaults to English when Obsidian moment is unavailable', () => {
    expect(LocaleUtils.getLocale()).toBe('en');
  });

  it('honours an explicit locale override', () => {
    LocaleUtils.setLocale('de');
    expect(LocaleUtils.getLocale()).toBe('de');
  });

  describe('formatRelativeDays (en)', () => {
    it('uses localized relative phrases', () => {
      expect(LocaleUtils.formatRelativeDays(0)).toBe('Today');
      expect(LocaleUtils.formatRelativeDays(1)).toBe('Tomorrow');
      expect(LocaleUtils.formatRelativeDays(-1)).toBe('Yesterday');
      expect(LocaleUtils.formatRelativeDays(2)).toBe('In 2 days');
      expect(LocaleUtils.formatRelativeDays(-2)).toBe('2 days ago');
    });
  });

  describe('formatRelativeDays (de)', () => {
    beforeEach(() => {
      LocaleUtils.setLocale('de');
    });

    it('produces German phrases', () => {
      expect(LocaleUtils.formatRelativeDays(0).toLowerCase()).toBe('heute');
      expect(LocaleUtils.formatRelativeDays(3).toLowerCase()).toBe(
        'in 3 tagen',
      );
    });
  });

  describe('getWeekdayLabels', () => {
    it('returns English short labels ordered by week start', () => {
      expect(LocaleUtils.getWeekdayLabels('Monday')).toEqual([
        'Mon',
        'Tue',
        'Wed',
        'Thu',
        'Fri',
        'Sat',
        'Sun',
      ]);
      expect(LocaleUtils.getWeekdayLabels('Sunday')).toEqual([
        'Sun',
        'Mon',
        'Tue',
        'Wed',
        'Thu',
        'Fri',
        'Sat',
      ]);
    });

    it('localizes weekday labels', () => {
      LocaleUtils.setLocale('de');
      const labels = LocaleUtils.getWeekdayLabels('Monday');
      // German short weekdays start with "Mo"
      expect(labels[0].toLowerCase().startsWith('mo')).toBe(true);
    });
  });

  describe('formatDate', () => {
    it('localizes month names', () => {
      const date = new Date(2026, 4, 10);
      expect(LocaleUtils.formatDate(date, { month: 'short' })).toBe('May');
      LocaleUtils.setLocale('de');
      expect(
        LocaleUtils.formatDate(date, { month: 'short' }).toLowerCase(),
      ).toBe('mai');
    });
  });
});
