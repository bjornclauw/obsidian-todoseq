import { isTaskMetadataLine } from './task-metadata';

/**
 * Plan where a CREATED date line should be inserted for a task.
 *
 * CREATED is written once and sits first among the task's date lines, directly
 * below the task (or below its DESCRIPTION when present). Returns `null` when
 * the task's metadata block already contains a CREATED line, so callers can
 * treat the operation as idempotent.
 *
 * @param getLine Accessor for a 1-based line number, returning `undefined`
 *   when the line is out of range.
 * @param lineCount Total number of lines in the document.
 * @param taskLineNumber 1-based line number of the task line.
 */
export function planCreatedDateInsertion(
  getLine: (lineNumber: number) => string | undefined,
  lineCount: number,
  taskLineNumber: number,
): { insertAtLine: number } | null {
  let insertAtLine = taskLineNumber + 1;
  let sawFirstMetadataLine = false;

  const maxLine = Math.min(taskLineNumber + 12, lineCount);
  for (let i = taskLineNumber + 1; i <= maxLine; i++) {
    const raw = getLine(i);
    if (raw === undefined) break;

    const trimmed = raw.trim();
    if (trimmed === '') continue;

    // Ignore Markdown quote prefixes ("> ", "> > ") when matching keywords.
    const content = trimmed.replace(/^(>\s*)+/, '').trimStart();

    if (content.startsWith('CREATED:')) {
      // Already has one — nothing to do.
      return null;
    }

    // Stop at the end of the task's contiguous metadata block.
    if (!isTaskMetadataLine(raw)) break;

    if (!sawFirstMetadataLine) {
      sawFirstMetadataLine = true;
      // CREATED goes after DESCRIPTION when DESCRIPTION is the first metadata
      // line (the writer's ordering), otherwise immediately after the task.
      if (content.startsWith('DESCRIPTION:')) {
        insertAtLine = i + 1;
      }
    }
  }

  return { insertAtLine };
}
