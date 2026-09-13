# Import Tasks

Existing markdown checkbox based tasks in the Obsidian Vault will not be recognized by TODOseq unless they already have a matching keyword after the checkbox.

```markdown
- [ ] this is not recognised as a task

- [ ] TODO this is captured as a TODOseq task
```

## Import with the built-in importer

TODOseq includes an interactive importer (desktop only) that can also convert tasks created by the [Obsidian Tasks](https://github.com/obsidian-tasks-group/obsidian-tasks) plugin. It reads Obsidian Tasks' emoji fields and Dataview inline fields, converts them to TODOseq syntax, and previews every change before writing.

Run it from the command palette:

1. Open the command palette and run **Import Obsidian tasks**.
2. Choose how Obsidian Tasks priorities map onto TODOseq's `[#A]`, `[#B]`, `[#C]` tokens. The importer only adds a token when the source task had an explicit priority.
3. Tick the top-level folders to scan (all are selected by default).
4. Review the file list and the before/after preview, which scroll together. Untick any files you do not want to change, then select **Import selected**.

> **Make a backup first.** TODOseq writes the converted files in place and does not create snapshots. Back up your vault (or use Obsidian Sync / version control) before running the importer.

The vault is rescanned automatically after the import.

A `🛫` start date is written as the task's scheduled date when the task has no scheduled date; if it already has one, the start date is dropped with a warning. TODOseq has no separate planning start date — its `STARTED` line records when a task most recently entered an active state and is not the same concept.

### What gets converted

| Obsidian Tasks | TODOseq |
|----------------|---------|
| `- [ ]` / `- [x]` / `- [/]` / `- [-]` | `[ ]` / `[x]` with `TODO` / `DONE` / `DOING` / `CANCELED` |
| `⏳ 2026-01-15` or `[scheduled:: 2026-01-15]` | `SCHEDULED: <2026-01-15 Thu>` |
| `📅 2026-01-20` or `[due:: 2026-01-20]` | `DEADLINE: <2026-01-20 Tue>` |
| `🛫 2026-01-10` or `[start:: 2026-01-10]` | `SCHEDULED: <2026-01-10 Sat>` (only when no scheduled date exists) |
| `➕ 2026-01-01` or `[created:: 2026-01-01]` | `CREATED: [2026-01-01 Thu]` |
| `✅ 2026-01-18` or `[completion:: 2026-01-18]` | `CLOSED: [2026-01-18 Sun]` |
| `❌ 2026-01-18` or `[cancelled:: 2026-01-18]` | `CLOSED: [2026-01-18 Sun]` + `CANCELED` |
| `🔁 every week` or `[recurrence:: every week]` | `+1w` on the scheduled/deadline date |
| `🔁 every week when done` | `.+1w` |
| `🔁 every 2 weeks` | `+2w` |
| `⏫ 🔼 🔽 ⏬` or `[priority:: highest]` | `[#A]` / `[#B]` / `[#C]` (using your chosen mapping) |

Unsupported metadata (for example `every weekday`, or a recurrence with no date to attach to) is listed as a warning in the preview and left untouched in the file.

## Manual Import

A simple way to bring existing tasks into TODOseq is to do a find and replace to add the `TODO` keyword.

For each page in the vault that you want to capture checkbox based tasks from:

Select **Edit > Replace** from the Obsidian menu

- Find "`- [ ] `"
- Replace "`- [ ] TODO `"

Click the **Replace All** button to add the keyword to all checkboxes in the page.
