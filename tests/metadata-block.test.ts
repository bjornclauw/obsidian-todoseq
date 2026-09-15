import {
  resolveFrameVariant,
  scanMetadataBlock,
} from '../src/utils/metadata-block';
import { createTestKeywordManager } from './helpers/test-helper';

function scanLines(
  lines: string[],
  taskLine: number,
  options?: { maxGap?: number },
) {
  return scanMetadataBlock((i: number) => lines[i], taskLine, options);
}

describe('scanMetadataBlock', () => {
  it('returns null when the line after the task is not metadata', () => {
    const result = scanLines(['- [ ] TODO Task', 'Just some text'], 0);
    expect(result).toBeNull();
  });

  it('returns null when there is no line after the task', () => {
    const result = scanLines(['- [ ] TODO Task'], 0);
    expect(result).toBeNull();
  });

  it('spans all six metadata lines', () => {
    const lines = [
      '- [ ] TODO Task',
      '  DESCRIPTION: notes',
      '  CREATED: [2026-09-14 Mon 08:16]',
      '  STARTED: [2026-09-14 Mon 09:09]',
      '  SCHEDULED: <2026-09-14 Mon>',
      '  DEADLINE: <2026-09-16 Wed>',
      '  CLOSED: [2026-09-14 Mon 11:45]',
      '- [ ] TODO Next task',
    ];
    const result = scanLines(lines, 0);
    expect(result).not.toBeNull();
    expect(result?.start).toBe(1);
    expect(result?.end).toBe(6);
    expect(result?.rangeStart).toBe(1);
    expect(result?.metadataCount).toBe(6);
    expect(result?.repeatTitleIndex).toBeNull();
    expect(result?.repeatTotal).toBeNull();
  });

  it('excludes the [!repeats] callout from the frame range', () => {
    const lines = [
      '- [ ] TODO Pay rent',
      '  SCHEDULED: <2026-04-01 Wed +1m>',
      '  > [!repeats]- Repeats: 2 (latest 50)',
      '  > - #2 · closed 2026-03-01 Sun 09:12 · due 2026-03-01 Sun',
      '  > - #1 · closed 2026-02-01 Sat 08:40 · due 2026-02-01 Sat',
    ];
    const result = scanLines(lines, 0);
    expect(result?.start).toBe(1);
    expect(result?.end).toBe(1);
    expect(result?.repeatTitleIndex).toBe(2);
    expect(result?.repeatTotal).toBe(2);
  });

  it('stops the block at a subtask line', () => {
    const lines = [
      '- [ ] TODO Task',
      '  SCHEDULED: <2026-09-14 Mon>',
      '- [ ] TODO Subtask',
      '  DEADLINE: <2026-09-16 Wed>',
    ];
    const result = scanLines(lines, 0);
    expect(result?.start).toBe(1);
    expect(result?.end).toBe(1);
  });

  it('stops the block at a plain text line', () => {
    const lines = [
      '- [ ] TODO Task',
      '  SCHEDULED: <2026-09-14 Mon>',
      'Some paragraph text',
    ];
    const result = scanLines(lines, 0);
    expect(result?.start).toBe(1);
    expect(result?.end).toBe(1);
  });

  it('allows metadata after a blank line within the block', () => {
    const lines = [
      '- [ ] TODO Task',
      '  SCHEDULED: <2026-09-14 Mon>',
      '',
      '  DEADLINE: <2026-09-16 Wed>',
    ];
    const result = scanLines(lines, 0);
    expect(result?.start).toBe(1);
    expect(result?.end).toBe(3);
    expect(result?.metadataCount).toBe(2);
  });

  it('absorbs leading blank lines into the frame range', () => {
    const lines = ['- [ ] TODO Task', '', '  SCHEDULED: <2026-09-14 Mon>'];
    const result = scanLines(lines, 0);
    // start stays on the metadata line; the range extends up to the task so
    // the frame renders without a visible gap.
    expect(result?.start).toBe(2);
    expect(result?.rangeStart).toBe(1);
    expect(result?.end).toBe(2);
    expect(result?.metadataCount).toBe(1);
  });

  it('does not absorb blanks beyond the blank gap limit', () => {
    const lines = [
      '- [ ] TODO Task',
      '',
      '',
      '',
      '  SCHEDULED: <2026-09-14 Mon>',
    ];
    // Three blanks exceed MAX_BLANK_GAP (2): the block is not recognised.
    expect(scanLines(lines, 0)).toBeNull();
  });

  it('caps the block length at maxGap lines', () => {
    const lines = ['- [ ] TODO Task'];
    for (let i = 0; i < 12; i++) {
      lines.push('  SCHEDULED: <2026-09-14 Mon>');
    }
    const result = scanLines(lines, 0, { maxGap: 4 });
    expect(result?.end).toBe(4);
  });

  it('treats quoted metadata as part of the block', () => {
    const lines = [
      '- [ ] TODO Task',
      '> SCHEDULED: <2026-09-14 Mon>',
      '> DESCRIPTION: quoted',
    ];
    const result = scanLines(lines, 0);
    expect(result?.start).toBe(1);
    expect(result?.end).toBe(2);
  });
});

describe('resolveFrameVariant', () => {
  const settings = createTestKeywordManager().getSettings();

  it('uses the active frame for an active task', () => {
    expect(resolveFrameVariant('TODO', null, settings)).toBe('active');
    expect(resolveFrameVariant('DOING', 3, settings)).toBe('active');
  });

  it('uses the completed frame for a completed task', () => {
    expect(resolveFrameVariant('DONE', null, settings)).toBe('completed');
  });

  it('uses the recurring frame for a completed recurring task', () => {
    expect(resolveFrameVariant('DONE', 4, settings)).toBe(
      'recurring-completed',
    );
  });

  it('treats canceled like completed', () => {
    expect(resolveFrameVariant('CANCELED', null, settings)).toBe('completed');
  });
});
