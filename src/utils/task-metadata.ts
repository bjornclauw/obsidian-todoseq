import { isRepeatLogLine } from './repeat-log';

/**
 * Matches a task's own metadata keyword line, tolerating leading whitespace and
 * Markdown quote prefixes.
 *
 * This is the single source of truth for "is this line part of a task's
 * contiguous metadata block". The `[!repeats]` completion log is also part of
 * that block and is handled by {@link isTaskMetadataLine} via
 * {@link isRepeatLogLine}.
 */
export const TASK_METADATA_LINE_RE =
  /^\s*(?:>\s*)*(?:SCHEDULED|DEADLINE|CLOSED|STARTED|DESCRIPTION):/i;

/**
 * True for a line that belongs to a task's contiguous metadata block:
 * DESCRIPTION/SCHEDULED/DEADLINE/CLOSED/STARTED lines or the `[!repeats]`
 * completion log (title and entry lines). Quote prefixes are ignored.
 */
export function isTaskMetadataLine(line: string): boolean {
  return TASK_METADATA_LINE_RE.test(line) || isRepeatLogLine(line);
}
