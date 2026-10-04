/**
 * @jest-environment jsdom
 */
import { StateEffect } from '@codemirror/state';
import { installObsidianDomMocks } from './helpers/obsidian-dom-mock';
import { createBaseTask } from './helpers/test-helper';
import {
  FrameSourceToggleWidget,
  FrameWidget,
  toggleMetadataFrameEffect,
  toggleMetadataFrameSourceEffect,
} from '../src/view/editor-extensions/metadata-frame';

installObsidianDomMocks();

function makeView() {
  return {
    state: { doc: { line: () => ({ from: 0 }) } },
    domAtPos: () => {
      throw new Error('not needed in this test');
    },
    contentDOM: { getBoundingClientRect: () => ({ left: 0 }) },
    dispatch: jest.fn(),
  };
}

function makeWidget(
  overrides: Parameters<typeof createBaseTask>[0] = {},
  variant: 'active' | 'completed' | 'recurring-completed' = 'active',
  expanded = false,
) {
  return new FrameWidget({
    variant,
    task: createBaseTask({
      scheduledDate: new Date(2026, 8, 14),
      createdDate: new Date(2026, 8, 10),
      startedDate: new Date(2026, 8, 12),
      ...overrides,
    }),
    taskLine: 1,
    metadataLineCount: 3,
    tooltips: {},
    expanded,
  });
}

/** Normalize a captured dispatch spec's `effects` (single or array) to a list. */
function dispatchedEffects(dispatch: jest.Mock): StateEffect<unknown>[] {
  const spec = dispatch.mock.calls[0][0] as {
    effects?: StateEffect<unknown> | StateEffect<unknown>[];
  };
  return spec.effects
    ? ([] as StateEffect<unknown>[]).concat(spec.effects)
    : [];
}

function render(
  overrides: Parameters<typeof createBaseTask>[0] = {},
  variant: 'active' | 'completed' | 'recurring-completed' = 'active',
  expanded = false,
) {
  const task = createBaseTask({
    scheduledDate: new Date(2026, 8, 14),
    deadlineDate: new Date(2026, 8, 16),
    description: 'Some notes',
    createdDate: new Date(2026, 8, 10),
    startedDate: new Date(2026, 8, 12),
    closedDate: new Date(2026, 8, 14),
    ...overrides,
  });
  const widget = new FrameWidget({
    variant,
    task,
    taskLine: 1,
    metadataLineCount: 3,
    tooltips: {},
    expanded,
  });
  return widget.toDOM(makeView() as never);
}

/** The ordered chip actions rendered in the frame (excludes the source chip). */
function chipActions(frame: HTMLElement): string[] {
  return Array.from(
    frame.querySelectorAll<HTMLElement>('.todoseq-chip[data-todoseq-action]'),
  )
    .map((el) => el.getAttribute('data-todoseq-action') ?? '')
    .filter((action) => action !== 'source');
}

describe('FrameWidget chip order and hidden fields', () => {
  it('shows dates then description, hiding created/started behind the toggle', () => {
    const frame = render();
    expect(chipActions(frame)).toEqual([
      'scheduled',
      'deadline',
      'closed',
      'description',
      'expand',
    ]);
    expect(frame.textContent).toContain('2 hidden');
  });

  it('reveals created/started in fixed order when expanded', () => {
    const frame = render({}, 'active', true);
    expect(chipActions(frame)).toEqual([
      'scheduled',
      'deadline',
      'closed',
      'created',
      'started',
      'description',
      'expand',
    ]);
    expect(frame.textContent).toContain('collapse');
  });

  it('collapses a completed task to CLOSED only', () => {
    const frame = render({}, 'completed', false);
    expect(chipActions(frame)).toEqual(['closed', 'expand']);
  });

  it('expands a completed task in fixed order', () => {
    const frame = render({}, 'completed', true);
    expect(chipActions(frame)).toEqual([
      'scheduled',
      'deadline',
      'closed',
      'created',
      'started',
      'description',
      'expand',
    ]);
  });

  it('keeps the next occurrence and repeat count on a collapsed recurring task', () => {
    const frame = render({ repeatCount: 4 }, 'recurring-completed', false);
    expect(chipActions(frame)).toEqual(['scheduled', 'repeats', 'expand']);
  });

  it('shows a hidden-fields toggle for a task with only CREATED', () => {
    const frame = render(
      {
        scheduledDate: null,
        deadlineDate: null,
        description: undefined,
        startedDate: null,
        closedDate: null,
      },
      'active',
      false,
    );
    expect(chipActions(frame)).toEqual(['expand']);
    expect(frame.textContent).toContain('1 hidden');
  });

  it('counts STARTED toward the hidden fields of an active frame', () => {
    const frame = render(
      {
        scheduledDate: null,
        deadlineDate: null,
        description: undefined,
        createdDate: null,
        closedDate: null,
      },
      'active',
      false,
    );
    expect(chipActions(frame)).toEqual(['expand']);
    expect(frame.textContent).toContain('1 hidden');
  });

  it('shows no hidden-fields toggle when an active frame has nothing collapsed', () => {
    const frame = render(
      {
        createdDate: null,
        startedDate: null,
      },
      'active',
      false,
    );
    expect(chipActions(frame)).not.toContain('expand');
  });
});

describe('FrameWidget identity (eq)', () => {
  it('treats identical payloads as equal so CodeMirror skips re-rendering', () => {
    expect(makeWidget().eq(makeWidget())).toBe(true);
  });

  it('is unequal when a rendered field changes', () => {
    expect(
      makeWidget({ description: 'one' }).eq(makeWidget({ description: 'two' })),
    ).toBe(false);
  });

  it('is unequal when only the source line changes', () => {
    const a = new FrameWidget({
      variant: 'active',
      task: createBaseTask({ scheduledDate: new Date(2026, 8, 14) }),
      taskLine: 1,
      metadataLineCount: 1,
      tooltips: {},
      expanded: false,
    });
    const b = new FrameWidget({
      variant: 'active',
      task: createBaseTask({ scheduledDate: new Date(2026, 8, 14) }),
      taskLine: 2,
      metadataLineCount: 1,
      tooltips: {},
      expanded: false,
    });
    expect(a.eq(b)).toBe(false);
  });

  it('is unequal when the expansion state changes', () => {
    expect(
      makeWidget({}, 'active', false).eq(makeWidget({}, 'active', true)),
    ).toBe(false);
  });
});

describe('FrameWidget work chip', () => {
  function workWidget(overrides: Parameters<typeof createBaseTask>[0] = {}) {
    return new FrameWidget({
      variant: 'active',
      task: createBaseTask({
        scheduledDate: new Date(2026, 8, 14),
        ...overrides,
      }),
      taskLine: 1,
      metadataLineCount: 1,
      tooltips: {},
      expanded: false,
      workLogEnabled: true,
    });
  }

  it('shows a play chip with the running total when stopped', () => {
    const frame = workWidget({ workLogTotalMinutes: 195 }).toDOM(
      makeView() as never,
    );
    expect(
      frame.querySelector('[data-todoseq-action="work-start"]'),
    ).not.toBeNull();
    expect(frame.textContent).toContain('3h 15m');
  });

  it('shows a pause chip with elapsed and total while running', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 8, 14, 10, 2));
    const widget = workWidget({
      timerStart: new Date(2026, 8, 14, 9, 32),
      workLogTotalMinutes: 60,
    });
    const frame = widget.toDOM(makeView() as never);

    expect(
      frame.querySelector('[data-todoseq-action="work-pause"]'),
    ).not.toBeNull();
    expect(frame.textContent).toContain('30m');
    expect(frame.textContent).toContain('1h');

    widget.destroy();
    jest.useRealTimers();
  });

  it('shows no work chip when work logging is off', () => {
    const frame = makeWidget({ workLogTotalMinutes: 195 }).toDOM(
      makeView() as never,
    );
    expect(
      frame.querySelector('[data-todoseq-action="work-start"]'),
    ).toBeNull();
  });
});

describe('FrameWidget chip effects', () => {
  it('dispatches the expand effect with the task line on the expand chip', () => {
    const view = makeView();
    const frame = makeWidget().toDOM(view as never);
    const expand = frame.querySelector<HTMLElement>(
      '[data-todoseq-action="expand"]',
    );
    expect(expand).not.toBeNull();

    expand?.dispatchEvent(new MouseEvent('click'));

    expect(view.dispatch).toHaveBeenCalledTimes(1);
    const effects = dispatchedEffects(view.dispatch);
    expect(effects).toHaveLength(1);
    expect(effects[0].is(toggleMetadataFrameEffect)).toBe(true);
    expect(effects[0].value).toBe(1);
  });

  it('dispatches the source effect with the task line on the source chip', () => {
    const view = makeView();
    const frame = makeWidget().toDOM(view as never);
    const source = frame.querySelector<HTMLElement>(
      '[data-todoseq-action="source"]',
    );
    expect(source).not.toBeNull();

    source?.dispatchEvent(new MouseEvent('click'));

    expect(view.dispatch).toHaveBeenCalledTimes(1);
    const effects = dispatchedEffects(view.dispatch);
    expect(effects).toHaveLength(1);
    expect(effects[0].is(toggleMetadataFrameSourceEffect)).toBe(true);
    expect(effects[0].value).toBe(1);
  });

  it('restores the frame from the inline source-toggle widget', () => {
    const view = makeView();
    const widget = new FrameSourceToggleWidget(7, true);
    const el = widget.toDOM(view as never);

    el.dispatchEvent(new MouseEvent('click'));

    expect(view.dispatch).toHaveBeenCalledTimes(1);
    const effects = dispatchedEffects(view.dispatch);
    expect(effects[0].is(toggleMetadataFrameSourceEffect)).toBe(true);
    expect(effects[0].value).toBe(7);
  });
});

describe('FrameWidget photo chip', () => {
  const renderPhoto = (payload: {
    photo?: string;
    photoSrc?: string;
    photosEnabled?: boolean;
  }) => {
    const widget = new FrameWidget({
      variant: 'active',
      task: createBaseTask({
        scheduledDate: new Date(2026, 8, 14),
        photo: payload.photo,
      }),
      taskLine: 1,
      metadataLineCount: 1,
      tooltips: {},
      expanded: false,
      photosEnabled: payload.photosEnabled,
      photoSrc: payload.photoSrc,
    });
    return widget.toDOM(makeView() as never);
  };

  it('renders a thumbnail chip when a photo is present', () => {
    const frame = renderPhoto({
      photo: '![[img.webp]]',
      photoSrc: 'app://local/img.webp',
    });
    const chip = frame.querySelector<HTMLElement>(
      '[data-todoseq-action="photo"]',
    );
    expect(chip).not.toBeNull();
    expect(chip?.getAttribute('data-todoseq-photo')).toBe('![[img.webp]]');
    const img = chip?.querySelector('img');
    expect(img?.getAttribute('src')).toBe('app://local/img.webp');
  });

  it('renders an add-photo chip when enabled and no photo exists', () => {
    const frame = renderPhoto({ photosEnabled: true });
    expect(
      frame.querySelector('[data-todoseq-action="photo-add"]'),
    ).not.toBeNull();
    expect(frame.querySelector('[data-todoseq-action="photo"]')).toBeNull();
  });

  it('renders no photo chip when disabled', () => {
    const frame = renderPhoto({ photosEnabled: false });
    expect(frame.querySelector('[data-todoseq-action="photo-add"]')).toBeNull();
    expect(frame.querySelector('[data-todoseq-action="photo"]')).toBeNull();
  });

  it('moves the description under the photo and keeps it interactive', () => {
    const widget = new FrameWidget({
      variant: 'active',
      task: createBaseTask({
        scheduledDate: new Date(2026, 8, 14),
        description: 'Some notes',
        photo: '![[img.webp]]',
      }),
      taskLine: 1,
      metadataLineCount: 2,
      tooltips: {},
      expanded: false,
      photoSrc: 'app://local/img.webp',
    });
    const frame = widget.toDOM(makeView() as never);

    // No description chip in the chip row...
    expect(
      frame.querySelector(
        '.todoseq-frame-chips [data-todoseq-action="description"]',
      ),
    ).toBeNull();
    // ...but an interactive description chip under the photo.
    const desc = frame.querySelector<HTMLElement>('.todoseq-frame-photo-desc');
    expect(desc).not.toBeNull();
    expect(desc?.getAttribute('data-todoseq-action')).toBe('description');
    expect(desc?.querySelector('.todoseq-chip-icon')).not.toBeNull();
  });
});
