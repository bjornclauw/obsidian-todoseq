import { Task } from '../types/task';
import { getFilename } from './task-utils';
import { PRIORITY_RANK, SortDirection } from './task-sort';
import { DateUtils } from './date-utils';
import { LocaleUtils } from './locale-utils';
import type { KeywordManager } from './keyword-manager';

/**
 * Fields a task list can be grouped by.
 */
export type GroupByField =
  | 'folder'
  | 'file'
  | 'heading'
  | 'status'
  | 'priority'
  | 'scheduled'
  | 'deadline'
  | 'closed'
  | 'started'
  | 'tag';

/** Choices for a "Group by" dropdown, including the 'none' entry. */
export const GROUP_BY_OPTIONS: readonly {
  value: GroupByField | 'none';
  label: string;
}[] = [
  { value: 'none', label: 'None' },
  { value: 'folder', label: 'Folder' },
  { value: 'file', label: 'File' },
  { value: 'heading', label: 'Heading' },
  { value: 'status', label: 'Status' },
  { value: 'priority', label: 'Priority' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'deadline', label: 'Deadline' },
  { value: 'closed', label: 'Closed' },
  { value: 'started', label: 'Started' },
  { value: 'tag', label: 'Tag' },
];

/**
 * A single rendered group: a stable key, a display label, and its tasks in
 * input order.
 */
export interface TaskGroup {
  /** Stable identity for the group (used for diffing/keys). */
  key: string;
  /** Human-readable label for the group header. */
  label: string;
  /** Tasks belonging to this group, in input order. */
  tasks: Task[];
}

/**
 * Optional context used when ordering groups.
 */
export interface GroupOrderOptions {
  /** Ranks a state keyword for `status` grouping (lower = earlier). */
  stateRank?: (state: string) => number;
}

/**
 * Natural direction for a group field:
 * - `priority`: highest first; `closed`/`started`: most recent first;
 * - everything else: ascending (earliest / A→Z / keyword order).
 */
export function getNaturalGroupDirection(field: GroupByField): SortDirection {
  return field === 'priority' || field === 'closed' || field === 'started'
    ? 'desc'
    : 'asc';
}

/** Keyword groups, in the order used for `status` group ranking. */
export const STATE_RANK_GROUPS = [
  'activeKeywords',
  'inactiveKeywords',
  'waitingKeywords',
  'completedKeywords',
] as const;

/**
 * Build a ranker for `status` grouping from the effective keyword order:
 * active → inactive → waiting → completed, with unknown states last.
 */
export function buildStateRank(
  keywordManager: KeywordManager,
): (state: string) => number {
  const order = STATE_RANK_GROUPS.flatMap((group) =>
    keywordManager.getKeywordsForGroup(group),
  );
  const ranks = new Map<string, number>();
  order.forEach((keyword, index) => {
    const normalized = keyword.toUpperCase();
    if (!ranks.has(normalized)) ranks.set(normalized, index);
  });
  return (state) => ranks.get(state.toUpperCase()) ?? Number.MAX_SAFE_INTEGER;
}

/**
 * Caches the `status` group ranker until the effective keyword order changes.
 * Shared by the task-list and embedded-list views.
 */
export class StateRankCache {
  private key: string | null = null;
  private rank: ((state: string) => number) | null = null;

  get(keywordManager: KeywordManager): (state: string) => number {
    const order = STATE_RANK_GROUPS.flatMap((group) =>
      keywordManager.getKeywordsForGroup(group),
    );
    const key = order.map((keyword) => keyword.toUpperCase()).join('\u0001');
    if (this.key === key && this.rank) {
      return this.rank;
    }
    const rank = buildStateRank(keywordManager);
    this.key = key;
    this.rank = rank;
    return rank;
  }
}

const NO_HEADING_LABEL = '(No heading)';
const NO_PRIORITY_LABEL = 'No priority';
const NO_TAG_LABEL = 'No tag';

const PRIORITY_LABELS: Record<'high' | 'med' | 'low', string> = {
  high: 'High',
  med: 'Medium',
  low: 'Low',
};

const MISSING_DATE_LABELS: Partial<Record<GroupByField, string>> = {
  scheduled: 'No scheduled',
  deadline: 'No deadline',
  closed: 'No closed',
  started: 'No started',
};

const DATE_FIELDS = new Set<GroupByField>([
  'scheduled',
  'deadline',
  'closed',
  'started',
]);

/** Directory portion of a vault path ('' for files at the vault root). */
function getFolder(path: string): string {
  const lastSlash = path.lastIndexOf('/');
  return lastSlash >= 0 ? path.slice(0, lastSlash) : '';
}

/** File name without its final extension. */
function getFileLabel(path: string): string {
  const name = getFilename(path);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/** The date a date-based group field reads from a task. */
function getDateForField(field: GroupByField, task: Task): Date | null {
  switch (field) {
    case 'scheduled':
      return task.scheduledDate;
    case 'deadline':
      return task.deadlineDate;
    case 'closed':
      return task.closedDate;
    case 'started':
      return task.startedDate;
    default:
      return null;
  }
}

function getGroupLabel(field: GroupByField, task: Task): string {
  if (DATE_FIELDS.has(field)) {
    const date = getDateForField(field, task);
    if (!date) return MISSING_DATE_LABELS[field] ?? '';
    return LocaleUtils.formatDate(date, {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }
  switch (field) {
    case 'folder': {
      const folder = getFolder(task.path);
      return folder.length > 0 ? `${folder}/` : '/';
    }
    case 'file':
      return getFileLabel(task.path);
    case 'heading':
      return task.parentHeading ?? NO_HEADING_LABEL;
    case 'status':
      return task.state;
    case 'priority':
      return task.priority ? PRIORITY_LABELS[task.priority] : NO_PRIORITY_LABEL;
    default:
      // 'tag' is grouped with multi-membership by groupByTag.
      return task.tags?.[0] ? `#${task.tags[0]}` : NO_TAG_LABEL;
  }
}

function getGroupKey(field: GroupByField, task: Task): string {
  if (DATE_FIELDS.has(field)) {
    const date = getDateForField(field, task);
    return date ? DateUtils.formatIsoDate(date) : '';
  }
  switch (field) {
    case 'folder':
      return getFolder(task.path);
    case 'file':
      return task.path;
    case 'heading':
      return task.parentHeading ?? '';
    case 'status':
      return task.state;
    case 'priority':
      return task.priority ?? 'none';
    default:
      return task.tags?.[0] ?? '';
  }
}

/** Add a task to the group with `key`, creating it (and its label) on first use. */
function addToGroup(
  groups: TaskGroup[],
  byKey: Map<string, TaskGroup>,
  key: string,
  label: string,
  task: Task,
): void {
  let group = byKey.get(key);
  if (!group) {
    group = { key, label, tasks: [] };
    byKey.set(key, group);
    groups.push(group);
  }
  group.tasks.push(task);
}

/**
 * Order groups that have an intrinsic value, keeping the "missing" group(s)
 * last regardless of direction.
 */
function orderValuedGroups(
  groups: TaskGroup[],
  direction: SortDirection,
  compare: (a: TaskGroup, b: TaskGroup) => number,
  isMissing: (group: TaskGroup) => boolean,
): TaskGroup[] {
  const missing = groups.filter(isMissing);
  const valued = groups.filter((group) => !isMissing(group));
  valued.sort(compare);
  if (direction === 'desc') valued.reverse();
  return [...valued, ...missing];
}

/**
 * Group by tag with multi-membership: a task that has several tags appears in
 * each of its tag groups. Untagged tasks go to a `No tag` group (always last).
 * Tagged groups are ordered alphabetically and `desc` reverses them.
 */
function groupByTag(tasks: Task[], direction: SortDirection): TaskGroup[] {
  const groups: TaskGroup[] = [];
  const groupsByKey = new Map<string, TaskGroup>();

  for (const task of tasks) {
    const tags = task.tags ?? [];
    if (tags.length === 0) {
      addToGroup(groups, groupsByKey, '', NO_TAG_LABEL, task);
      continue;
    }
    const seen = new Set<string>();
    for (const tag of tags) {
      const key = tag.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      addToGroup(groups, groupsByKey, key, `#${tag}`, task);
    }
  }

  return orderValuedGroups(
    groups,
    direction,
    (a, b) => a.key.localeCompare(b.key),
    (group) => group.key === '',
  );
}

/**
 * Group tasks by a field.
 *
 * `folder`/`file`/`heading` are ordered alphabetically (`heading` pins
 * `(No heading)` last). Value fields are ordered natively: `priority` High → Low,
 * date fields chronologically, `tag` alphabetically, `status` by the supplied
 * keyword rank (first appearance without one). Missing values always come last,
 * even with `desc`. `tag` uses multi-membership (a task appears in each of its
 * tag groups, case-insensitively); every other field places a task in exactly one
 * group. Tasks keep their input order within each group and the input array is
 * not mutated.
 */
export function groupTasks(
  tasks: Task[],
  field: GroupByField,
  direction: SortDirection = getNaturalGroupDirection(field),
  options: GroupOrderOptions = {},
): TaskGroup[] {
  if (field === 'tag') {
    return groupByTag(tasks, direction);
  }

  const groups: TaskGroup[] = [];
  const groupsByKey = new Map<string, TaskGroup>();

  for (const task of tasks) {
    addToGroup(
      groups,
      groupsByKey,
      getGroupKey(field, task),
      getGroupLabel(field, task),
      task,
    );
  }

  switch (field) {
    case 'priority':
      return orderValuedGroups(
        groups,
        direction,
        (a, b) =>
          (PRIORITY_RANK[a.key as 'high' | 'med' | 'low'] ?? 0) -
          (PRIORITY_RANK[b.key as 'high' | 'med' | 'low'] ?? 0),
        (group) => group.key === 'none',
      );

    case 'scheduled':
    case 'deadline':
    case 'closed':
    case 'started':
      return orderValuedGroups(
        groups,
        direction,
        (a, b) => a.key.localeCompare(b.key),
        (group) => group.key === '',
      );

    case 'status': {
      const rank = options.stateRank;
      if (!rank) {
        return direction === 'desc' ? groups.reverse() : groups;
      }
      const ordered = [...groups].sort((a, b) => rank(a.key) - rank(b.key));
      return direction === 'desc' ? ordered.reverse() : ordered;
    }

    case 'folder':
    case 'file':
      // No "missing" group: the vault root / a path key is still a real group.
      return orderValuedGroups(
        groups,
        direction,
        (a, b) => a.key.localeCompare(b.key),
        () => false,
      );

    case 'heading':
      return orderValuedGroups(
        groups,
        direction,
        (a, b) => a.key.localeCompare(b.key),
        (group) => group.key === '',
      );

    default:
      return direction === 'desc' ? groups.reverse() : groups;
  }
}
