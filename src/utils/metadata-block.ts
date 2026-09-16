import { KeywordSettings, KeywordManager } from './keyword-manager';
import { isTaskMetadataLine } from './task-metadata';
import { parseRepeatLogTotal, isRepeatLogLine } from './repeat-log';
import { isWorkLogLine, parseWorkLogTotal } from './work-log';

/** Which virtual frame variant a task's metadata block renders as. */
export type FrameVariant = 'active' | 'completed' | 'recurring-completed';

/** Options for {@link scanMetadataBlock}. */
export interface MetadataBlockScanOptions {
  /** Maximum block length in lines (task line excluded). Defaults to 8. */
  maxGap?: number;
}

/** Result of scanning the metadata block that follows a task line. */
export interface MetadataBlockScan {
  /** First metadata line index (0-based), inclusive. */
  start: number;
  /** Last metadata line index (0-based), inclusive. Blanks inside are spanned. */
  end: number;
  /**
   * First line index (0-based) of the block *range*, which extends the frame
   * up to the task line by absorbing blank lines between the task and its
   * metadata. Use this for the replaced range; use {@link start} for "does
   * this line belong to the metadata".
   */
  rangeStart: number;
  /** Number of metadata lines (blank lines excluded). */
  metadataCount: number;
  /** Index of the `[!repeats]` callout title, when one follows the block. */
  repeatTitleIndex: number | null;
  /** Running completion total parsed from the `[!repeats]` title. */
  repeatTotal: number | null;
  /** Index of the `[!work]` callout title, when one follows the block. */
  workTitleIndex: number | null;
  /** Running work total (minutes) parsed from the `[!work]` title. */
  workTotalMinutes: number | null;
}

export const DEFAULT_METADATA_MAX_GAP = 8;

/** Maximum consecutive blank lines tolerated between metadata lines. */
const MAX_BLANK_GAP = 2;

/**
 * Find the metadata block (DESCRIPTION/CREATED/STARTED/SCHEDULED/DEADLINE/
 * CLOSED) that follows a task line, plus any `[!repeats]` callout that
 * terminates it.
 *
 * The scan stops at the first non-blank line that is not task metadata —
 * which covers subtasks, headings and paragraphs. The `[!repeats]` callout
 * belongs to the block but is excluded from the returned frame range so its
 * native Obsidian folding stays interactive.
 */
export function scanMetadataBlock(
  getLine: (index: number) => string | undefined,
  taskLine: number,
  options: MetadataBlockScanOptions = {},
): MetadataBlockScan | null {
  const maxGap = options.maxGap ?? DEFAULT_METADATA_MAX_GAP;

  let start = -1;
  let end = -1;
  let blanks = 0;
  let leadingBlanks = 0;
  let metadataCount = 0;
  let repeatTitleIndex: number | null = null;
  let repeatTotal: number | null = null;
  let workTitleIndex: number | null = null;
  let workTotalMinutes: number | null = null;

  for (let i = taskLine + 1; i - taskLine - 1 < maxGap; i++) {
    const line = getLine(i);
    if (line === undefined) {
      break;
    }

    if (line.trim() === '') {
      // Blank lines between the task and its metadata are absorbed into the
      // frame range so the frame hugs the task; blanks further inside the
      // block are spanned automatically.
      blanks++;
      if (blanks > MAX_BLANK_GAP) {
        break;
      }
      if (start === -1) {
        leadingBlanks++;
      }
      continue;
    }
    blanks = 0;

    if (isTaskMetadataLine(line)) {
      if (isRepeatLogLine(line)) {
        if (repeatTitleIndex === null) {
          // Only the title is parsed for the total; entries follow it and
          // are covered by the callout's own native folding.
          repeatTitleIndex = i;
          repeatTotal = parseRepeatLogTotal(line);
        }
        break;
      }
      if (isWorkLogLine(line)) {
        const total = parseWorkLogTotal(line);
        if (workTitleIndex === null && total !== null) {
          workTitleIndex = i;
          workTotalMinutes = total;
        }
        break;
      }
      if (start === -1) {
        start = i;
      }
      end = i;
      metadataCount++;
      continue;
    }

    // Any other non-blank line (subtask, paragraph, heading) ends the block.
    break;
  }

  if (start === -1) {
    return null;
  }

  return {
    start,
    end,
    rangeStart: start - leadingBlanks,
    metadataCount,
    repeatTitleIndex,
    repeatTotal,
    workTitleIndex,
    workTotalMinutes,
  };
}

/**
 * Pick the frame variant for a task's metadata block.
 *
 * Completed (and canceled) tasks show the collapsed variant; a completed
 * task with a `[!repeats]` completion log shows the recurring variant that
 * surfaces the next occurrence and the repeat count.
 */
export function resolveFrameVariant(
  keyword: string,
  repeatTotal: number | null,
  settings: KeywordSettings,
): FrameVariant {
  const completed =
    KeywordManager.isCompletedKeyword(keyword, settings) ||
    KeywordManager.isCanceledKeyword(keyword, settings);
  if (completed && repeatTotal !== null) {
    return 'recurring-completed';
  }
  return completed ? 'completed' : 'active';
}
