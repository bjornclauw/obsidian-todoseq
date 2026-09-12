import { TaskWriter, TaskComposeFields } from '../src/services/task-writer';
import { TFile } from 'obsidian';
import { KeywordManager } from '../src/utils/keyword-manager';
import { createBaseTask } from './helpers/test-helper';

class MockTFile extends TFile {
  path = 'test.md';
  stat: never = {} as never;
  basename = 'test';
  extension = 'md';
  name = 'test.md';
}

/**
 * In-memory Editor that mirrors Obsidian's position mapping: a line at or past
 * `lineCount` clamps to the end of the document (see Obsidian's `IA` helper).
 */
function createLineEditor(initial: string) {
  let text = initial;
  const getLines = (): string[] => text.split('\n');
  const offsetOf = (pos: { line: number; ch: number }): number => {
    const ls = getLines();
    if (pos.line < 0) return 0;
    if (pos.line >= ls.length) return text.length;
    let offset = 0;
    for (let i = 0; i < pos.line; i++) {
      offset += ls[i].length + 1;
    }
    return Math.min(text.length, offset + pos.ch);
  };
  return {
    getLine: (i: number): string => getLines()[i] ?? '',
    lineCount: (): number => getLines().length,
    getCursor: () => ({ line: 0, ch: 0 }),
    getText: (): string => text,
    setCursor: jest.fn(),
    replaceRange: (
      replacement: string,
      from: { line: number; ch: number },
      to?: { line: number; ch: number },
    ): void => {
      const start = offsetOf(from);
      const end = to ? offsetOf(to) : start;
      text = text.slice(0, start) + replacement + text.slice(end);
    },
  };
}

function makeWriter(initial: string) {
  const editor = createLineEditor(initial);
  const mockApp = {
    vault: {
      getAbstractFileByPath: jest.fn().mockReturnValue(new MockTFile()),
      process: jest.fn(),
    },
    workspace: {
      getActiveViewOfType: jest.fn().mockReturnValue({
        file: { path: 'test.md' },
        editor,
        getViewType: () => 'markdown',
        getMode: () => 'source',
      }),
    },
  };
  const mockPlugin = {
    app: mockApp,
    settings: {
      trackClosedDate: true,
      trackStartedDate: true,
      trackRepeatHistory: true,
      repeatHistoryLimit: 50,
    },
  };
  const writer = new TaskWriter(
    mockPlugin as never,
    new KeywordManager({ additionalInactiveKeywords: [] }),
  );
  return { writer, editor };
}

function fields(overrides: Partial<TaskComposeFields>): TaskComposeFields {
  return {
    text: 'Task',
    state: 'TODO',
    priority: null,
    scheduledDate: null,
    scheduledRepeat: null,
    scheduledWarningPeriod: null,
    deadlineDate: null,
    deadlineRepeat: null,
    deadlineWarningPeriod: null,
    description: null,
    ...overrides,
  };
}

const REPEATER = {
  type: '+' as const,
  unit: 'w' as const,
  value: 1,
  raw: '+1w',
};

describe('TaskWriter editor insertions at end-of-file without trailing newline', () => {
  it('inserts a DEADLINE on its own line after SCHEDULED', async () => {
    const { writer, editor } = makeWriter(
      '- [ ] TODO Task\n  SCHEDULED: <2026-03-10 Tue>',
    );
    const task = createBaseTask({
      rawText: '- [ ] TODO Task',
      listMarker: '- [ ] ',
      text: 'Task',
      state: 'TODO',
      scheduledDate: new Date(2026, 2, 10),
    });

    await writer.updateTaskFields(
      task,
      fields({
        scheduledDate: new Date(2026, 2, 10),
        deadlineDate: new Date(2026, 2, 20),
      }),
      {},
    );

    const lines = editor.getText().split('\n');
    expect(lines).toContain('  SCHEDULED: <2026-03-10 Tue>');
    expect(lines).toContain('  DEADLINE: <2026-03-20 Fri>');
  });

  it('inserts a DESCRIPTION on its own line for a last-line task', async () => {
    const { writer, editor } = makeWriter('- [ ] TODO Task');
    const task = createBaseTask({
      rawText: '- [ ] TODO Task',
      listMarker: '- [ ] ',
      text: 'Task',
      state: 'TODO',
    });

    await writer.updateTaskFields(task, fields({ description: 'notes' }), {});

    const lines = editor.getText().split('\n');
    expect(lines).toContain('- [ ] TODO Task');
    expect(lines).toContain('  DESCRIPTION: notes');
  });

  it('inserts STARTED on its own line for a last-line task', async () => {
    const { writer, editor } = makeWriter('- [ ] TODO Task');
    const task = createBaseTask({
      rawText: '- [ ] TODO Task',
      listMarker: '- [ ] ',
      text: 'Task',
      state: 'TODO',
    });

    await writer.applyLineUpdate(task, 'DOING');

    const lines = editor.getText().split('\n');
    expect(lines).toContain('- [ ] DOING Task');
    expect(lines.some((l) => l.startsWith('  STARTED:'))).toBe(true);
  });

  it('inserts the repeat log on its own lines at end-of-file', async () => {
    const { writer, editor } = makeWriter(
      '- [ ] TODO Pay rent\n  SCHEDULED: <2026-03-10 Tue +1w>',
    );
    const task = createBaseTask({
      rawText: '- [ ] TODO Pay rent',
      listMarker: '- [ ] ',
      text: 'Pay rent',
      state: 'TODO',
      completed: false,
      scheduledDate: new Date(2026, 2, 10),
      scheduledDateRepeat: REPEATER,
    });

    await writer.applyRecurrenceUpdate(task, {
      newScheduledDate: new Date(2026, 2, 17),
      newScheduledRepeat: REPEATER,
      newState: 'TODO',
    });

    const lines = editor.getText().split('\n');
    expect(lines).toContain('  SCHEDULED: <2026-03-17 Tue +1w>');
    expect(lines).toContain('  > [!repeats]- Repeats: 1 (latest 50)');
    expect(lines.some((l) => l.startsWith('  > - #1 · closed'))).toBe(true);
  });
});
