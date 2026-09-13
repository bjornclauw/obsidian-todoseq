# Task Entry Structure

This guide covers how TODOseq recognizes, parses, and manages tasks in your Obsidian vault.

## Task Recognition Patterns

TODOseq identifies tasks based on specific patterns in your Markdown files. A task must match the following structure:

```txt
[optional indentation][optional list marker][state keyword][space][task text]
```

### Basic Task Structure

```markdown
TODO Write documentation
DOING Update sync script
DONE Triage customer feedback
```

### Task with Indentation

```markdown
  TODO Indented task
    DOING Double indented task
```

### Task with List Markers

```markdown
- TODO Task in bullet list
+ TODO Task in bullet list using plus marker

1. DOING Task in numbered list
   * DONE Task with indented bullet
```

### Task with Description

Tasks can have an associated description using the `DESCRIPTION:` keyword. The description appears as a styled line below the task in the Task List view. Markdown formatting (bold, italic, links) is stripped for display in task lists.

```markdown
- TODO Write documentation
DESCRIPTION: Cover all new features and settings
SCHEDULED: <2026-01-20>
```

**Rules:**

- Description is a single line (multi-line descriptions are not supported)
- The `DESCRIPTION:` keyword is case-sensitive
- DESCRIPTION: is always inserted immediately after the task line
- Date lines (SCHEDULED, DEADLINE, CLOSED) appear after DESCRIPTION:

**Example with checkbox:**

```markdown
- [ ] TODO Buy groceries
DESCRIPTION: Pick up milk, eggs, and bread
SCHEDULED: <2026-01-16>
DEADLINE: <2026-01-18>
```

## Supported Task Formats

TODOseq supports two main task formats:

### 1. Traditional Keyword Format

The primary format using state keywords:

```markdown
TODO Simple task
DOING Task in progress
DONE Completed task
```

**Examples with context:**

```markdown
- TODO Write documentation
  - DONE Update README
  - DOING Fix typos

1. DONE First step
2. DOING Second step
3. TODO Final step
```

### 2. Markdown Checkbox Format

Combines checkboxes with state keywords:

```markdown
- [ ] TODO Task with empty checkbox
- [ ] DOING In progress task with checkbox
- [x] DONE Completed task with checked checkbox
```

**Checkbox State Synchronization:**

TODOseq automatically syncs checkbox state with task keywords when updated from the Task List:

- Empty checkbox `[ ]` = Incomplete task (TODO, DOING, etc.)
- Checked checkbox `[x]` = Completed task (DONE, CANCELED, etc.)
- When you toggle state, both keyword and checkbox are updated
- Proper spacing is maintained (e.g., `- [x] DONE`)

\*Note: If you modify the checkbox directly in the Obsidian editor, the task state keyword will not be automatically updated.

## Task Keywords

### Additional Formats

TODOseq supports tasks in Markdown tables, headings, quotes, callouts, code blocks, and comments. Tasks in tables follow the same keyword syntax as regular tasks. For tasks in programming language files, enable "Scan code files for comments" in experimental features.

### Tasks in Tables

Tasks can be defined inside Markdown table cells:

```markdown
| COL1            | COL2             | COL3        |
|-----------------|------------------|-------------|
| TODO write docs | DOING review PRs | DONE deploy |
```

With dates (inline, separated by `<br>`):

```markdown
| TODO feature<br>SCHEDULED: <2026-03-01> | DOING review<br>DEADLINE: <2026-02-28> |
```

With priorities:

```markdown
| TODO [#A] critical | DOING [#B] important | DONE [#C] done |
```

See [Editor Integration](editor.md#tasks-in-tables) for full details on table cell tasks.

### Tasks in Headings

TODOseq recognizes task keywords in Markdown headings (H1–H6). This lets you structure your notes hierarchically with projects as headings and tasks as sub-headings, similar to Org-mode and Logseq.

```markdown
# TODO Project Alpha
## DOING Design phase
### DONE Research completed
## TODO Implementation
```

Heading tasks support all the same features as regular tasks — priority tokens, SCHEDULED/DEADLINE dates, and DESCRIPTION lines. Date and description lines go on the next line without indentation.

```markdown
# TODO Launch new feature
SCHEDULED: <2026-07-20>
DEADLINE: <2026-08-01>
```

### Tasks in Quotes and Callouts

When "Include tasks inside quote and callout blocks" is enabled:

```markdown
> TODO Task in a quote block

> > TODO Task in a nested quote block

> > > TODO Task in three level nested quote block

> [!info]
> TODO Task in an info callout

> [!todo]-
>
> - [ ] TODO Checkbox task in collapsible todo block
```

### Tasks in Comment Blocks

When "Include tasks inside comment blocks" is enabled:

```markdown
%% TODO Task in single-line comment block %%

%%
TODO Task in multi-line comment block
DEADLINE: <2025-11-01>
%%
```

### Tasks in Code Blocks

When "Include tasks inside code blocks" is enabled:

<pre>
```txt
TODO task in code block
TODO another task in code block
```
</pre>

### Tasks in Footnotes

TODOseq can detect tasks in footnote definitions:

```markdown
This text has a footnote[^1]

[^1]: TODO task in the footnote
```

### Language-Aware Comment Tasks

TODOseq supports extracting tasks from comments in 20+ programming languages when "Enable language comment support" is enabled:

**Python, Ruby, Shell, YAML, TOML, Dockerfile:**

```python
# TODO Write documentation
# FIXME Handle edge cases
```

**JavaScript, Java, C++, C#, Go, Swift, Kotlin, Rust, PowerShell:**

```javascript
// TODO Implement feature
// HACK Temporary fix
```

**SQL:**

```sql
-- TODO Optimize query
-- DOING Add indexes
```

**INI:**

```ini
; TODO Configure settings
; FIXME Broken config
```

## Task Keywords

### Default Supported Keywords

TODOseq recognizes these task state keywords by default:

**Incomplete States:**

- `TODO` - Task needs to be done
- `DOING` - Task is currently in progress
- `NOW` - Task should be done immediately
- `LATER` - Task is deferred for later
- `WAIT` - Task is waiting on external dependencies
- `WAITING` - Alternative form of WAIT
- `IN-PROGRESS` - Alternative form of DOING

**Completed States:**

- `DONE` - Task is completed
- `CANCELED` - Task was cancelled
- `CANCELLED` - Alternative spelling

### Task State Sequences

Tasks progress through defined state sequences when you click the state keyword:

**Basic Workflow:**

```txt
TODO → DOING → DONE → TODO
```

**Deferred Workflow:**

```txt
LATER → NOW → DONE
```

**Waiting Workflow:**

```txt
WAIT → IN-PROGRESS → DONE
WAITING → IN-PROGRESS → DONE
```

**Cancelled Workflow:**

```txt
CANCELED → TODO
CANCELLED → TODO
```

### Adding Custom Keywords

You can add custom task keywords in the plugin settings. Keywords are organized into four groups, each with specific styling and behavior:

1. Go to TODOseq settings
2. Find the "Task Keywords" section
3. Enter comma-separated capitalized keywords in the appropriate group field

**Keyword Groups:**

- **Active Keywords**: Tasks currently being worked on (e.g., `ACTIVE`, `STARTED`, `FOCUS`)
  - Styled with blue/active color like DOING
  - Highest sort priority among incomplete tasks
  - Increases urgency score

- **Inactive Keywords**: Tasks waiting to be started (e.g., `BACKLOG`, `PLANNED`, `QUEUED`)
  - Styled with default/pending color like TODO
  - Normal sort priority

- **Waiting Keywords**: Tasks blocked by external dependencies (e.g., `BLOCKED`, `PAUSED`, `ON-HOLD`)
  - Styled with yellow/waiting color like WAIT
  - Reduces urgency score

- **Completed Keywords**: Tasks that are finished (e.g., `FINISHED`, `RESOLVED`, `ARCHIVED`)
  - Styled with green/complete color like DONE
  - Lowest sort priority

**Examples:**

```markdown
ACTIVE Currently working on this
BACKLOG Task for later
BLOCKED Waiting for review
FINISHED All done
```

**Rules:**

- Keywords must be capitalized
- Built-in keywords (TODO, DOING, DONE, etc.) are always available
- Custom keywords inherit the styling and behavior of their group
- The same keyword cannot be added to multiple groups

Custom keywords appear in the Task List like default keywords and can be clicked to cycle states. When using the [Keyword sort option](task-list.md#6-keyword) in the Task List, keywords are sorted by group (Active → Inactive → Waiting → Completed), with custom keywords sorted by definition order within each group.

## Priority System

TODOseq supports Logseq-style priority tokens to indicate task importance.

### Priority Tokens

Add priority tokens immediately after the state keyword:

- `[#A]` - High priority
- `[#B]` - Medium priority
- `[#C]` - Low priority

**Examples:**

```markdown
TODO [#A] Critical bug fix
DOING [#B] Feature implementation
DONE [#C] Documentation update
```

## Date Management

TODOseq supports Logseq-style SCHEDULED and DEADLINE dates for task organization.

TODOseq treats all dates and times as timezone-independent values that assume local time. When you schedule a task for "2026-01-31 22:00", TODOseq interprets this in your local timezone rather than UTC. If your device changes timezone, "2026-01-31 22:00" represents Jan 31st 10pm in your new timezone. TODOseq does not make timezone adjustments and does not currently support timezone-aware date handling.

### Date Formats

#### Date Only

```markdown
TODO Write documentation
SCHEDULED: <2025-01-15>
DEADLINE: <2025-01-20>
```

#### Date with Time

```markdown
TODO Write documentation
SCHEDULED: <2025-01-15 14:30>
DEADLINE: <2025-01-20 17:00>
```

#### Date with Day of Week and Time

```markdown
TODO Write documentation
SCHEDULED: <2025-01-15 Wed 14:30>
DEADLINE: <2025-01-20 Mon 17:00>
```

### Smart Date Entry

When Smart Date Recognition is enabled, you can type dates in plain language at the end of a task line. When you finish typing or move the cursor away, TODOseq automatically converts the phrase to a structured `SCHEDULED:` or `DEADLINE:` date line. The table below lists every pattern that is recognised on a task line.

#### One-shot dates

| Expression | Result |
|------------|--------|
| `today` | today |
| `tomorrow` | tomorrow |
| `yesterday` | yesterday |
| `day before yesterday` | two days ago |
| `in 5 days` / `in 2 weeks` / `in 3 months` / `in 2 years` | relative |
| `in 2 hours` / `in 30 minutes` | today at time |
| `next week` / `last week` / `next month` / `last month` / `next year` / `last year` | relative week/month/year |
| `Monday` / `Friday` / … | next named weekday |
| `next Monday` / `last Wednesday` | explicit next/last weekday |
| `on Monday` / `on Friday` | same as bare weekday name |
| `January 27` / `27 January` / `2026-08-11` | specific date |
| `at 9am` / `at 5:30pm` / `at 16:00` | today at time |
| `20:00` / `9pm` | today at time |
| `tomorrow at 16:00` / `on Friday at 2:00pm` | date + time combined |

#### Recurring dates

| Expression | Repeat type |
|------------|-------------|
| `daily` | every day (`+1d`) |
| `every day` | every day (`+1d`) |
| `weekly` | every week (`+1w`) |
| `every week` | every week (`+1w`) |
| `monthly` | every month (`+1m`) |
| `every month` | every month (`+1m`) |
| `yearly` | every year (`+1y`) |
| `every year` | every year (`+1y`) |
| `every Friday` / `every Monday` … | weekly, anchored to that weekday |
| `every morning` / `every afternoon` / `every evening` / `every night` | every day (`+1d`) |
| `every weekend` | every week (`+1w`) |
| `daily 20:00` | every day at 20:00 (`+1d`) |

#### Date type (SCHEDULED vs DEADLINE)

`TODOseq` infers the date type from the task text:

- Phrases containing `due` or `deadline` → **DEADLINE**
- Everything else → **SCHEDULED**

```markdown
TODO Project due tomorrow     → DEADLINE: <…>
TODO Call John tomorrow       → SCHEDULED: <…>
TODO Review PR on deadline Friday → DEADLINE: <…>
```

### CLOSED Date

TODOseq supports a CLOSED date that records when a task was marked as completed, following Org-mode syntax.

#### CLOSED Date Format

```markdown
TODO Write documentation
SCHEDULED: <2025-01-15>
DEADLINE: <2025-01-20>
CLOSED: [2025-01-18 Fri 14:30]
```

The CLOSED date uses square brackets `[]` instead of angle brackets `<>` to distinguish it from scheduled and deadline dates. It includes the date, day of week, and time when the task was completed.

#### CLOSED Date Behavior

- **Automatic Addition**: When you mark a task as completed (e.g., transition from TODO to DONE), a CLOSED date is automatically added if the "Track closed date" setting is enabled.
- **Automatic Removal**: When you reactivate a completed task (e.g., transition from DONE to TODO), the CLOSED date is automatically removed — except for archived tasks (see below).
- **Recurring Tasks**: Completing a recurring task does **not** write a CLOSED date. The completion is recorded in a `[!repeats]` callout instead (see [Repeat History](#repeat-history)); a CLOSED date left by an older version is removed on the next completion. If "Track repeat history" is disabled, the previous behaviour applies and the completion is recorded with a CLOSED date.
- **Archived Tasks**: Archiving a task that already has a CLOSED date keeps it, so the completion record survives archiving.
- **Manual Editing**: You can manually add or remove CLOSED dates directly in your notes.

### CREATED Date

TODOseq can add a CREATED date that records when a task was created by the plugin, completing the task lifecycle: CREATED → STARTED → CLOSED.

#### CREATED Date Format

```markdown
TODO Write documentation
CREATED: [2025-01-15 Wed 08:00]
STARTED: [2025-01-18 Fri 09:00]
SCHEDULED: <2025-01-15>
DEADLINE: <2025-01-20>
CLOSED: [2025-01-19 Sat 14:30]
```

The CREATED date uses square brackets `[]` (the same inactive-timestamp convention as CLOSED/STARTED). Among the date lines, CREATED is written first (immediately below the task/DESCRIPTION, before STARTED/SCHEDULED/DEADLINE/CLOSED).

#### CREATED Date Behavior

- **Automatic Addition**: When the "Track created date" setting is enabled, a CREATED date is added when TODOseq creates a task (through the task editor / `TaskWriter`), and when you finish typing a task line by hand (when the cursor leaves a task line that has no CREATED date).
- **Written once**: CREATED is never updated, duplicated, or removed by the plugin. Manual editing is the only way to change it.
- **Not retroactive**: Existing tasks are not scanned and rewritten; a hand-typed or older task receives its CREATED date the first time you finish editing its line.
- **Travels with the task**: CREATED is part of the task's metadata block, so Copy/Move/Migrate to today carries it along.
- **Manual Editing**: You can manually add, change, or remove CREATED dates directly in your notes.

### STARTED Date

TODOseq supports a STARTED date that records when a task *most recently* entered an active state (e.g., TODO → DOING), completing the task lifecycle: CREATED → STARTED → CLOSED.

#### STARTED Date Format

```markdown
TODO Write documentation
CREATED: [2025-01-15 Wed 08:00]
STARTED: [2025-01-18 Fri 09:00]
SCHEDULED: <2025-01-15>
DEADLINE: <2025-01-20>
CLOSED: [2025-01-19 Sat 14:30]
```

The STARTED date uses square brackets `[]` (the same inactive-timestamp convention as CLOSED) to distinguish it from planning dates. It includes the date, day of week, and time when work on the task most recently began. Among the date lines, STARTED is written after CREATED and before SCHEDULED/DEADLINE/CLOSED.

#### STARTED Date Behavior

- **Automatic Addition**: When a task transitions into an active state (e.g., TODO → DOING), a STARTED date is automatically added if the "Track started date" setting is enabled. This also applies to tasks created already in an active state and to tasks defined in table cells.
- **Updated on restart**: Every time a task (re)enters an active state — for example after being closed or paused and then reopened a year later — STARTED is overwritten with the new start time. It records when the *current* work stretch began.
- **Idempotent per save**: Saving an already-active task (for example editing its text) does not reset STARTED.
- **Never removed**: STARTED is not removed by state changes (unlike CLOSED). It spans the task's active stretches until you restart it; only manual editing can remove the line.
- **Duration**: Together with the CLOSED date, STARTED enables duration calculation (STARTED to CLOSED) and "what did I start today?" queries via the `started:` search filter.
- **Manual Editing**: You can manually add or remove STARTED dates directly in your notes.

#### Date Usage Rules

1. **Placement**: Date lines must be immediately after the task line
2. **Indentation**: Must match or be more indented than the task
3. **Format**: Must use angle brackets `<>` for SCHEDULED/DEADLINE or square brackets `[]` for CLOSED, STARTED and CREATED
4. **Limit**: Only first occurrence of each type (SCHEDULED/DEADLINE/CLOSED/STARTED/CREATED) is recognized

> **Localized display:** Dates shown in the app (task list, tooltips, date picker, task editor) follow Obsidian's language setting. The dates written into your notes always use the canonical format above (`<YYYY-MM-DD Ddd>`, `[YYYY-MM-DD Ddd HH:mm]`), so notes stay portable between devices and languages.

**Correct Date Usage:**

```markdown
TODO Write documentation
SCHEDULED: <2025-01-15>

- DOING Review pull requests
  DEADLINE: <2025-01-20 17:00>
```

**Incorrect Date Usage:**

```markdown
TODO Write documentation
Some text between
SCHEDULED: <2025-01-15> # Not immediately after task

TODO Another task
SCHEDULED: <2025-01-15>
DEADLINE: <2025-01-20>
SCHEDULED: <2025-01-16> # Only first SCHEDULED is used
```

### Date Parsing Details

- Dates are parsed in local time (timezone independent)
- Invalid date formats are ignored and logged to console
- Time component is optional
- Day of week is optional but must be valid if present

### Repeating Dates (Org-Mode Repeaters)

TODOseq supports org-mode compatible repeating date syntax for SCHEDULED and DEADLINE dates. When you mark a repeating task as DONE, the date automatically advances to the next occurrence.

#### Repeater Syntax

Repeaters use the format `<type><value><unit>` appended to the date:

```markdown
SCHEDULED: <2026-03-05 Wed 07:00 .+1d>
DEADLINE: <2026-03-01 Sun ++1w>
```

#### Repeater Types

| Type | Symbol | Behavior |
|------|--------|----------|
| Strict repeat | `+` | If you finish a task late, it still schedules the next one based on the original date |
| From done | `.+` | Schedules the next instance exactly one interval from the moment you hit "DONE" |
| Catch up | `++` | If you missed several intervals, it will jump to the next future date from today so you don't have a massive backlog |

#### Time Units

| Unit | Meaning |
|------|--------|
| `y` | Year |
| `m` | Month |
| `w` | Week |
| `d` | Day |
| `h` | Hour |

#### Practical Examples

The type of repeater you use affects how the next date is calculated after you "close" the current one:

**Strict repeat (+1w):**
```markdown
TODO Weekly team meeting
SCHEDULED: <2026-03-05 Wed 10:00 +1w>
```
- If you finish a task late, it still schedules the next one based on the original date
- Example: If you complete the task on March 8 (3 days late), the next occurrence will be March 12 (original date + 1 week)

**Catch up (++1w):**
```markdown
TODO Weekly team meeting
SCHEDULED: <2026-03-05 Wed 10:00 ++1w>
```
- If you missed several weeks, it will jump to the next future date from today so you don't have a massive backlog
- Example: If you complete the task on March 20 (2 weeks late), the next occurrence will be March 22 (next Wednesday from today)

**From done (.+1w):**
```markdown
TODO Weekly team meeting
SCHEDULED: <2026-03-05 Wed 10:00 .+1w>
```
- It schedules the next instance exactly one week from the moment you hit "DONE"
- Example: If you complete the task on March 8 (3 days late), the next occurrence will be March 15 (completion date + 1 week)

#### Auto-Advance Behavior

When you mark a task with a repeating date as completed (default completed state, i.e. DONE):

1. The date automatically advances to the next occurrence
2. The new date is written back to the file
3. The task is reset to an inactive state (default inactive state, i.e. TODO)
4. The completion is recorded in a `[!repeats]` callout at the end of the task (see [Repeat History](#repeat-history)) when "Track repeat history" is enabled; otherwise a CLOSED date is written when "Track closed date" is enabled

The task is reopened immediately, so it never stays in the completed state.

If you add or change a repeating date on a task that is already completed (for example via the date picker on a DONE task), the occurrence advances the same way. Archived tasks do not recur: archiving is terminal, so a repeater on an archived task is left untouched.

Tasks with repeating dates display a repeat icon in the task list to indicate they will advance when completed.

> **Limitation:** Repeating dates are not supported on tasks defined in Markdown table cells; a repeater there is preserved but does not auto-advance, and the date picker hides the repeat option for cell tasks.

#### Repeat History

Each recurring completion is logged in a collapsed callout at the end of the task, after all date lines:

```markdown
- [ ] Pay rent
  SCHEDULED: <2026-04-01 Wed +1m>
  > [!repeats]- Repeats: 2 (latest 50)
  > - #2 · closed 2026-03-01 Sun 09:12 · due 2026-03-01 Sun
  > - #1 · closed 2026-02-01 Sat 08:40 · due 2026-02-01 Sat
```

- Entries are written **newest first** and record the iteration, the completion time and the occurrence (the SCHEDULED, else DEADLINE, date that was just completed).
- The callout title stores the **running total**, so iteration numbers continue counting even after older entries are dropped.
- `Track repeat history` (Settings, on by default) enables the log; `Repeat history limit` (default 50) caps how many recent entries are kept.
- The log is skipped for table-cell tasks. When `Track repeat history` is disabled, completed occurrences fall back to a CLOSED date.

### Warning Periods (Advance Notice / Delayed Notice)

TODOseq supports org-mode compatible warning periods for SCHEDULED and DEADLINE dates. Warning periods control when a task becomes visible in the task list.

#### Syntax

Warning periods use the format `-Nd` appended to the date (after the repeater if present):

```markdown
SCHEDULED: <2026-06-10 Wed -3d>    # Task appears 3 days AFTER scheduled date
DEADLINE: <2026-06-20 Sat -5d>     # Task appears 5 days BEFORE deadline
DEADLINE: <2026-01-01 Wed +1m -3d> # Monthly repeat, 3-day advance notice
```

For first-only warning periods (only affects the first occurrence of a recurring task), use `--Nd`:

```markdown
SCHEDULED: <2026-06-10 Wed +1w --2d>  # First occurrence delayed 2 days, subsequent weeks on time
```

#### Behavior by Date Type

| Date Type | Warning Period | Behavior |
|-----------|---------------|----------|
| DEADLINE `-Nd` | Advance notice | Task appears N days **before** the deadline |
| SCHEDULED `-Nd` | Delayed notice | Task appears N days **after** the scheduled date |
| DEADLINE `--Nd` | First-only advance notice | Advance notice only on first occurrence |
| SCHEDULED `--Nd` | First-only delayed notice | Delay only on first occurrence |

#### Global Defaults

You can set default warning periods in Settings → Warning period:

- **Deadline advance notice (days)**: Default advance notice for all deadlines (0 = disabled)
- **Scheduled delay (days)**: Default delayed notice for all scheduled dates (0 = disabled)

Per-task warning periods (set via `-Nd` syntax) override the global defaults. A value of `0` explicitly disables the warning period for that task.

#### Skip Behavior

When a task has both a SCHEDULED and DEADLINE date, both warning periods may apply. Two settings control which takes precedence:

| Ignore Scheduled Delay When Deadline Is Set | Ignore Deadline Advance When Scheduled Is Set | Behavior |
|---|---|---|
| Disabled (default) | Disabled (default) | Both apply. The **earlier** effective visibility date wins. (Org Mode default) |
| Enabled | Disabled | Deadline advance notice wins. Scheduled delay is ignored. |
| Disabled | Enabled | Scheduled delay wins. Deadline advance notice is ignored. |
| Enabled | Enabled | Both ignored. Task uses raw dates with no warning period adjustment. |

#### Practical Examples

```markdown
# Deadline with 5-day advance notice
TODO Write report
DEADLINE: <2026-06-20 Sat -5d>
# Task appears in task list from June 15

# Scheduled with 3-day delay
TODO Start project
SCHEDULED: <2026-06-10 Wed -3d>
# Task appears in task list from June 13

# Combined repeater and warning period
TODO Pay rent
DEADLINE: <2026-01-01 Wed +1m -3d>
# Repeats monthly, 3-day advance notice each time

# First-only warning period (recurring)
TODO Weekly review
SCHEDULED: <2026-06-10 Wed +1w --2d>
# First occurrence delayed 2 days, subsequent weeks on time
```

## Tasks in Different Contexts

### Tasks in Lists

TODOseq preserves list structure and markers:

```markdown
- TODO Task in bullet list
  - DOING Subtask with indentation
    - DONE Deeply nested subtask

1. TODO First numbered task
2. DOING Second numbered task
3. DONE Third numbered task
```

### Tasks in Headings

TODOseq recognizes task keywords in Markdown headings (H1–H6). This lets you structure your notes hierarchically with projects as headings and tasks as sub-headings, similar to Org-mode and Logseq.

```markdown
# TODO Project Alpha
## DOING Design phase
### DONE Research completed
## TODO Implementation
```

Heading tasks support all the same features as regular tasks — priority tokens, SCHEDULED/DEADLINE dates, and DESCRIPTION lines. Date and description lines go on the next line without indentation.

```markdown
# TODO Launch new feature
SCHEDULED: <2026-07-20>
DEADLINE: <2026-08-01>
```

### Tasks in Quotes and Callouts

When "Include tasks inside quote and callout blocks" is enabled:

```markdown
> TODO Task in a quote block

> > TODO Task in a nested quote block

> > > TODO Task in three level nested quote block

> [!info]
> TODO Task in an info callout

> [!todo]-
>
> - [ ] TODO Checkbox task in collapsible todo block
```

### Tasks in Comment Blocks

When "Include tasks inside comment blocks" is enabled:

```markdown
%% TODO Task in single-line comment block %%

%%
TODO Task in multi-line comment block
DEADLINE: <2025-11-01>
%%
```

### Tasks in Code Blocks

When "Include tasks inside code blocks" is enabled:

<pre>
```txt
TODO task in code block
TODO another task in code block
```
</pre>

### Tasks in Footnotes

TODOseq can detect tasks in footnote definitions:

```markdown
This text has a footnote[^1]

[^1]: TODO task in the footnote
```

### Language-Aware Comment Tasks

TODOseq supports extracting tasks from comments in 20+ programming languages:

**Python, Ruby, Shell, YAML, TOML, Dockerfile:**

```python
# TODO Write documentation
# FIXME Handle edge cases
```

**JavaScript, Java, C++, C#, Go, Swift, Kotlin, Rust, PowerShell:**

```javascript
// TODO Implement feature
// HACK Temporary fix
```

**SQL:**

```sql
-- TODO Optimize query
-- DOING Add indexes
```

**INI:**

```ini
; TODO Configure settings
; FIXME Broken config
```

## Subtasks

TODOseq supports subtasks by detecting indented checkbox items under a task line. Subtasks are displayed in the task list with a progress indicator showing completed and total count.

### How Subtasks Work

A subtask is a checkbox item that is indented more than its parent task. The minimum indentation difference is one space or tab:

```markdown
TODO Parent task
  - [ ] subtask 1
  - [ ] subtask 2
```

The parent task displays the subtask count: `TODO Parent task [0/2]`

### Subtask Completion

When you check a subtask checkbox from the task list, the parent's subtask count updates automatically:

```markdown
TODO Parent task
  - [x] subtask 1 (completed)
  - [ ] subtask 2
```

Now displays as: `TODO Parent task [1/2]`

### Subtasks with Keywords

If a subtask contains its own task keyword, it becomes an independent task that appears in the task list separately. The parent task still counts it:

```markdown
TODO Parent task
  - [ ] regular subtask
  - [ ] TODO this becomes a task
```

- Parent shows: `TODO Parent task [0/2]`
- "this becomes a task" also appears as its own task

### Tasks with Dates and Subtasks

Subtasks work with scheduled and deadline dates. The date must appear immediately after the task line:

```markdown
TODO Project task
SCHEDULED: <2025-03-15>
  - [ ] initial step
  - [ ] final step
```

### What Doesn't Count as a Subtask

Checkboxes at the same indentation level as the task are not subtasks:

```markdown
TODO Not a parent
- [ ] not a subtask
- [ ] also not a subtask
```

Quoted tasks do not support subtasks:

```markdown
> TODO Not supported
>   - [ ] not detected
```

## Task Updates and Preservation

When a task state is updated, TODOseq preserves:

- **Indentation**: Original whitespace is maintained
- **List markers**: `-`, `+`, `*`, `1.`, etc. are kept
- **Priority tokens**: `[#A]`, `[#B]`, `[#C]` remain, but will be moved to the start of the task line
- **Task text**: Everything after the state keyword is preserved
- **File structure**: Task stays in original location

**Before Update:**

```markdown
- TODO Write documentation for new feature [#A]
```

**After Clicking TODO:**

```markdown
- DOING [#A] Write documentation for new feature
```
