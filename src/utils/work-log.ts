/**
 * Helpers for per-task work logging stored in a collapsed Obsidian callout:
 *
 * ```markdown
 * - [ ] DOING Fix the export bug
 *       TIMER: [2026-09-14 Mon 10:02]
 *   > [!work]- Total: 3h 15m (latest 50)
 *   >
 *   > - 45m · 2026-09-14 09:00–09:45
 *   > - 1h 30m · 2026-09-13 14:10–15:40
 * ```
 *
 * The callout title stores the running total so the frame can show it without
 * reading every entry; entries are start–stop pairs written on pause.
 */

/** Matches a `[!work]` callout title line (optionally quoted/indented). */
export const WORK_LOG_CALLOUT_RE = /^\s*(?:>\s*)*\[!work\][+-]?\s*(.*)$/i;

/** Matches the `Total: <duration>` value inside a callout title. */
export const WORK_LOG_TOTAL_RE = /Total:\s*((?:\d+\s*h)?\s*(?:\d+\s*m)?)/i;

/** Matches a `> - <duration> …` log entry line (optionally quoted/indented). */
export const WORK_LOG_ENTRY_RE =
  /^\s*(?:>\s*)*-\s*(?:\d+\s*h(?:\s*\d+\s*m)?|\d+\s*m)(?=\s|\u00b7|$)/i;

const EN_DASH = '\u2013';
const MIDDLE_DOT = '\u00b7';

/** A parsed work-log entry. Times are local and optional (hand-typed). */
export interface WorkLogEntry {
  minutes: number;
  start: Date | null;
  end: Date | null;
}

/** Format a minute count as `3h 15m`, `2h` or `45m`. */
export function formatDuration(minutes: number): string {
  const safe =
    Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : 0;
  const hours = Math.floor(safe / 60);
  const mins = safe % 60;
  if (hours === 0) {
    return `${mins}m`;
  }
  return mins === 0 ? `${hours}h` : `${hours}h ${mins}m`;
}

/** Parse `3h 15m` / `2h` / `45m` text to minutes; null when unparseable. */
export function parseDuration(text: string): number | null {
  const match = text.trim().match(/^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?$/i);
  if (!match || (!match[1] && !match[2])) {
    return null;
  }
  const hours = match[1] ? parseInt(match[1], 10) : 0;
  const mins = match[2] ? parseInt(match[2], 10) : 0;
  return hours * 60 + mins;
}

/** Parse the running total from a `[!work]` callout title. */
export function parseWorkLogTotal(line: string): number | null {
  if (!WORK_LOG_CALLOUT_RE.test(line)) {
    return null;
  }
  const match = line.match(WORK_LOG_TOTAL_RE);
  if (!match) {
    return null;
  }
  return parseDuration(match[1]);
}

/** True for the callout title or one of its entry lines. */
export function isWorkLogLine(line: string): boolean {
  return WORK_LOG_CALLOUT_RE.test(line) || WORK_LOG_ENTRY_RE.test(line);
}

/** Parse a work-log entry line, tolerating a missing start–stop pair. */
export function parseWorkLogEntry(line: string): WorkLogEntry | null {
  const body = line.replace(/^\s*(?:>\s*)*-\s*/, '').trim();
  const sep = body.indexOf(MIDDLE_DOT);
  const minutes = parseDuration(sep === -1 ? body : body.slice(0, sep));
  if (minutes === null) {
    return null;
  }
  if (sep === -1) {
    return { minutes, start: null, end: null };
  }

  const times = body.slice(sep + 1).trim();
  const match = times.match(
    /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})\s*[-\u2013]\s*(\d{2}):(\d{2})$/,
  );
  if (!match) {
    return { minutes, start: null, end: null };
  }

  const start = new Date(
    +match[1],
    +match[2] - 1,
    +match[3],
    +match[4],
    +match[5],
  );
  const end = new Date(
    +match[1],
    +match[2] - 1,
    +match[3],
    +match[6],
    +match[7],
  );
  return { minutes, start, end };
}

/** Build the collapsed callout title line for a running total. */
export function buildWorkLogTitle(
  totalMinutes: number,
  indent: string,
): string {
  return `${indent}> [!work]- Total: ${formatDuration(totalMinutes)}`;
}

/** Build a single start–stop entry line. */
export function buildWorkLogEntry(
  minutes: number,
  start: Date,
  end: Date,
  indent: string,
): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const date = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(
    start.getDate(),
  )}`;
  const clock = (value: Date) =>
    `${pad(value.getHours())}:${pad(value.getMinutes())}`;
  return `${indent}> - ${formatDuration(minutes)} ${MIDDLE_DOT} ${date} ${clock(
    start,
  )}${EN_DASH}${clock(end)}`;
}
