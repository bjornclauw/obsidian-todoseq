# Plan: Virtual metadata frame + work logging

Status: **Phase 1 implemented and committed (docs + tests done). Phase 2
(work logging) implemented. Phase 3 not started.**

This document is the working plan for turning a task's plain-text metadata block
into a virtual UI layer, and for adding per-task work logging. It captures the
agreed decisions, what already shipped, known follow-ups, and the remaining
phases.

## Guiding constraints

- **Virtual only.** The UI layer must never modify the markdown. Disabling the
  plugin returns the file byte-for-byte unchanged. All rendering is CodeMirror
  decorations (editor) or post-processor DOM (reading view).
- **Everything stays typable.** The raw text is always reachable for hand
  editing. The frame is presentation only.
- **Writes go through the existing pipeline.** Anything that changes a task uses
  `TaskWriter` / `TaskUpdateCoordinator`; the frame itself never writes.
- **Keyword-driven.** No hardcoded keyword checks; use `KeywordManager`.
- **Performance first.** Reuse the existing per-line decoration pass; no new
  polling, no full-vault scans for rendering.

## Agreed decisions

| Topic                  | Decision                                                                                                                                                                    |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frame visibility       | New `metadataFrame` setting, default **on**; off = current per-line styling                                                                                                 |
| Live Preview vs source | Frame is Live Preview only; source mode keeps raw text                                                                                                                      |
| Frame adjacency        | Blank lines between the task and its metadata are absorbed into the hidden range, so the frame hugs the task                                                                |
| Raw reveal             | Explicit `<>` source toggle per task (like Obsidian's edit-block-button), **not** cursor-driven; toggling shows the raw block plus an inline `<>` chip to restore the frame |
| Hidden count           | Counts metadata lines only (blank lines excluded)                                                                                                                           |
| Chip order             | Fixed: SCHEDULED → DEADLINE → CLOSED → CREATED → STARTED → DESCRIPTION, with the controls (expand toggle, `<>`) last                                                        |
| Hidden fields          | CREATED and STARTED sit behind the existing "N hidden" toggle (active frames included); finished frames keep collapsing everything except the completion summary            |
| Active-session keyword | `TIMER:`                                                                                                                                                                    |
| Work-log callout       | `[!work]`                                                                                                                                                                   |
| Chip dates             | Humanized via `DateUtils.formatDateForDisplay` (locale-aware), exact value in tooltip                                                                                       |
| Sessions               | Sequential only; one active timer per task; no parallel timers                                                                                                              |
| Entry format           | Start–stop pairs (`> - 45m · 2026-09-14 09:00–09:45`), writer-normalized, tolerant on scan                                                                                  |
| Total location         | In the `[!work]` callout title (stays truthful when the plugin is disabled)                                                                                                 |
| Reader view            | Phase 3                                                                                                                                                                     |
| Scope (Phases 1–2)     | Markdown list/heading tasks only; table tasks, org-mode and code-comment files excluded                                                                                     |

## Phase 1 — Virtual metadata frame (implemented, uncommitted)

What shipped:

- `src/utils/metadata-block.ts` — pure block scanner + variant resolution
  (`active` / `completed` / `recurring-completed`), excludes the `[!repeats]`
  callout from the hidden range while reading its total, stops at
  subtasks/paragraphs, absorbs leading blanks into the frame range, and reports
  `metadataCount` separately from the range.
- `src/view/editor-extensions/metadata-frame.ts` — `FrameWidget`
  (CM `WidgetType`, `eq()` identity, `ignoreEvent()` so clicks never move the
  cursor into hidden text), icon chips, tooltips, expand/collapse chip, the `<>`
  source-toggle chip, and `FrameSourceToggleWidget` (inline on the task line
  while the source is revealed).
- `src/view/editor-extensions/metadata-frame-field.ts` — the block-replace
  decorations live in a `StateField` because **CodeMirror forbids block
  decorations from `ViewPlugin`s**. Also exports
  `computeMetadataFrameDecorations()` for direct unit testing, and owns the
  per-editor expanded set via `toggleMetadataFrameEffect`.
- `src/view/editor-extensions/task-formatting.ts` — the ViewPlugin reads the
  field's `blockedLines` and skips those lines, so no decorations overlap the
  hidden range.
- `src/view/editor-extensions/metadata-frame-controller.ts` — chip routing:
  scheduled/deadline → `DatePicker` (writes via `TaskUpdateCoordinator`),
  started/closed → state menu, description → task editor modal, created/repeats
  → informational.
- `src/ui-manager.ts` — delegated click + keydown handlers (capture) for chips,
  with the same attach/re-attach/cleanup lifecycle as the keyword context menu.
- Settings: `metadataFrame` toggle with a description; side effect refreshes
  decorations.
- `styles.css` — frame/chip styling matching the approved mockup, dimmed
  completed variant, larger touch targets on mobile.

Tests: `tests/metadata-block.test.ts`,
`tests/metadata-frame-decoration.test.ts`,
`tests/metadata-frame-controller.test.ts`,
`tests/metadata-frame-widget.test.ts` (chip order, hidden counts, `eq`
identity, chip/source effects) and `tests/metadata-frame-state.test.ts`
(StateField toggle survival/recompute).

### Known Phase 1 follow-ups

Bugs / rough edges to resolve before committing:

- [ ] Verify in a real vault: frame rendering, the `<>` source toggle,
      expand/collapse, chip clicks, and that the `[!repeats]` callout still
      folds natively.
- [ ] Add an integration test (Playwright harness) covering frame render +
      source reveal, since the editor layer currently has no real-Obsidian
      coverage.
- [ ] Heading tasks currently use the same left offset as list tasks; the mockup
      had heading frames sitting flush under the heading.
- [ ] Frames are skipped inside quote/callout blocks (deliberate for v1) — decide
      whether to support them.
- [ ] Product consideration: the setting defaults to on, which changes the
      editor for existing users on upgrade.

Resolved:

- [x] Expand/source keys went stale after edits above the task — the field now
      keys `expanded`/`sourceRevealed` by the task line's document start offset
      and remaps them with `tr.changes.mapPos` on every edit (snapping back to
      the containing line start), so a toggle follows its task. The effect
      payload is the 1-based line number; the field resolves and stores the
      offset.
- [x] Docs: the setting is documented in `docs/editor.md`
      ([Metadata Frame](docs/editor.md)) and `docs/settings.md`, with a
      `CHANGELOG.md` entry under Unreleased.
- [x] Frame stretched to the full editor width — block widgets are direct
      children of `.cm-content`, which Obsidian lays out as a column, so the
      frame needs an explicit `width: fit-content` to shrink-wrap.
- [x] Frame was not indented under the task — block widgets do not inherit the
      line's list indentation. The widget measures the task line's rendered text
      start after layout (`requestAnimationFrame` + `view.domAtPos`) and exposes
      it as the inline `--todoseq-frame-indent` custom property. Obsidian's
      editor stylesheet sets `margin: 0 !important` on `.cm-content` children
      (which beats inline styles), so the indent rule in `styles.css` must be
      `!important` with a higher specificity than
      `.markdown-source-view.mod-cm6 .cm-content > *`. The measured value is
      floored at 28px (the mockup offset) so heading/keyword-only tasks keep the
      same visible indent as list tasks; nested tasks indent further.
- [x] No frame when CREATED is the only metadata field — the "nothing to show"
      guard now includes `createdDate`.
- [x] Blank line between the task and the frame — `inclusive: false` on a block
      replace makes CodeMirror open an empty line above the widget (positive
      `startSide` → BlockAfter handling). Block replacements must keep the
      default (inclusive); a regression test asserts `startSide < 0`.
- [x] "N hidden" over-counted blank lines — `metadataCount` counts metadata
      lines only.
- [x] Gap between the task and the frame from a blank line in the source —
      leading blanks are absorbed into the hidden range.
- [x] Raw metadata was revealed by the cursor entering the task/block, which
      made the frame vanish while editing the task text — replaced by the
      explicit `<>` source toggle.

## Phase 2 — Work logging (implemented)

Status: implemented. `src/utils/work-log.ts` (parse/build), parser fields
(`Task.timerStart`, `Task.workLogTotalMinutes`), `[!work]` block scanning,
`TaskWriter.startWorkSession` / `pauseWorkSession`, the `trackWorkLog` setting,
and the frame play/pause chip (with a 30s live tick). Entries are never
truncated (no limit), and the chip shows elapsed + total while running.

Done since the first pass:

- Auto-close a running session when the task is completed, via
  `TaskUpdateCoordinator.autoCloseWorkSession` (covers state and recurrence
  completions).

Still open:

- Integration test covering play/pause end-to-end in a real vault.
- Reader-view parity (Phase 3).

Goal: play/pause a work session on a task, store sessions in a `[!work]` callout,
and show the total in the frame.

Data shape:

```markdown
- [ ] DOING Fix the export bug
      STARTED: [2026-09-14 Mon 09:09] ← unchanged semantics, untouched
      TIMER: [2026-09-14 Mon 10:02] ← active session only
  > [!work]- Total: 3h 15m (latest 50)
  >
  > - 45m · 2026-09-14 09:00–09:45
  > - 1h 30m · 2026-09-13 14:10–15:40
```

Work items:

1. `src/utils/work-log.ts` mirroring `repeat-log.ts`: title/entry regexes, total
   parsing, tolerant hand-typed entry parsing, title/entry builders. TDD.
2. Parser: `Task.timerStart`, `Task.workLogTotalMinutes`, entry count; scan the
   `[!work]` callout in the existing block scan.
3. `TaskWriter`: `startWorkSession` (write `TIMER:`, no-op if one exists),
   `pauseWorkSession` (append entry, reconcile title total, remove `TIMER:`),
   auto-close a running session when the task is completed. Reuse the
   `applyRepeatLogToLines` / `updateRepeatLogInEditor` scan-and-splice pattern.
4. Frame: play/pause chip on active frames; live tick updates only the playing
   widget's DOM (30s granularity, one interval, nothing when stopped).
5. `trackWorkLog` setting (default on; off = no `TIMER:`/`[!work]` written and no
   play button).
6. TDD on writer/parser with pure line-array tests (same style as
   `tests/task-editor-compose.test.ts`).

Open items to settle during implementation:

- Keyword spelling for the active session (`TIMER:` agreed) and whether a manual
  "add entry" affordance is wanted.
- What the frame shows while a session is running (total + elapsed, or elapsed
  only).

## Phase 3 — Ecosystem integration (not started)

1. Task list views: sort/group/filter by logged time; total chip on rows.
2. Status bar: running timer indicator ("▶ 00:42 · task").
3. Reader view: frame/card parity with the editor via the existing
   post-processor.
4. Docs for work logging.

## Risks / notes

- Block decorations must always come from a state-level source; do not move the
  frame back into the ViewPlugin.
- Decoration ranges must be added in sorted `from` order (a `RangeSetBuilder`
  violation silently drops the whole decoration set because
  `createDecorations` catches errors).
- Keep reader-view and editor rendering in sync once Phase 3 lands.
- Any new timer needs cleanup on unload and must not run when nothing is playing.
