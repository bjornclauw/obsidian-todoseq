# Change Log

## Unreleased

### Added

- **Track created date.** New `Track created date` setting (off by default). When enabled, tasks created by TODOseq (the task editor / `TaskWriter`) and hand-typed tasks (stamped when you finish the task line) receive a `CREATED: [YYYY-MM-DD Ddd HH:mm]` line, written once and never changed afterwards. CREATED sits above STARTED among the task's date lines and travels with the task block on Copy/Move/Migrate.
- **Task editor.** Create or edit the task at the editor cursor from the ribbon button or the "Create or edit task" command. It edits state, priority, scheduled and deadline dates (with repeat and warning period) and a description, and writes through `TaskWriter`.
- **Choose the list marker for new tasks.** The task editor now lets you create a new task as a checkbox (`- [ ] TODO task`), a plain bullet (`- TODO task`), or a keyword-only task (`TODO task`). The selection is remembered and reused the next time you create a task.
- **Repeat history.** Completing a recurring task records a collapsed `[!repeats]` callout at the end of the task, listing the iteration number, closed time and occurrence date, newest first. New settings `Track repeat history` (on by default) and `Repeat history limit` (default 50) control the log; the running total continues past the cap. Table-cell tasks skip the log, and the date picker hides the repeat option for them because recurrence is not supported in cells.
- **Task List sorting and grouping.** The Task List view gained a sort direction toggle beside the sort dropdown (it resets to the method's natural direction when the method changes), a `Group by` dropdown (folder, file, heading, status, priority, scheduled, deadline, closed, started or tag) with its own direction toggle, and `tag` as a sort method. Multi-tagged tasks are listed under each of their tags. Grouped lists keep incremental loading, saved searches capture the grouping and directions, and the last-used sort method, sort direction, grouping and group direction are remembered across sessions.
- **Collapsible group headers.** In a grouped Task List, click a group header, or focus it and press Enter or Space, to hide or show its tasks. Each header shows the task count. A toolbar button collapses or expands every group, and the collapse state is remembered across sessions.
- **Embedded list grouping and sorting.** Added a `group-by:` option that splits results into labelled sections with a task count per section. `group-by:` fields are folder, file, heading, status, priority, scheduled, deadline, closed, started and tag, with an optional `asc`/`desc`. Value fields order naturally (priority High to Low, dates chronologically, closed/started most recent first, tags alphabetically); a tag places a task in several sections, and a missing-value group comes last. `sort:` accepts an explicit direction and an optional second key (for example `sort: priority desc, scheduled`); tasks missing the sort value always sort last. Added the `description:` and `heading:` search prefixes, usable in the search field and in embedded code blocks. The `show-urgency:` option is now documented.
- **Locale-aware dates.** Date and time display in the task list, tooltips, date picker and task editor follows Obsidian's language, including localized relative labels and month and weekday names. English near-future wording changed from "N days from now" to "In N days". Date text written into notes stays in the canonical org-mode format (`<YYYY-MM-DD Ddd>`, `[YYYY-MM-DD Ddd HH:mm]`) so notes remain portable across devices and locales.
- **Complete saved searches.** The save/edit dialog now exposes sort direction, grouping and group direction, and adds `Tag` as a sort method. Leaving a field on "Use current setting" falls back to the view at apply time, and editing a saved search no longer overwrites its grouping or directions with the current view. The built-in presets (Today, Overdue, Active) reset grouping to none.

### Changed

- **STARTED and CLOSED lifecycle** is now consistent across every surface (editor checkbox, task list, reader, embedded lists, task editor and table cells):
  - CLOSED is added when a task is marked completed, and removed when a non-recurring task is reactivated. It is kept when a task is archived. Recurring completions no longer write CLOSED; the completion is recorded in the `[!repeats]` callout instead.
  - Completing a recurring task reopens it immediately (resets the state and advances its dates).
  - STARTED is written when a task enters an active state (including tasks created already active and tasks in table cells), and is **updated on every restart**: closing a task and reactivating it later stamps the new start time. It is never removed automatically. It now sits below CREATED and above SCHEDULED.
  - In table cells, CLOSED, STARTED and CREATED use the `[[YYYY-MM-DD Ddd HH:mm]]` wikilink form.
- In an embedded task list, clicking the state keyword advances it to the next state on desktop; on mobile a tap does nothing and long-press opens the state menu. The checkbox still toggles completion, and clicking anywhere else on the row still opens the source file.
- Embedded task lists now update changed rows in place instead of rebuilding the whole list when the same tasks are shown in the same order, so changing a task's state no longer flickers or moves the view. The state keyword briefly highlights to make the change visible, and respects reduced motion.
- The Task List sort is now solely the last-chosen method: the separate **Default sort method** setting was removed, and a fresh install starts on the file-path default. Applying a saved search no longer overwrites the remembered sort, sort direction or grouping.

### Fixed

- Fixed the Task List search field's "Search options" / saved-searches dropdown not opening reliably. The dropdown modules are now loaded statically, the field is wired synchronously, the panel opens on click as well as focus, and the dropdown is anchored to the input's own window so it works in popout windows. Added `description:`, `heading:` and `started:` to the options list.
- Fixed the Task List view being left in a dead state after disabling and re-enabling the plugin; Obsidian now owns view teardown on unload.
- Fixed the date picker losing input focus when opened from the Task Editor: it is now appended to the modal container, and BaseDialog no longer intercepts keys typed into form controls.
- Fixed the date picker losing changes when only the repeat, warning period, or time of an already-selected date was changed.
- Fixed date suggestions (`scheduled:`, `deadline:`, `closed:`, `started:`) being off by one day in timezones ahead of UTC; date literals are now derived from local date parts.
- Fixed stale date/status metadata when cycling a task's state right after editing its date lines in the note (for example, deleting a `SCHEDULED` line and immediately cycling to DOING left the repeat status behind). State changes now re-read the task's date metadata from the live source (the open editor buffer, otherwise the file) instead of the asynchronously updated state manager.
- Fixed date lines inserted into a note that has no trailing newline being merged onto the previous line (for example, adding a `DEADLINE` immediately after the last `SCHEDULED` line).
- Fixed Copy/Move/Migrate to today's daily note not carrying the whole task block: `DESCRIPTION`/`STARTED`/`CLOSED`/`[!repeats]` were only included for indented tasks, so keyword-only tasks left metadata behind, and Move/Migrate could leave `SCHEDULED`/`DEADLINE` behind when a `DESCRIPTION`/`STARTED` line preceded them. The full metadata block is now recognised at the task's own indent.
- Fixed task state, priority and urgency failing to render in a note that contains a completed (or archived) table-cell task with a priority token. Priority ranges in cells now exclude the surrounding whitespace, matching the normal task path.
- Fixed the note containing an embedded task list jumping (scroll position moving) when a task's state is changed. Rebuilding the list now preserves the scroll position of the containing view.
- Fixed changing an embedded task's date or priority moving the view: date, priority and recurrence updates from lists (and the reader) now write through the vault, like state changes already did, so the open note is not edited in place.
- Fixed `.+` (from-done) repeaters for day and week units to match Org mode: the next date is one interval from the completion day (preserving the original time-of-day), instead of returning the same day or snapping to the original weekday.
- Fixed adding or changing a repeating date on an already-completed task being silently inert; it now advances the occurrence. Archived tasks do not recur.
- Fixed cancelling a recurring task rolling it forward; it now stays in the cancelled state (and still records a CLOSED date).
- Fixed reactivating an archived task dropping its SCHEDULED/DEADLINE/CLOSED/STARTED metadata, so a repeating task keeps recurring after it is un-archived.
- Fixed saved searches silently overwriting your defaults. Applying a saved search now applies its view settings (completed tasks, future dated tasks, sort, grouping, directions and match case) as temporary session overrides; the controls are highlighted while overridden and clearing the search restores your defaults. Changing a setting in the Settings tab no longer stomps an active saved-search override, and the future-task override no longer leaks into embedded task lists. Editing the search text or changing any task-list view setting leaves the saved search: your change is kept, the other settings return to your defaults, and the bookmark changes to **Save search**.

## 0.20.0

- Added new option to track STARTED date when a task enters an active state.

## 0.19.0

- Updated settings to use the new Obsidian 1.13 declarative settings API, enabled settings search.
- Promoted table cell tasks from experimental to fully supported feature. #72
- Fixed CLOSED date format parsing and migration for table cells.
- Fixed table cell keyword decoration and menu issues in Live Preview mode.
- Fixed row corruption when cycling table cell tasks.
- Added ConfirmationModal for saved search deletion.
- Fixed settings number range warnings; dependent toggles now persist correctly.
- Minimum Obsidian version raised to 1.13.0.

## 0.18.1

- Fixed SCHEDULED / DEADLINE / CLOSED / DESCRIPTION lines after heading-based tasks losing their CSS wrapping in reader mode after a close+reopen.
- Addressed latest Obsidian plugin review feedback items.

## 0.18.0

- Added support for declaring tasks in markdown headings. #74
- Added support for defining tasks in markdown table cells.

## 0.17.0

- Adds Task descriptions via new `DESCRIPTION:` keyword. #73
  - Add short context notes to tasks that display in Task List and Embedded Lists
  - New `Add description` command in command palette
  - Code block option `show-description` for embedded lists

## 0.16.4

- Fixed show 'No tasks found' instead of 'Loading...' when vault has no tasks after scan.
- Fixed task not removed from task list when last task deleted from vault.

## 0.16.3

- Fixed cycle task state on recurring tasks causing "file modified externally" warning and corrupted state text.
- Editor commands (toggle state, cycle state, priority) now work when cursor is on a SCHEDULED, DEADLINE, or CLOSED date line.
- Fixed extra space inserted when updating priority on checkbox tasks.

## 0.16.2

- Added sortByKeyword sort option for task list view.
- Fixed warning period not carried over when marking repeating tasks as done. #71
- Fixes forward dates remains cached when undoing repeating task advancement. #72
- Fixed issue with unsaved editor changes being lost during recurrence updates.
- Fixed visual inconsistency when checkbox toggle handler returns early.
- Fixed issue with queued updates being silently dropped after prior rejection.
- Fixed warning periods from the date picker being dropped when updated from embedded task list context menu.
- Adjusted task tooltips on hover the for date, repeat, and warning periods.
- Improved performance by implementing selective cache invalidation for file changes in embedded task lists.
- Updated undici dependency to address security alerts.

## 0.16.1

- Updated tooltips style. Date tooltips show consistent full dates with time, warning periods, and repeat details.
- Fixed issue with when upcoming periods being ignored when set to 0 days.
- Standardized hover effect styling across the plugin, added row highlight to main task list.

## 0.16.0

- Added support for saving/bookmarking searches in the main task list. #62
- Added support scheduled and deadline dates with org-mode style warning periods. #70
- Added setting to change the period for the Upcoming tasks, default is 7 days.
- Fixed search history entries to now remember and restore the match case setting for each query.
- Fixed issue with changing repeating value on scheudled or deadline dates in the editor not updating the task list.
- Added automated integration test framework.

## 0.15.2

- Address Obsidian community scorecard review feedback items.

## 0.15.1

- Fixed issue with identifying codeblocks fences that start with bullet markers. #69

## 0.15.0

- Added natural date extraction from the task description, write tasks like 'TODO put out the garbage today' and automatically set the scheduled date. #59
- Added smart date highlighting in the editor to visually show which words are detected as dates.
- Added experimental support for scanning code files (JS, TS, Python, etc.) for TODO comments. #58
- Added support for the Obsidian 'Readable line length' setting when TODOseq task list is shown in a main tab.
- Fixed background write causing file changed externally notification when updating task priority using command palette action in editor.

## 0.14.3

- Fix style regression with mobile context menu.

## 0.14.2

- Address more Obsidian community scorecard review feedback items.

## 0.14.1

- Address more Obsidian community scorecard review feedback items.

## 0.14.0

This release addresses the majority of the new Obsidian plugin code review feedback items.

- Breaking change: Removed default hot-key for cycling task states, as per Obsidian plugin developer guidelines. Hotkeys can be configured in Obsidian settings.

- Added github artifact attestations for `main.js` and `styles.css`.
- Addressed 615 Obsidian community scorecard review feedback items.
- Added `eslint-plugin-obsidianmd` lint checks.
- Expanded unit test coverage.

## 0.13.4

- Fixed issue with inconsistent behavior opening the task context menu from the tas list on mobile. #67
- Fixed consistency of embedded task list selected task highlight styling across platforms.
- Fixed styling of embedded task list content wrap in dynamic mode.

## 0.13.3

- Fixed issue with placement of closed date on indented tasks.

## 0.13.2

- (no changes)

## 0.13.1

- Added sort by closed date option in task list view and embedded task lists.
- Added search filters for state groups `state:active`, `state:completed`, `state:inactive`, and `state:waiting`.
- Added urgency `time.coefficient` to increase urgency for tasks with a specific deadline or scheduled time.
- Fixed urgency calculation and sort for tasks with a scheduled time or deadline time.
- Fixed issue with active tasks being struck-through in embedded task list when extended markdown checkbox option enabled.

## 0.13.0

- Added support for drag and drop tasks from task list to active page. #61
- Added support to search/filter for tasks by closed date. #66
- Added display of closed date on completed tasks in task list.
- Added option to show closed date in embedded task lists.
- Fixed task line not styled after code block with alternate delimiters in content.
- Fixed preserve task line list markers when copying/moving tasks.
- Fixed preserve task sub bullet content when copying/moving tasks.
- Fixed date indent spacing for bulleted tasks.

## 0.12.2

- Added optional `show-scheduled-date:` and `show-deadline-date:` parameters to embedded task lists to control whether to show inline scheduled and deadline date badges on incomplete tasks. Defaults to `hide`. #65

## 0.12.1

- Fixed error when task line has no content causing task list to show no results for the affected page.
- Fixed search filter from clicking task count in status bar not performing an exact file match.

## 0.12.0

- Added task context menu with quick actions for priority, scheduled date, and copy/move tasks. #34
- Added optional "Migrate to today" action to copy a task and daily note and update keyword on the source task. #43
- Added support for subtasks. #47
- Added support for repeating tasks. When marked as done, recurring tasks advance their scheduled/deadline dates after a short delay. #38
- Added optional CLOSED: date on completed tasks, matching org mode syntax.
- Added "Open task list in new tab" command palette option to open task list view in a new tab in the main workspace area.
- Fixed styles for better compatibility with Obsidian themes.
- Fixed console violation warning for non-passive touchstart event listener.

## 0.11.2

- Fixed issue with task list not updated immediately when scheduled or deadline dates are added/changed/removed. #56

## 0.11.1

- Added command pallette icons. #55

## 0.11.0

- Changed the sort algorithms to use the task keyword state as secondary sorting criteria. #51
- Added a special Archived state that is used to highlight tasks in the editor, but does not appear in the task lists. #37
- Added support for custom keywords by keyword groupings for Active, Inactive, Waiting, Completed, and Archived tasks. #43
  - Custom active keywords now contribute to urgency score, and custom waiting keywords reduce urgency score.
  - Existing custom keywords from previous versions are automatically migrated to the Inactive group.
  - Built-in keywords can be removed using `-KEYWORD` syntax in the settings
  - Built-in keywords can be redeclared in the same group to change sort order, or moved to a different group.
- Added support for custom state transitions when using the cycle/toggle keyword command actions.
- Reorganized the right-click keyword state menu into five groups (Active, Inactive, Waiting, Completed, Archived) with dividers between groups.
- Added `sort: keyword` option to embedded task lists for keyword-based sorting.
- Added a new experimental features section in the settings.
- Added experimental support for extracting tasks from Org Mode files within the vault. #45

## 0.10.2

- Fixed performance issues with larger vaults causing lag while typing when task list is visible. #48
  - EventCoordinator service debounces and batches vault events to prevent excessive re-renders when typing in large vaults.
  - Chunked task list rendering with lazy loading and scroll position preservation for better performance with large task lists.
  - Cached keyword sort configuration to avoid rebuilding it on every render.
- Fixed settings corruption issue causing settings to get reset on restart.

## 0.10.1

- Fixed issue with task keyword occationaly not clickable on new pages. #44
- Fixed search parser to correctly handle consecutive NOT operators.

## 0.10.0

- Added keyword sort option to organize tasks by keyword state Active (NOW/DOING/IN-PROGRESS), Inactive (TODO/LATER), Custom (user-defined), Waiting (WAIT/WAITING), and Completed (DONE/CANCELED/CANCELLED). #31
- Added support the page properties search to filter tasks to only those that are on pages that match the property value. #26
- Added search history for the last 10 search queries in the task list search. #32
- Added new `wrap-content:` parameter to embedded task lists to toggle between compact and wrap content modes. Defaults to `dynamic` for responsive behavior (truncates on wide screens, wraps on mobile). #25
- Added new `collapse:` parameter to embedded task lists allow toggling between expanded and collapsed modes. #27
- Added styled rendering of priority indicators in the editor live preview mode, and reader view. #35
- Fixed styling in the editor source mode for a more consistent source style that minimizes visualize restyling.

## 0.9.4

- Fixed date parsing for consistent date normalization.
- Added examples of using Obsidan Canvas to create Kanban and Eisenhower Matrix views.

## 0.9.3

- Added a vault scan in progress indicator to empty task lists.
- Fixed new custom keywords not getting styled in the editor view until restart.
- Fixed embedded task list not updating with task content changes.
- Fixed reliability of the keyword click handler to toggle state.
- Fixed tag recognition and search to work with mutlibyte characters and emojies

## 0.9.2

- Added support for tasks declared in nested quotes.
- Fixed embedded task list from wrapping keywords when page space is condensed.
- Fixed task list panel always taking focus on app startup and plugin reload.
- Fixed task capture and styling for tasks declared in footnotes.
- Improved update responsiveness with centralized service to handle all task state updates consistently across the plugin.

## 0.9.1

- Added truncation to long file names in the embedded task list views. Hover over the truncated name to see the full path. #25
- Added `title:` parameter to embedded task lists to display a custom title above the list. #27
- Added `show-query:` parameter to embedded task lists to toggle display of the search query and filter parameters in the header. #27
- Fixed tag search functionality with subtag support and exact matching. #28

## 0.9.0

- Added task keyword styling in the reader view with interactive state updates. #22
- Added new embedded task lists to add custom filtered lists within a page. #21
- Centralized task state management across all views, task list view, and embedded lists use a single source of truth.
- Fixed issues with changing settings not updating task collection and display.
- Fixed task selection navigation for consistent behavior with cmd-/ctrl- and shift- select modifiers.
- Fixed file change handling check to honor the global excludes settings, improves startup performance.

## 0.8.1

- Added new "Cycle task state" command, similar to the "Toggle task state" but also works on non-task lines to add the TODO task keyword, and the final transition from DONE removes the task keyword rather than cycling stright back to TODO. i.e. "no keyword" -> TODO -> DOING -> DONE -> "no keyword". #20

## 0.8.0

- Scanning for tasks now honors the vaults "Excluded files" setting.
- Added new Urgency sort option that applies a multi-factor algorithm to calculate task urgency (see docs).
- Added task view option to limit or hide display of future dated tasks.
- Added new settings option to persist the preferred task list sort.
- Added new "Rescan vault" action to command palette.
- Updated styling of completed tasks in editor view to striketrough the full task line.
- Updated vault scanner to use cached reads when collecting tasks.
- Reorganized settings using Obsidian 1.11's new Setting Groups for better organization.

## 0.7.0

This release introduces formatting and interactivity for tasks in the editor view. Task state keywords are now highlighted automatically and can be interacted with to update the taske atate similar to the task list view. The default location of the task list panel has been moved to the right sidebar. New actions have been added to the command palette to add scheduled and deadline dates to tasks and set priority.

- Addded task formatting in the editor with settings option to disable (enabled by default).
- Added a right click option on the task keyword in the editor to change the state of the task.
- Added a single click action to the task keyword in the editor to cycle through the task states (TODO -> DOING -> DONE).
- Added task state update when a task checkbox is toggled in the editor.
- Added auto completion helpers for entering scheduled and deadline dates.
- Added command palette commands to add scheduled and deadline dates to tasks.
- Added command palette commands to set task priority.
- Moved the default location of the task list panel to the right sidebar.
- Refined the task count and search suggestions when completed tasks are hidden.
- Added status bar entry to show task count (not completed tasks) for the current page.

## 0.6.2

- Fixed issue with custom keywords not shown in search suggestions. #12
- Fixed issue with search suggestions dropdown not being removed on focus change. #16
- Fixed selected task not always scrolled into view in the editor. #14

## 0.6.1

- Fixed issue with file and path suggestion dropdown not showing new files.
- Fixed issue with file and path search not handing names with hyphens correctly.
- Added dynamic filtering of search keyword dropdown to matching keyword on text input.

## 0.6.0

- Added advanced search keyword filters to match specific task attributes, e.g. `status:TODO` or `priority:high`, and enhanced the search evaluator to support complex queries with AND/OR logic, negated search terms (`-word`, or `-priority:none`), date ranges (`scheduled:2026-01-01..2026-03-31`), and keyword combinations (e.g. `(status:DOING OR priority:high) AND tag:projectX`).
- Introduced a search suggestion dropdown to provide real-time suggestions as users type their queries.
- Added support for detecting tasks in footnote definitions (e.g., `[^1]: TODO task in footnote`). #4
- Added optional support for collecting tasks inside comment blocks (`%%` syntax). Disabled by default. #2
- Updated the styling for active tasks (DOING/NOW) in the Task List to highlight status vs inactive tasks.
- Added plugin usage documentation in the /docs folder.
- Fixed potential security ReDoS vulnerability in regex parsing
- Improved custom keyword validation to prevent invalid characters in keyword names.

## 0.5.2

- Added new action and keyboard shortcut to toggle the state of the task on the current line in the Markdown editor. Default hotkey `Ctrl-Enter`. #7
- Fixed issue with tasks not being collected when the task content starts with a multibyte character. #8

## 0.5.1

- Fixed issue with tasks not being collected when the task content starts with a #tag

## 0.5.0

- Added support for collecting tasks with language specific comments in code blocks
- Added support to optionally collect tasks in quotes and callouts blocks
- Fixed issue where scheduled or deadline time was not shown.
- Reworked and refactored task parser logic for improved maintainability.

## 0.4.3

- Fixed regression causing the TODOseq panel to steal focus during periodic refresh

## 0.4.2

- Addresses community plugin review feedback

## 0.4.1

- Fixed issue with date parser missing dates with day of week value after the date
- Fixed issue with tasks getting removed when a page renamed or moved

## 0.4.0

- Added collection of tasks where the keyword follows a markdown checkbox, e.g. `- [ ] TODO example task`
- Added support for SCHEDULED: and DEADLINE: dates for tasks following Logseq style
- Updated search input to follow Obsidian styles and theming
- Added Match Case and Clear Search options
- Added result count showing total and filtered task count
- Added sort options to sort by scheduled/deadline date or priority
- Added styling for tags within the task descriptions

## 0.3.2

- Removes markdown symbols for highlight and math blocks in task display
- Fixed Dependabot alert #1 Obsidian before 0.12.12 does not require user confirmation for non-http/https URLs.

## 0.3.1

- Address ObsidianReviewBot review feedback
- Highlight selected task on page

## 0.3.0

- Added right click (long press on mobile) context menu on keyword to change task state
- Added search field to filter task list
- Added empty list guidance
- Changed settings behavior for adding additional task keywords
- Refactoring and optimization

## 0.2.1

- Use editor and vault.process to update task lines files

## 0.2.0

- First public release

## 0.1.0

- Initial development
