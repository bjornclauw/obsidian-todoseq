import { Task } from '../types/task';
import { getFilename } from './task-utils';

/**
 * Fields a task list can be grouped by (location grouping).
 */
export type GroupByField = 'folder' | 'file' | 'heading';

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

const NO_HEADING_LABEL = '(No heading)';

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

function getGroupLabel(field: GroupByField, task: Task): string {
  switch (field) {
    case 'folder': {
      const folder = getFolder(task.path);
      return folder.length > 0 ? `${folder}/` : '/';
    }
    case 'file':
      return getFileLabel(task.path);
    case 'heading':
      return task.parentHeading ?? NO_HEADING_LABEL;
  }
}

function getGroupKey(field: GroupByField, task: Task): string {
  switch (field) {
    case 'folder':
      return getFolder(task.path);
    case 'file':
      return task.path;
    case 'heading':
      return task.parentHeading ?? '';
  }
}

/**
 * Group tasks by a location field.
 *
 * Groups are ordered by first appearance of their key in the input; tasks keep
 * their input order within each group. The input array is not mutated.
 */
export function groupTasks(tasks: Task[], field: GroupByField): TaskGroup[] {
  const groups: TaskGroup[] = [];
  const groupsByKey = new Map<string, TaskGroup>();

  for (const task of tasks) {
    const key = getGroupKey(field, task);
    let group = groupsByKey.get(key);
    if (!group) {
      group = { key, label: getGroupLabel(field, task), tasks: [] };
      groupsByKey.set(key, group);
      groups.push(group);
    }
    group.tasks.push(task);
  }

  return groups;
}
