import { buildDiffRows, diffLines } from '../src/services/import/line-diff';

describe('diffLines', () => {
  test('marks identical input as all equal', () => {
    const ops = diffLines(['a', 'b', 'c'], ['a', 'b', 'c']);
    expect(ops.every((op) => op.type === 'equal')).toBe(true);
    expect(ops).toHaveLength(3);
  });

  test('detects a single changed line as delete + insert', () => {
    const ops = diffLines(['a', 'b', 'c'], ['a', 'B', 'c']);
    expect(ops.map((op) => op.type)).toEqual([
      'equal',
      'delete',
      'insert',
      'equal',
    ]);
  });

  test('detects pure insertion and deletion', () => {
    expect(
      diffLines(['a', 'c'], ['a', 'b', 'c']).some((o) => o.type === 'insert'),
    ).toBe(true);
    expect(
      diffLines(['a', 'b', 'c'], ['a', 'c']).some((o) => o.type === 'delete'),
    ).toBe(true);
  });

  test('handles an empty old side', () => {
    const ops = diffLines([], ['x', 'y']);
    expect(ops).toEqual([
      { type: 'insert', line: 'x' },
      { type: 'insert', line: 'y' },
    ]);
  });
});

describe('buildDiffRows', () => {
  test('produces equal rows with advancing line numbers', () => {
    const rows = buildDiffRows('a\nb', 'a\nb');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      kind: 'equal',
      leftLineNumber: 1,
      rightLineNumber: 1,
    });
    expect(rows[1]).toMatchObject({
      kind: 'equal',
      leftLineNumber: 2,
      rightLineNumber: 2,
    });
  });

  test('pairs a changed line and advances both sides', () => {
    const rows = buildDiffRows('a\nb\nc', 'a\nB\nc');
    expect(rows.map((r) => r.kind)).toEqual(['equal', 'change', 'equal']);
    expect(rows[1]).toMatchObject({
      leftText: 'b',
      rightText: 'B',
      leftLineNumber: 2,
      rightLineNumber: 2,
    });
    expect(rows[2].rightLineNumber).toBe(3);
  });

  test('produces an add row with no left counterpart', () => {
    const rows = buildDiffRows('a\nc', 'a\nb\nc');
    const added = rows.find((r) => r.kind === 'add');
    expect(added).toMatchObject({
      leftLineNumber: null,
      leftText: null,
      rightText: 'b',
    });
    // Right side advances, left side does not.
    const last = rows[rows.length - 1];
    expect(last.leftLineNumber).toBe(2);
    expect(last.rightLineNumber).toBe(3);
  });

  test('produces a remove row with no right counterpart', () => {
    const rows = buildDiffRows('a\nb\nc', 'a\nc');
    const removed = rows.find((r) => r.kind === 'remove');
    expect(removed).toMatchObject({
      rightLineNumber: null,
      rightText: null,
      leftText: 'b',
    });
  });

  test('pairs an uneven block and gives the surplus its own rows', () => {
    const rows = buildDiffRows('x\n1\n2\n3\ny', 'x\n4\ny');
    expect(rows.map((r) => r.kind)).toEqual([
      'equal',
      'change',
      'remove',
      'remove',
      'equal',
    ]);
    expect(rows[1]).toMatchObject({ leftText: '1', rightText: '4' });
    expect(rows[2]).toMatchObject({ leftText: '2', rightText: null });
    expect(rows[3]).toMatchObject({ leftText: '3', rightText: null });
  });

  test('numbers each side independently after an insertion', () => {
    const rows = buildDiffRows('a\nb', 'a\nnew\nb');
    const last = rows[rows.length - 1];
    expect(last).toMatchObject({
      leftText: 'b',
      rightText: 'b',
      leftLineNumber: 2,
      rightLineNumber: 3,
    });
  });
});
