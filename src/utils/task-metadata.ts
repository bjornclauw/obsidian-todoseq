import { isRepeatLogLine } from './repeat-log';
import { isWorkLogLine } from './work-log';

/**
 * Matches a task's own metadata keyword line, tolerating leading whitespace and
 * Markdown quote prefixes.
 *
 * This is the single source of truth for "is this line part of a task's
 * contiguous metadata block". The `[!repeats]` and `[!work]` logs are also part
 * of that block and are handled by {@link isTaskMetadataLine}.
 */
export const TASK_METADATA_LINE_RE =
  /^\s*(?:>\s*)*(?:SCHEDULED|DEADLINE|CLOSED|STARTED|CREATED|TIMER|DESCRIPTION|PHOTO):/i;

/**
 * True for a line that belongs to a task's contiguous metadata block:
 * DESCRIPTION/SCHEDULED/DEADLINE/CLOSED/STARTED/CREATED/TIMER lines or the
 * `[!repeats]` / `[!work]` logs (title and entry lines). Quote prefixes are
 * ignored.
 */
export function isTaskMetadataLine(line: string): boolean {
  return (
    TASK_METADATA_LINE_RE.test(line) ||
    isRepeatLogLine(line) ||
    isWorkLogLine(line)
  );
}
