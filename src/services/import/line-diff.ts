/**
 * Aligned line diff used by the import preview.
 *
 * Produces "rows" where each row holds the old (left) and new (right) side of
 * the same position, so the UI can render both sides inside a single grid row
 * and alignment is structurally guaranteed (no scroll synchronisation drift).
 */

export type DiffRowKind = 'equal' | 'add' | 'remove' | 'change';

export interface DiffRow {
  kind: DiffRowKind;
  /** 1-based line number on the old side, or null for a pure insertion. */
  leftLineNumber: number | null;
  /** 1-based line number on the new side, or null for a pure removal. */
  rightLineNumber: number | null;
  leftText: string | null;
  rightText: string | null;
}

type DiffOp = { type: 'equal' | 'delete' | 'insert'; line: string };

/**
 * Beyond this many LCS cells we fall back to a cheaper positional comparison to
 * avoid building a quadratic table for very large files.
 */
const MAX_LCS_CELLS = 2_000_000;

/** Shortest edit script for two line arrays (LCS based). */
export function diffLines(a: string[], b: string[]): DiffOp[] {
  if (a.length * b.length > MAX_LCS_CELLS) {
    return positionalDiff(a, b);
  }

  const n = a.length;
  const m = b.length;
  const table: Uint32Array[] = [];
  for (let i = 0; i <= n; i++) {
    table.push(new Uint32Array(m + 1));
  }
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i][j] =
        a[i] === b[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: 'equal', line: a[i] });
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      ops.push({ type: 'delete', line: a[i] });
      i++;
    } else {
      ops.push({ type: 'insert', line: b[j] });
      j++;
    }
  }
  while (i < n) ops.push({ type: 'delete', line: a[i++] });
  while (j < m) ops.push({ type: 'insert', line: b[j++] });
  return ops;
}

/** Cheap fallback used when the LCS table would be too large. */
function positionalDiff(a: string[], b: string[]): DiffOp[] {
  const ops: DiffOp[] = [];
  const shared = Math.min(a.length, b.length);
  for (let i = 0; i < shared; i++) {
    if (a[i] === b[i]) {
      ops.push({ type: 'equal', line: a[i] });
    } else {
      ops.push({ type: 'delete', line: a[i] });
      ops.push({ type: 'insert', line: b[i] });
    }
  }
  for (let i = shared; i < a.length; i++) {
    ops.push({ type: 'delete', line: a[i] });
  }
  for (let i = shared; i < b.length; i++) {
    ops.push({ type: 'insert', line: b[i] });
  }
  return ops;
}

/**
 * Build aligned rows from two documents. Consecutive removals and insertions
 * are paired index-by-index into `change` rows; any surplus becomes a `remove`
 * or `add` row with an empty opposite side.
 */
export function buildDiffRows(before: string, after: string): DiffRow[] {
  const ops = diffLines(before.split('\n'), after.split('\n'));
  const rows: DiffRow[] = [];
  let leftLine = 1;
  let rightLine = 1;
  let removals: string[] = [];
  let additions: string[] = [];

  const flushBlock = (): void => {
    const size = Math.max(removals.length, additions.length);
    for (let k = 0; k < size; k++) {
      const removed = k < removals.length ? removals[k] : null;
      const added = k < additions.length ? additions[k] : null;
      if (removed !== null && added !== null) {
        rows.push({
          kind: 'change',
          leftLineNumber: leftLine++,
          rightLineNumber: rightLine++,
          leftText: removed,
          rightText: added,
        });
      } else if (removed !== null) {
        rows.push({
          kind: 'remove',
          leftLineNumber: leftLine++,
          rightLineNumber: null,
          leftText: removed,
          rightText: null,
        });
      } else if (added !== null) {
        rows.push({
          kind: 'add',
          leftLineNumber: null,
          rightLineNumber: rightLine++,
          leftText: null,
          rightText: added,
        });
      }
    }
    removals = [];
    additions = [];
  };

  for (const op of ops) {
    if (op.type === 'equal') {
      flushBlock();
      rows.push({
        kind: 'equal',
        leftLineNumber: leftLine++,
        rightLineNumber: rightLine++,
        leftText: op.line,
        rightText: op.line,
      });
    } else if (op.type === 'delete') {
      removals.push(op.line);
    } else {
      additions.push(op.line);
    }
  }
  flushBlock();

  return rows;
}
