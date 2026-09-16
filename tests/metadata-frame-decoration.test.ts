import { TaskParser } from '../src/parser/task-parser';
import { TaskKeywordDecorator } from '../src/view/editor-extensions/task-formatting';
import {
  computeMetadataFrameDecorations,
  FrameDoc,
} from '../src/view/editor-extensions/metadata-frame-field';
import {
  FrameSourceToggleWidget,
  FrameWidget,
} from '../src/view/editor-extensions/metadata-frame';
import { createTestKeywordManager } from './helpers/test-helper';
import { DefaultSettings } from '../src/settings/settings-types';
import { DecorationSet } from '@codemirror/view';

interface FakeLine {
  number: number;
  from: number;
  to: number;
  text: string;
}

function makeFakeDoc(text: string): FrameDoc {
  const rawLines = text.split('\n');
  let offset = 0;
  const infos: FakeLine[] = rawLines.map((t, i) => {
    const from = offset;
    const to = from + t.length;
    offset = to + 1;
    return { number: i + 1, from, to, text: t };
  });
  return {
    lines: infos.length,
    length: text.length,
    line: (n: number) => infos[n - 1],
  };
}

function compute(text: string, sourceRevealedLines: number[] = []) {
  const doc = makeFakeDoc(text);
  const settings = { ...DefaultSettings, metadataFrame: true };
  const parser = TaskParser.create(
    createTestKeywordManager(settings),
    null as never,
    undefined,
    settings,
  );
  return computeMetadataFrameDecorations({
    doc,
    expanded: new Set<number>(),
    sourceRevealed: new Set(
      sourceRevealedLines.map((line) => doc.line(line).from),
    ),
    livePreview: true,
    settings,
    parser,
    getPath: () => 'test.md',
  });
}

function collectWidgets(decorations: DecorationSet): FrameWidget[] {
  const widgets: FrameWidget[] = [];
  decorations.between(0, 1e9, (_from, _to, value) => {
    const widget = value.spec.widget;
    if (widget instanceof FrameWidget) {
      widgets.push(widget);
    }
  });
  return widgets;
}

function collectSourceToggles(
  decorations: DecorationSet,
): FrameSourceToggleWidget[] {
  const widgets: FrameSourceToggleWidget[] = [];
  decorations.between(0, 1e9, (_from, _to, value) => {
    const widget = value.spec.widget;
    if (widget instanceof FrameSourceToggleWidget) {
      widgets.push(widget);
    }
  });
  return widgets;
}

/** Collect the block replace decorations (the frames themselves). */
function collectFrameDecorations(
  decorations: DecorationSet,
): Array<{ startSide: number; from: number; to: number }> {
  const found: Array<{ startSide: number; from: number; to: number }> = [];
  decorations.between(0, 1e9, (from, to, value) => {
    if (value.spec.widget instanceof FrameWidget) {
      found.push({ startSide: value.startSide, from, to });
    }
  });
  return found;
}

describe('computeMetadataFrameDecorations', () => {
  it('renders a frame for a task with a full metadata block', () => {
    const text = [
      '- [ ] TODO Task',
      '  DESCRIPTION: notes',
      '  CREATED: [2026-09-14 Mon 08:16]',
      '  STARTED: [2026-09-14 Mon 09:09]',
      '  SCHEDULED: <2026-09-14 Mon>',
      '  DEADLINE: <2026-09-16 Wed>',
      '  CLOSED: [2026-09-14 Mon 11:45]',
      '',
      'After',
    ].join('\n');

    const { decorations, blockedLines } = compute(text);
    expect(collectWidgets(decorations)).toHaveLength(1);
    // Lines 2..7 (1-based) are hidden by the frame.
    expect([...blockedLines].sort((a, b) => a - b)).toEqual([2, 3, 4, 5, 6, 7]);
  });

  it('emits frames for consecutive task blocks', () => {
    const text = [
      '- [ ] TODO First',
      '  SCHEDULED: <2026-09-14 Mon>',
      '- [ ] TODO Second',
      '  DEADLINE: <2026-09-16 Wed>',
      '',
      'After',
    ].join('\n');

    expect(collectWidgets(compute(text).decorations)).toHaveLength(2);
  });

  it('excludes the [!repeats] callout from the hidden lines', () => {
    const text = [
      '- [ ] TODO Pay rent',
      '  SCHEDULED: <2026-04-01 Wed +1m>',
      '  > [!repeats]- Repeats: 2 (latest 50)',
      '  > - #2 · closed 2026-03-01 Sun 09:12 · due 2026-03-01 Sun',
    ].join('\n');

    const { decorations, blockedLines } = compute(text);
    expect(collectWidgets(decorations)).toHaveLength(1);
    expect([...blockedLines]).toEqual([2]);
  });

  it('absorbs a leading blank line so the frame hugs the task', () => {
    const text = ['- [ ] TODO Task', '', '  SCHEDULED: <2026-09-14 Mon>'].join(
      '\n',
    );

    const { decorations, blockedLines } = compute(text);
    expect(collectWidgets(decorations)).toHaveLength(1);
    // The blank line (2) and the metadata line (3) are both hidden.
    expect([...blockedLines].sort((a, b) => a - b)).toEqual([2, 3]);
  });

  it('uses an inclusive block replace so CodeMirror adds no empty line', () => {
    // A block replace with `inclusive: false` gets a positive startSide, which
    // makes CodeMirror open an empty line above the widget (visible as a blank
    // line between the task and the frame).
    const text = ['- [ ] TODO Task', '  SCHEDULED: <2026-09-14 Mon>'].join(
      '\n',
    );

    const frames = collectFrameDecorations(compute(text).decorations);
    expect(frames).toHaveLength(1);
    expect(frames[0].startSide).toBeLessThan(0);
  });

  it('reveals the raw block when the source is toggled', () => {
    const text = ['- [ ] TODO Task', '  SCHEDULED: <2026-09-14 Mon>'].join(
      '\n',
    );

    const { decorations, blockedLines } = compute(text, [1]);
    // No frame, nothing hidden, and a toggle widget to restore the frame.
    expect(collectWidgets(decorations)).toHaveLength(0);
    expect(blockedLines.size).toBe(0);
    expect(collectSourceToggles(decorations)).toHaveLength(1);
  });

  it('renders a frame for a task whose only metadata is CREATED', () => {
    const text = [
      '- [ ] TODO Checklist maken',
      '  CREATED: [2026-09-14 Mon 00:21]',
    ].join('\n');

    const { decorations, blockedLines } = compute(text);
    expect(collectWidgets(decorations)).toHaveLength(1);
    expect([...blockedLines]).toEqual([2]);
  });

  it('does not frame in source mode', () => {
    const text = ['- [ ] TODO Task', '  SCHEDULED: <2026-09-14 Mon>'].join(
      '\n',
    );
    const settings = { ...DefaultSettings, metadataFrame: true };
    const parser = TaskParser.create(
      createTestKeywordManager(settings),
      null as never,
      undefined,
      settings,
    );

    const { decorations } = computeMetadataFrameDecorations({
      doc: makeFakeDoc(text),
      expanded: new Set<number>(),
      sourceRevealed: new Set<number>(),
      livePreview: false,
      settings,
      parser,
      getPath: () => 'test.md',
    });
    expect(collectWidgets(decorations)).toHaveLength(0);
  });

  it('does not frame when the metadata frame setting is off', () => {
    const text = ['- [ ] TODO Task', '  SCHEDULED: <2026-09-14 Mon>'].join(
      '\n',
    );
    const settings = { ...DefaultSettings, metadataFrame: false };
    const parser = TaskParser.create(
      createTestKeywordManager(settings),
      null as never,
      undefined,
      settings,
    );

    const { decorations } = computeMetadataFrameDecorations({
      doc: makeFakeDoc(text),
      expanded: new Set<number>(),
      sourceRevealed: new Set<number>(),
      livePreview: true,
      settings,
      parser,
      getPath: () => 'test.md',
    });
    expect(collectWidgets(decorations)).toHaveLength(0);
  });
});

describe('TaskKeywordDecorator frame suppression', () => {
  it('skips per-line decorations on lines hidden by a frame', () => {
    const text = [
      '- [ ] TODO Task',
      '  SCHEDULED: <2026-09-14 Mon>',
      '  DEADLINE: <2026-09-16 Wed>',
    ].join('\n');
    const doc = makeFakeDoc(text);
    const settings = { ...DefaultSettings, metadataFrame: true };
    const parser = TaskParser.create(
      createTestKeywordManager(settings),
      null as never,
      undefined,
      settings,
    );

    const fakeView = {
      state: {
        doc,
        selection: { main: { from: 0, to: 0, head: 0 } },
        // Pretend the frame field hides lines 2 and 3.
        field: () => ({ blockedLines: new Set([2, 3]) }),
      },
      dom: { parentElement: { classList: { contains: () => true } } },
    };

    const decorator = new TaskKeywordDecorator(
      fakeView as never,
      settings,
      parser,
      {} as never,
    );

    const classes: string[] = [];
    decorator.getDecorations().between(0, 1e9, (_f, _t, value) => {
      const cls = value.spec.class;
      if (typeof cls === 'string') classes.push(cls);
    });

    expect(classes.some((c) => c.includes('todoseq-scheduled-line'))).toBe(
      false,
    );
    expect(classes.some((c) => c.includes('todoseq-deadline-line'))).toBe(
      false,
    );
    // The task keyword on line 1 is still decorated.
    expect(classes.some((c) => c.includes('todoseq-keyword-formatted'))).toBe(
      true,
    );
  });
});
