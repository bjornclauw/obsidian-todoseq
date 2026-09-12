import { moment } from 'obsidian';

/**
 * Central source of truth for the locale used when formatting dates/times for
 * display in the UI (never for the canonical date text written into notes).
 *
 * Resolution order:
 *  1. An explicit override (used by tests and any future setting).
 *  2. Obsidian's `moment.locale()` — the application language.
 *  3. English (`en`).
 *
 * Note: note text keeps the canonical org-mode format (`YYYY-MM-DD Ddd` with
 * English day-of-week abbreviations) because it is a machine-readable
 * interchange format; only UI presentation is localized here.
 */
let localeOverride: string | null = null;

const relativeTimeFormatters = new Map<string, Intl.RelativeTimeFormat>();

export class LocaleUtils {
  /** Override the locale (e.g. from tests). Pass null to clear. */
  static setLocale(locale: string | null): void {
    localeOverride = locale;
  }

  /** The active locale, e.g. `en`, `nl`, `de`, `zh-cn`. */
  static getLocale(): string {
    if (localeOverride) {
      return localeOverride;
    }
    const obsidianMoment = moment as unknown as
      { locale?: () => string } | undefined;
    const detected = obsidianMoment?.locale?.();
    return detected || 'en';
  }

  /**
   * Format a calendar date for display with locale-aware month/day order.
   * Wrapper so callers use one code path and tests can pin the locale.
   */
  static formatDate(date: Date, options: Intl.DateTimeFormatOptions): string {
    return date.toLocaleDateString(this.getLocale(), options);
  }

  /** Format a time for display, keeping the locale's 12/24h convention. */
  static formatTime(date: Date, options: Intl.DateTimeFormatOptions): string {
    return date.toLocaleTimeString(this.getLocale(), options);
  }

  /**
   * Localized "today"/"tomorrow"/"yesterday"/"in N days"/"N days ago" phrase,
   * with the first letter capitalized to match the plugin's label style.
   */
  static formatRelativeDays(diffDays: number): string {
    const locale = this.getLocale();
    try {
      let formatter = relativeTimeFormatters.get(locale);
      if (!formatter) {
        formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
        relativeTimeFormatters.set(locale, formatter);
      }
      return this.capitalizeFirst(formatter.format(diffDays, 'day'));
    } catch {
      // Environments without Intl.RelativeTimeFormat fall back to English.
      const days = Math.abs(diffDays);
      if (diffDays === 0) return 'Today';
      if (diffDays === 1) return 'Tomorrow';
      if (diffDays === -1) return 'Yesterday';
      return diffDays > 0 ? `${days} days from now` : `${days} days ago`;
    }
  }

  /**
   * Localized short weekday labels ordered by the configured week start.
   * `2024-01-07` is a Sunday, used as the anchor for the names.
   */
  static getWeekdayLabels(weekStartsOn: 'Monday' | 'Sunday'): string[] {
    const startDay = weekStartsOn === 'Monday' ? 1 : 0;
    const labels: string[] = [];
    for (let i = 0; i < 7; i++) {
      const dayIndex = (startDay + i) % 7;
      const date = new Date(2024, 0, 7 + dayIndex);
      labels.push(this.formatDate(date, { weekday: 'short' }));
    }
    return labels;
  }

  private static capitalizeFirst(value: string): string {
    return value.length > 0 ? value[0].toUpperCase() + value.slice(1) : value;
  }
}
