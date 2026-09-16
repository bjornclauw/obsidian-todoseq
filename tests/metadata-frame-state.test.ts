import { EditorState } from '@codemirror/state';
import { DefaultSettings } from '../src/settings/settings-types';
import { TaskParser } from '../src/parser/task-parser';
import { createTestKeywordManager } from './helpers/test-helper';
import {
  createMetadataFrameField,
  MetadataFrameFieldValue,
} from '../src/view/editor-extensions/metadata-frame-field';
import {
  toggleMetadataFrameEffect,
  toggleMetadataFrameSourceEffect,
} from '../src/view/editor-extensions/metadata-frame';

const DOC = [
  '- [ ] TODO Task',
  '  SCHEDULED: <2026-09-14 Mon>',
  '  DEADLINE: <2026-09-16 Wed>',
  '',
  'After',
].join('\n');

function setup() {
  const settings = { ...DefaultSettings, metadataFrame: true };
  const parser = TaskParser.create(
    createTestKeywordManager(settings),
    null as never,
    undefined,
    settings,
  );
  const field = createMetadataFrameField(
    settings,
    () => parser,
    () => 'test.md',
  );
  const state = EditorState.create({ doc: DOC, extensions: [field] });
  return { field, state };
}

function value(
  state: EditorState,
  field: ReturnType<typeof createMetadataFrameField>,
) {
  return state.field(field) as MetadataFrameFieldValue;
}

/** Start offset of a 1-based line in `state`. */
function pos(state: EditorState, line: number): number {
  return state.doc.line(line).from;
}

describe('metadata frame state field', () => {
  it('starts with no expanded or revealed frames', () => {
    const { field, state } = setup();
    expect(value(state, field).expanded.size).toBe(0);
    expect(value(state, field).sourceRevealed.size).toBe(0);
  });

  it('toggles a frame open and closed, keyed by task position', () => {
    const { field, state } = setup();

    const opened = state.update({
      effects: toggleMetadataFrameEffect.of(1),
    }).state;
    expect(value(opened, field).expanded.has(pos(state, 1))).toBe(true);

    const closed = opened.update({
      effects: toggleMetadataFrameEffect.of(1),
    }).state;
    expect(value(closed, field).expanded.has(pos(opened, 1))).toBe(false);
  });

  it('tracks several expanded frames independently', () => {
    const { field, state } = setup();
    const next = state.update({
      effects: [
        toggleMetadataFrameEffect.of(1),
        toggleMetadataFrameEffect.of(2),
      ],
    }).state;
    expect([...value(next, field).expanded].sort((a, b) => a - b)).toEqual([
      pos(state, 1),
      pos(state, 2),
    ]);
  });

  it('keeps the source reveal independent from the expansion state', () => {
    const { field, state } = setup();
    const next = state.update({
      effects: toggleMetadataFrameSourceEffect.of(1),
    }).state;
    expect(value(next, field).sourceRevealed.has(pos(state, 1))).toBe(true);
    expect(value(next, field).expanded.has(pos(state, 1))).toBe(false);
  });

  it('follows the task when a line is inserted above it', () => {
    const { field, state } = setup();
    const opened = state.update({
      effects: toggleMetadataFrameEffect.of(1),
    }).state;

    // The task moves from line 1 to line 2; its key must move with it.
    const edited = opened.update({
      changes: { from: 0, insert: 'prefix\n' },
    }).state;

    const expanded = value(edited, field).expanded;
    expect(expanded.has(pos(edited, 2))).toBe(true);
    expect(expanded.has(pos(edited, 1))).toBe(false);
  });

  it('returns the same field value when nothing it depends on changed', () => {
    const { field, state } = setup();
    const tr = state.update({});
    // Reusing the value lets CodeMirror skip rebuilding the decoration set.
    expect(tr.state.field(field)).toBe(tr.startState.field(field));
  });
});
