/**
 * Converts Obsidian Tasks plugin lines into TODOseq syntax.
 *
 * This module is intentionally pure and free of Obsidian runtime imports so the
 * transformation can be unit tested without mocking. The importer service is
 * responsible for scanning the vault and writing the converted files.
 *
 * Supported input fields:
 * - Emoji format: 📅 (due), ⏳ (scheduled), 🛫 (start), ➕ (created),
 *   ✅ (done), ❌ (cancelled), 🔁 (recurrence), ⏫🔼🔽⏬ (priority)
 * - Dataview inline fields: `[due:: …]`, `[scheduled:: …]`, `[start:: …]`,
 *   `[created:: …]`, `[completion:: …]`, `[cancelled:: …]`,
 *   `[recurrence:: …]`, `[priority:: …]`
 * - Checkbox status characters: `[ ]`, `[x]`, `[/]`, `[-]`
 */

import {
  BUILTIN_ACTIVE_KEYWORDS,
  BUILTIN_INACTIVE_KEYWORDS,
  BUILTIN_WAITING_KEYWORDS,
  BUILTIN_COMPLETED_KEYWORDS,
  BUILTIN_ARCHIVED_KEYWORDS,
} from '../../utils/constants';

export type PriorityLevel = 'highest' | 'high' | 'medium' | 'low' | 'lowest';
export type TodoPriority = 'A' | 'B' | 'C' | null;

/** Maps the five Obsidian Tasks priority levels onto TODOseq's three. */
export interface PriorityMapping {
  highest: TodoPriority;
  high: TodoPriority;
  medium: TodoPriority;
  low: TodoPriority;
  lowest: TodoPriority;
}

export interface ObsidianTasksConverterOptions {
  /** Keyword for an open task. */
  defaultState: string;
  /** Keyword for a completed task. */
  completedState: string;
  /** Keyword for an in-progress task. */
  inProgressState: string;
  /** Keyword for a cancelled task. */
  cancelledState: string;
  /** Mapping applied only when an explicit priority was present. */
  priorityMapping: PriorityMapping;
  /** When false, existing priority tokens are preserved but none are added. */
  includePriority: boolean;
  /** Keywords used to detect an already-converted TODOseq task. */
  knownKeywords: readonly string[];
}

export interface LineConversionResult {
  /** Replacement lines. Equals `[input]` when nothing changed. */
  lines: string[];
  changed: boolean;
  warnings: string[];
}

export interface ContentConversionResult {
  content: string;
  changed: boolean;
  changedLineCount: number;
  warnings: string[];
}

const BUILTIN_KEYWORDS: readonly string[] = [
  ...BUILTIN_ACTIVE_KEYWORDS,
  ...BUILTIN_INACTIVE_KEYWORDS,
  ...BUILTIN_WAITING_KEYWORDS,
  ...BUILTIN_COMPLETED_KEYWORDS,
  ...BUILTIN_ARCHIVED_KEYWORDS,
];

export const DEFAULT_PRIORITY_MAPPING: PriorityMapping = {
  highest: 'A',
  high: 'A',
  medium: 'B',
  low: 'C',
  lowest: 'C',
};

export const DEFAULT_CONVERTER_OPTIONS: ObsidianTasksConverterOptions = {
  defaultState: 'TODO',
  completedState: 'DONE',
  inProgressState: 'DOING',
  cancelledState: 'CANCELED',
  priorityMapping: DEFAULT_PRIORITY_MAPPING,
  includePriority: true,
  knownKeywords: BUILTIN_KEYWORDS,
};

const CHECKBOX_LINE_RE = /^(\s*)([-*+]|\d+[.)])\s+\[(.)\]\s*(.*)$/;
const DATE_LINE_RE = /^(\s*)(SCHEDULED|DEADLINE|CLOSED|STARTED|CREATED):/;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const PRIORITY_TOKENS: ReadonlyArray<readonly [string, PriorityLevel]> = [
  ['⏫', 'highest'],
  ['🔼', 'high'],
  ['🔽', 'low'],
  ['⏬', 'lowest'],
];

const EMOJI_DATE_FIELDS: ReadonlyArray<
  readonly [
    'scheduled' | 'due' | 'start' | 'created' | 'completion' | 'cancelled',
    string,
  ]
> = [
  ['due', '📅'],
  ['scheduled', '⏳'],
  ['start', '🛫'],
  ['created', '➕'],
  ['completion', '✅'],
  ['cancelled', '❌'],
];

const RECURRENCE_PHRASE_SOURCE =
  'every\\s+(?:weekday|' +
  '(?:(?:\\d+\\s+)?(?:days?|weeks?|months?|years?))|' +
  '(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))' +
  '(?:\\s+when done)?';
const RECURRENCE_EMOJI_RE = new RegExp(
  `🔁\\s*(${RECURRENCE_PHRASE_SOURCE})`,
  'i',
);

const DATAVIEW_FIELD_RE =
  /\[(due|scheduled|start|created|completion|cancelled|canceled|recurrence|priority)::\s*([^\]]*?)\s*\]/gi;

interface ExtractedMetadata {
  text: string;
  scheduled: string | null;
  due: string | null;
  start: string | null;
  created: string | null;
  completion: string | null;
  cancelled: string | null;
  recurrence: string | null;
  priority: PriorityLevel | null;
  warnings: string[];
}

interface ParsedRecurrence {
  raw: string | null;
  warning: string | null;
}

/** Format a `YYYY-MM-DD` value as `YYYY-MM-DD Ddd`, or null when invalid. */
export function formatObsidianDate(iso: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return `${match[1]}-${match[2]}-${match[3]} ${WEEKDAYS[date.getDay()]}`;
}

/**
 * Translate an Obsidian Tasks recurrence phrase into an org repeater cookie.
 * Returns a warning instead of a cookie when the phrase is unsupported.
 */
export function parseObsidianRecurrence(text: string): ParsedRecurrence {
  const normalized = text.trim().toLowerCase();
  if (/^every\s+weekday$/.test(normalized)) {
    return {
      raw: null,
      warning: `unsupported recurrence "${text.trim()}" (every weekday)`,
    };
  }
  const interval =
    /^every\s+(?:(\d+)\s+)?(days?|weeks?|months?|years?)(?:\s+(when done))?$/.exec(
      normalized,
    );
  if (interval) {
    const count = interval[1] ? Number(interval[1]) : 1;
    const unitWord = interval[2];
    const unit: 'd' | 'w' | 'm' | 'y' = unitWord.startsWith('day')
      ? 'd'
      : unitWord.startsWith('week')
        ? 'w'
        : unitWord.startsWith('month')
          ? 'm'
          : 'y';
    const type = interval[3] ? '.+' : '+';
    return { raw: `${type}${count}${unit}`, warning: null };
  }
  const weekday =
    /^every\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:\s+(when done))?$/.exec(
      normalized,
    );
  if (weekday) {
    const type = weekday[2] ? '.+' : '+';
    return {
      raw: `${type}1w`,
      warning: `recurrence "${text.trim()}" mapped to ${type}1w (weekday anchor not represented)`,
    };
  }
  return { raw: null, warning: `unsupported recurrence "${text.trim()}"` };
}

function isPriorityLevel(value: string): value is PriorityLevel {
  return (
    value === 'highest' ||
    value === 'high' ||
    value === 'medium' ||
    value === 'low' ||
    value === 'lowest'
  );
}

function extractEmojiDate(
  text: string,
  token: string,
): { value: string | null; text: string } {
  const match = new RegExp(`${token}\\s*(\\d{4}-\\d{2}-\\d{2})`).exec(text);
  if (!match) return { value: null, text };
  return { value: match[1], text: text.replace(match[0], ' ') };
}

function extractMetadata(
  rawText: string,
  options: ObsidianTasksConverterOptions,
): ExtractedMetadata {
  const warnings: string[] = [];
  let text = rawText;
  let scheduled: string | null = null;
  let due: string | null = null;
  let start: string | null = null;
  let created: string | null = null;
  let completion: string | null = null;
  let cancelled: string | null = null;
  let recurrence: string | null = null;
  let priority: PriorityLevel | null = null;

  for (const [token, level] of PRIORITY_TOKENS) {
    if (text.includes(token)) {
      if (priority === null) priority = level;
      text = text.split(token).join(' ');
    }
  }

  for (const [key, token] of EMOJI_DATE_FIELDS) {
    const extracted = extractEmojiDate(text, token);
    text = extracted.text;
    if (extracted.value === null) continue;
    if (key === 'scheduled') scheduled = extracted.value;
    else if (key === 'due') due = extracted.value;
    else if (key === 'start') start = extracted.value;
    else if (key === 'created') created = extracted.value;
    else if (key === 'completion') completion = extracted.value;
    else if (key === 'cancelled') cancelled = extracted.value;
  }

  const recurrenceEmoji = RECURRENCE_EMOJI_RE.exec(text);
  if (recurrenceEmoji) {
    recurrence = recurrenceEmoji[1];
    text = text.replace(recurrenceEmoji[0], ' ');
  }

  text = text.replace(
    DATAVIEW_FIELD_RE,
    (_match: string, rawKey: string, rawValue: string): string => {
      const key = rawKey.toLowerCase();
      const value = rawValue.trim();
      if (value === '') return ' ';
      if (key === 'priority') {
        const level = value.toLowerCase();
        if (isPriorityLevel(level) && priority === null) priority = level;
      } else if (key === 'recurrence') {
        if (recurrence === null) recurrence = value;
      } else if (key === 'cancelled' || key === 'canceled') {
        if (cancelled === null) cancelled = value;
      } else if (key === 'completion') {
        if (completion === null) completion = value;
      } else if (key === 'scheduled') {
        if (scheduled === null) scheduled = value;
      } else if (key === 'due') {
        if (due === null) due = value;
      } else if (key === 'start') {
        if (start === null) start = value;
      } else if (key === 'created') {
        if (created === null) created = value;
      }
      return ' ';
    },
  );

  return {
    text: text.replace(/\s+/g, ' ').trim(),
    scheduled,
    due,
    start,
    created,
    completion,
    cancelled,
    recurrence,
    priority,
    warnings,
  };
}

function deriveStatus(
  checkboxChar: string,
  metadata: ExtractedMetadata,
  options: ObsidianTasksConverterOptions,
  warnings: string[],
): { state: string; checkboxChar: string } {
  if (metadata.cancelled !== null || checkboxChar === '-') {
    return { state: options.cancelledState, checkboxChar: '-' };
  }
  if (
    metadata.completion !== null ||
    checkboxChar === 'x' ||
    checkboxChar === 'X'
  ) {
    return { state: options.completedState, checkboxChar: 'x' };
  }
  if (checkboxChar === '/') {
    return { state: options.inProgressState, checkboxChar: '/' };
  }
  if (checkboxChar !== ' ') {
    warnings.push(
      `unknown checkbox status "[${checkboxChar}]" treated as open`,
    );
  }
  return { state: options.defaultState, checkboxChar: ' ' };
}

function buildDateLines(
  metadata: ExtractedMetadata,
  dateIndent: string,
  warnings: string[],
): string[] {
  const lines: string[] = [];

  let scheduled = metadata.scheduled;
  const { start } = metadata;
  if (start !== null) {
    if (scheduled === null) {
      scheduled = start;
    } else {
      warnings.push(
        'start date dropped because a scheduled date already exists',
      );
    }
  }

  let recurrenceRaw: string | null = null;
  if (metadata.recurrence !== null) {
    const parsed = parseObsidianRecurrence(metadata.recurrence);
    if (parsed.warning) warnings.push(parsed.warning);
    recurrenceRaw = parsed.raw;
  }
  if (recurrenceRaw !== null && metadata.due === null && scheduled === null) {
    warnings.push(
      `recurrence "${metadata.recurrence ?? ''}" skipped: no scheduled or deadline date`,
    );
    recurrenceRaw = null;
  }

  const pushDate = (
    kind: 'CREATED' | 'SCHEDULED' | 'DEADLINE' | 'CLOSED',
    iso: string,
    repeat: string | null,
  ): void => {
    const formatted = formatObsidianDate(iso);
    if (formatted === null) {
      warnings.push(`invalid ${kind.toLowerCase()} date "${iso}"`);
      return;
    }
    if (kind === 'SCHEDULED' || kind === 'DEADLINE') {
      const repeater = repeat ? ` ${repeat}` : '';
      lines.push(`${dateIndent}${kind}: <${formatted}${repeater}>`);
    } else {
      lines.push(`${dateIndent}${kind}: [${formatted}]`);
    }
  };

  if (metadata.created !== null) pushDate('CREATED', metadata.created, null);
  if (scheduled !== null) pushDate('SCHEDULED', scheduled, recurrenceRaw);
  if (metadata.due !== null) {
    pushDate('DEADLINE', metadata.due, recurrenceRaw);
  }
  const closed = metadata.completion ?? metadata.cancelled;
  if (closed !== null) pushDate('CLOSED', closed, null);

  return lines;
}

/**
 * Convert a single line. Non-task lines and already-converted TODOseq tasks
 * (without Obsidian Tasks metadata) are returned unchanged.
 */
export function convertObsidianTasksLine(
  line: string,
  options: ObsidianTasksConverterOptions = DEFAULT_CONVERTER_OPTIONS,
): LineConversionResult {
  const match = CHECKBOX_LINE_RE.exec(line);
  if (!match) {
    return { lines: [line], changed: false, warnings: [] };
  }

  const [, indent, marker, checkboxChar, rest] = match;
  const metadata = extractMetadata(rest, options);
  const warnings = [...metadata.warnings];

  let body = metadata.text;
  const firstToken = body.split(/\s+/)[0] ?? '';
  let state: string | null = null;
  if (firstToken !== '' && options.knownKeywords.includes(firstToken)) {
    state = firstToken;
    body = body.slice(firstToken.length).trim();
  }

  const derived = deriveStatus(checkboxChar, metadata, options, warnings);
  if (state === null) state = derived.state;

  const mappedPriority = metadata.priority
    ? options.priorityMapping[metadata.priority]
    : null;
  const alreadyHasPriorityToken = /\[#[A-Z]\]/.test(body);
  const priorityToken =
    options.includePriority &&
    mappedPriority !== null &&
    !alreadyHasPriorityToken
      ? ` [#${mappedPriority}]`
      : '';
  if (
    options.includePriority &&
    mappedPriority !== null &&
    alreadyHasPriorityToken
  ) {
    warnings.push('priority token already present; left unchanged');
  }

  const checkbox = derived.checkboxChar;
  const textPart = body !== '' ? ` ${body}` : '';
  const taskLine = `${indent}${marker} [${checkbox}] ${state}${priorityToken}${textPart}`;

  const dateIndent = `${indent}  `;
  const dateLines = buildDateLines(metadata, dateIndent, warnings);

  const lines = [taskLine, ...dateLines];
  const changed = lines.length !== 1 || lines[0] !== line;
  return { lines, changed, warnings };
}

function isMetadataLine(line: string): boolean {
  const trimmed = line.trimStart();
  return (
    trimmed.startsWith('DESCRIPTION:') ||
    trimmed.startsWith('[!repeats]') ||
    DATE_LINE_RE.test(trimmed)
  );
}

/**
 * Convert all Obsidian Tasks lines in a document. Existing date lines directly
 * after a task are detected so repeated runs do not duplicate metadata.
 */
export function convertObsidianTasksContent(
  content: string,
  options: ObsidianTasksConverterOptions = DEFAULT_CONVERTER_OPTIONS,
): ContentConversionResult {
  const lines = content.split('\n');
  const output: string[] = [];
  const warnings: string[] = [];
  let changedLineCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const result = convertObsidianTasksLine(line, options);
    if (!result.changed) {
      output.push(line);
      continue;
    }

    changedLineCount++;
    result.warnings.forEach((warning) =>
      warnings.push(`Line ${i + 1}: ${warning}`),
    );

    const [taskLine, ...newDateLines] = result.lines;
    const existingKinds = new Set<string>();
    for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
      const kind = DATE_LINE_RE.exec(lines[j].trimStart());
      if (kind) {
        existingKinds.add(kind[2]);
        continue;
      }
      if (lines[j].trim() !== '' && !isMetadataLine(lines[j])) break;
    }
    const dedupedDateLines = newDateLines.filter((newLine) => {
      const kind = DATE_LINE_RE.exec(newLine.trimStart());
      return kind === null || !existingKinds.has(kind[2]);
    });

    output.push(taskLine, ...dedupedDateLines);
  }

  return {
    content: output.join('\n'),
    changed: changedLineCount > 0,
    changedLineCount,
    warnings,
  };
}
