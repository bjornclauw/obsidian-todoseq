import { EditorState, RangeSetBuilder, StateField } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView } from '@codemirror/view';
import { editorLivePreviewField } from 'obsidian';
import { TaskParser } from '../../parser/task-parser';
import { TodoTrackerSettings } from '../../settings/settings-types';
import {
  resolveFrameVariant,
  scanMetadataBlock,
} from '../../utils/metadata-block';
import { isTaskMetadataLine } from '../../utils/task-metadata';
import { isTableRow } from '../../utils/task-line-utils';
import {
  FramePayload,
  FrameSourceToggleWidget,
  FrameWidget,
  toggleMetadataFrameEffect,
  toggleMetadataFrameSourceEffect,
} from './metadata-frame';

/** Value stored in the metadata frame state field. */
export interface MetadataFrameFieldValue {
  /** Block replace decorations for every visible frame. */
  decorations: DecorationSet;
  /** 1-based line numbers hidden by a frame (skipped by the ViewPlugin). */
  blockedLines: ReadonlySet<number>;
  /** Expanded frame keys (1-based task line numbers), per editor state. */
  expanded: ReadonlySet<string>;
  /** Keys whose raw metadata is revealed instead of framed. */
  sourceRevealed: ReadonlySet<string>;
}

/** Minimal document shape the frame computation needs (CodeMirror Text fits). */
export interface FrameDoc {
  lines: number;
  length: number;
  line(number: number): { from: number; to: number; text: string };
}

export interface FrameComputationInput {
  doc: FrameDoc;
  expanded: ReadonlySet<string>;
  sourceRevealed: ReadonlySet<string>;
  livePreview: boolean;
  settings: TodoTrackerSettings;
  parser: TaskParser | null;
  getPath: () => string | null;
}

/**
 * Build the block-replace decorations for all metadata frames in the document.
 *
 * Block decorations may not be provided by ViewPlugins, so this runs inside a
 * StateField (see {@link createMetadataFrameField}). The function is exported
 * so the range-ordering and variant behaviour can be unit-tested with a fake
 * document.
 */
export function computeMetadataFrameDecorations(
  input: FrameComputationInput,
): MetadataFrameFieldValue {
  const { doc, settings, parser } = input;
  const blockedLines = new Set<number>();
  const builder = new RangeSetBuilder<Decoration>();

  if (
    !settings.metadataFrame ||
    !settings.formatTaskKeywords ||
    !parser ||
    !input.livePreview
  ) {
    return {
      decorations: Decoration.none,
      blockedLines,
      expanded: input.expanded,
      sourceRevealed: input.sourceRevealed,
    };
  }

  const lines = new Array<string>(doc.lines);
  for (let i = 0; i < doc.lines; i++) {
    lines[i] = doc.line(i + 1).text;
  }

  for (let lineNumber = 1; lineNumber <= doc.lines; lineNumber++) {
    const lineText = lines[lineNumber - 1];
    if (!lineText || lineText.trim() === '') {
      continue;
    }

    const firstBelow = lines[lineNumber];
    if (firstBelow === undefined) {
      continue;
    }
    if (firstBelow.trim() !== '' && !isTaskMetadataLine(firstBelow)) {
      continue;
    }

    // Skip lines that are inside a code block, quote/callout, comment or
    // table row: frames only apply to plain list/heading tasks.
    if (
      isTableRow(lineText) ||
      lineText.trimStart().startsWith('>') ||
      lineText.trimStart().startsWith('%%')
    ) {
      continue;
    }

    const scan = scanMetadataBlock((i) => lines[i], lineNumber - 1);
    if (!scan) {
      continue;
    }

    const task = parser.parseTaskBlock(
      lines,
      lineNumber - 1,
      input.getPath() ?? '',
    );
    if (!task) {
      continue;
    }

    const variant = resolveFrameVariant(task.state, scan.repeatTotal, settings);
    if (
      variant === 'active' &&
      !task.scheduledDate &&
      !task.deadlineDate &&
      !task.description &&
      !task.startedDate &&
      !task.createdDate
    ) {
      continue;
    }

    // The source toggle reveals the raw metadata for this task. When
    // revealed, no frame is rendered and the per-line styling applies as
    // before; a small toggle widget on the task line brings the frame back.
    if (input.sourceRevealed.has(String(lineNumber))) {
      builder.add(
        doc.line(lineNumber).to,
        doc.line(lineNumber).to,
        Decoration.widget({
          widget: new FrameSourceToggleWidget(lineNumber, true),
          side: 1,
        }),
      );
      continue;
    }

    const tooltips: FramePayload['tooltips'] = {};
    for (let i = scan.start; i <= scan.end; i++) {
      const raw = (lines[i] ?? '').trim();
      if (raw.startsWith('DESCRIPTION:')) {
        tooltips.description = raw;
      } else if (raw.startsWith('SCHEDULED:')) {
        tooltips.scheduled = raw;
      } else if (raw.startsWith('DEADLINE:')) {
        tooltips.deadline = raw;
      } else if (raw.startsWith('STARTED:')) {
        tooltips.started = raw;
      } else if (raw.startsWith('CLOSED:')) {
        tooltips.closed = raw;
      }
    }
    if (scan.repeatTitleIndex !== null) {
      tooltips.repeatLog = (lines[scan.repeatTitleIndex] ?? '').trim();
    }

    const firstMeta = doc.line(scan.rangeStart + 1);
    const lastMeta = doc.line(scan.end + 1);

    const widget = new FrameWidget({
      variant,
      task,
      taskLine: lineNumber,
      metadataLineCount: scan.metadataCount,
      tooltips,
      expanded: input.expanded.has(String(lineNumber)),
    });

    builder.add(
      firstMeta.from,
      lastMeta.to,
      // NOTE: no `inclusive: false` here. For block replacements that makes
      // CodeMirror open an empty line above the widget (startSide becomes
      // positive -> BlockAfter handling), which shows up as a blank line
      // between the task and the frame. The block default is inclusive.
      Decoration.replace({ widget, block: true }),
    );

    for (let i = scan.rangeStart + 1; i <= scan.end + 1; i++) {
      blockedLines.add(i);
    }
  }

  return {
    decorations: builder.finish(),
    blockedLines,
    expanded: input.expanded,
    sourceRevealed: input.sourceRevealed,
  };
}

function isLivePreview(state: EditorState): boolean {
  try {
    const field = editorLivePreviewField as StateField<boolean> | undefined;
    if (!field) {
      return false;
    }
    return state.field(field, false) === true;
  } catch {
    // Obsidian's field is unavailable (tests, non-markdown editors).
    return false;
  }
}

/**
 * State field that renders the virtual metadata frames.
 *
 * Block decorations must come from state-level decoration sources, so the
 * frames live here rather than in the task formatting ViewPlugin.
 */
export function createMetadataFrameField(
  settings: TodoTrackerSettings,
  getParser: () => TaskParser | null,
  getPath: () => string | null,
): StateField<MetadataFrameFieldValue> {
  const field: StateField<MetadataFrameFieldValue> = StateField.define({
    create(state) {
      return computeMetadataFrameDecorations({
        doc: state.doc,
        expanded: new Set<string>(),
        sourceRevealed: new Set<string>(),
        livePreview: isLivePreview(state),
        settings,
        parser: getParser(),
        getPath,
      });
    },
    update(value, tr) {
      let expanded = value.expanded;
      let sourceRevealed = value.sourceRevealed;
      let toggled = false;

      for (const effect of tr.effects) {
        if (effect.is(toggleMetadataFrameEffect)) {
          expanded = toggleKey(expanded, effect.value);
          toggled = true;
        }
        if (effect.is(toggleMetadataFrameSourceEffect)) {
          sourceRevealed = toggleKey(sourceRevealed, effect.value);
          toggled = true;
        }
      }

      if (tr.docChanged || toggled) {
        return computeMetadataFrameDecorations({
          doc: tr.state.doc,
          expanded,
          sourceRevealed,
          livePreview: isLivePreview(tr.state),
          settings,
          parser: getParser(),
          getPath,
        });
      }
      return value;
    },
    provide: (f) =>
      EditorView.decorations.from(f, (value) => value.decorations),
  });

  return field;
}

/** Return a copy of `keys` with `key` added or removed. */
function toggleKey(keys: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(keys);
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }
  return next;
}
