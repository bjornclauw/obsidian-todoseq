# Public API

TODOseq exposes a small read/write API that other Obsidian plugins can use to
list tasks, subscribe to changes, and update task state.

The API is available at:

```js
const todoSeq = app.plugins.plugins['todoseq'];
const api = todoSeq?.api;
```

`api` is `null` until TODOseq has finished loading, so always guard against it
being missing.

## Version

```ts
readonly version: number
```

The current API version. Compare against a known value before relying on a
method so a future breaking change can be detected.

## `getTasks()`

```ts
getTasks(): Task[]
```

Returns a shallow copy of all tasks TODOseq currently knows about. Task objects
are the internal representation (see `src/types/task.ts`): `path`, `line`,
`text`, `state`, `completed`, `priority`, `scheduledDate`, `deadlineDate`,
`closedDate`, `startedDate`, `createdDate`, `tags`, `urgency`, `tableCell`, and
more.

## `onTasksChanged(callback)`

```ts
onTasksChanged(callback: (tasks: Task[]) => void): () => void
```

Calls `callback` immediately with the current tasks and again whenever the task
set changes. Returns an unsubscribe function.

```js
const unsubscribe = api.onTasksChanged((tasks) => {
  console.debug(`TODOseq now has ${tasks.length} tasks`);
});

// Later:
unsubscribe();
```

## `toggleTask(path, line, cellIndex?)`

```ts
toggleTask(path: string, line: number, cellIndex?: number): Promise<string | null>
```

Toggles completion: completes an open task, reactivates a completed one. Routes
through the same update pipeline the plugin's own views use, so recurrence,
CLOSED/STARTED and state-transition settings apply.

Resolves with the resulting state keyword, or `null` when no task exists at the
given location. `cellIndex` identifies a task inside a Markdown table cell.

## `setTaskState(path, line, newState, cellIndex?)`

```ts
setTaskState(
  path: string,
  line: number,
  newState: string,
  cellIndex?: number
): Promise<string | null>
```

Sets a task's state keyword explicitly. Resolves with the new state, or `null`
when the task is not found. Throws if the plugin is not fully initialized.

## `rescan()`

```ts
rescan(): Promise<void>
```

Triggers a full vault rescan. Useful after bulk external file changes.

## Example: completing a task from another plugin

```js
const api = app.plugins.plugins['todoseq']?.api;
if (api) {
  const newState = await api.toggleTask('Projects/Roadmap.md', 12);
  if (newState === null) {
    console.warn('No TODOseq task at line 12');
  }
}
```
