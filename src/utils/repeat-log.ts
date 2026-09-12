/**
 * Helpers for the recurring-completion log written as a collapsed Obsidian
 * callout:
 *
 * ```markdown
 * - [ ] Pay rent
 *   SCHEDULED: <2026-04-01 Wed +1m>
 *   > [!repeats]- Repeats: 2 (latest 50)
 *   > - #2 · closed 2026-03-01 Sun 09:12 · due 2026-03-01 Sun
 *   > - #1 · closed 2026-02-01 Sat 08:40 · due 2026-02-01 Sat
 * ```
 *
 * The callout title stores the running total so iteration numbers stay correct
 * even after older entries are dropped.
 */
import { DateUtils } from './date-utils';

/** Matches a `[!repeats]` callout title line (optionally quoted/indented). */
export const REPEAT_LOG_CALLOUT_RE = /^\s*(?:>\s*)*\[!repeats\][+-]?\s*(.*)$/i;

/** Matches the `Repeats: <n>` total inside a callout title. */
export const REPEAT_LOG_TOTAL_RE = /Repeats:\s*(\d+)/i;

/** Matches a `> - #<n> …` log entry line (optionally quoted/indented). */
export const REPEAT_LOG_ENTRY_RE = /^\s*(?:>\s*)*-\s*#\d+(?=\s|$|\u00b7)/;

/** Parse the running total from a `[!repeats]` callout title. */
export function parseRepeatLogTotal(line: string): number | null {
  if (!REPEAT_LOG_CALLOUT_RE.test(line)) {
    return null;
  }
  const match = line.match(REPEAT_LOG_TOTAL_RE);
  if (!match) {
    return null;
  }
  const total = parseInt(match[1], 10);
  return Number.isFinite(total) ? total : null;
}

/** True for the callout title or one of its entry lines. */
export function isRepeatLogLine(line: string): boolean {
  return REPEAT_LOG_CALLOUT_RE.test(line) || REPEAT_LOG_ENTRY_RE.test(line);
}

/** Leading whitespace of a line (used to align the callout with date lines). */
export function getLineIndent(line: string): string {
  return line.match(/^\s*/)?.[0] ?? '';
}

/** Build the collapsed callout title line for a running total. */
export function buildRepeatLogTitle(
  total: number,
  limit: number,
  indent: string,
): string {
  return `${indent}> [!repeats]- Repeats: ${total} (latest ${limit})`;
}

/** Build a single log entry line. `occurrence` is optional. */
export function buildRepeatLogEntry(
  iteration: number,
  closedAt: Date,
  occurrence: Date | null,
  indent: string,
): string {
  const date = DateUtils.formatDateContent(closedAt);
  const hours = String(closedAt.getHours()).padStart(2, '0');
  const minutes = String(closedAt.getMinutes()).padStart(2, '0');
  const due = occurrence
    ? ` \u00b7 due ${DateUtils.formatDateContent(occurrence)}`
    : '';
  return `${indent}> - #${iteration} \u00b7 closed ${date} ${hours}:${minutes}${due}`;
}
