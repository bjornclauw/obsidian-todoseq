import { TaskWriter } from '../src/services/task-writer';
import { Task } from '../src/types/task';
import { TFile } from 'obsidian';
import { KeywordManager } from '../src/utils/keyword-manager';
import { createBaseTask } from './helpers/test-helper';

class MockTFile extends TFile {
  constructor() {
    super();
  }
  path = 'test.md';
  stat: never = {} as never;
  basename = 'test';
  extension = 'md';
  name = 'test.md';
}

/** Minimal in-memory Editor whose replaceRange mutates the buffer. */
function createLineEditor(initial: string[]) {
  let text = initial.join('\n');
  const getLines = (): string[] => text.split('\n');
  const offsetOf = (pos: { line: number; ch: number }): number => {
    const ls = getLines();
    let offset = 0;
    for (let i = 0; i < pos.line && i < ls.length; i++) {
      offset += ls[i].length + 1;
    }
    return offset + pos.ch;
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

const REPEATER = {
  type: '+' as const,
  unit: 'w' as const,
  value: 1,
  raw: '+1w',
};

describe('TaskWriter - recurring completion log', () => {
  let mockApp: {
    vault: { getAbstractFileByPath: jest.Mock; process: jest.Mock };
    workspace: { getActiveViewOfType: jest.Mock };
  };
  let mockPlugin: { app: typeof mockApp; settings: Record<string, unknown> };
  let writer: TaskWriter;

  beforeEach(() => {
    mockApp = {
      vault: {
        getAbstractFileByPath: jest.fn().mockReturnValue(new MockTFile()),
        process: jest.fn().mockResolvedValue(''),
      },
      workspace: {
        getActiveViewOfType: jest.fn().mockReturnValue(undefined),
      },
    };
    mockPlugin = {
      app: mockApp,
      settings: {
        trackClosedDate: true,
        trackStartedDate: false,
        trackRepeatHistory: true,
        repeatHistoryLimit: 3,
      },
    };
    writer = new TaskWriter(
      mockPlugin as never,
      new KeywordManager({ additionalInactiveKeywords: [] }),
    );
  });

  function setupVaultProcess(initialContent: string): () => string {
    let written = '';
    mockApp.vault.process = jest
      .fn()
      .mockImplementation(
        (
          _file: unknown,
          updateFn: (content: string) => string,
        ): Promise<string> => {
          written = updateFn(initialContent);
          return Promise.resolve(written);
        },
      );
    return () => written;
  }

  function recurringTask(overrides: Partial<Task> = {}): Task {
    return createBaseTask({
      rawText: 'DONE Pay rent',
      state: 'DONE',
      completed: true,
      scheduledDate: new Date(2026, 2, 10),
      scheduledDateRepeat: REPEATER,
      ...overrides,
    });
  }

  it('creates the callout on the first recurring completion and removes CLOSED', async () => {
    const getContent = setupVaultProcess(
      'DONE Pay rent\n  CLOSED: [2026-03-09 Mon 08:00]\n  SCHEDULED: <2026-03-10 Tue +1w>',
    );

    const result = await writer.applyRecurrenceUpdate(recurringTask(), {
      newScheduledDate: new Date(2026, 2, 17),
      newScheduledRepeat: REPEATER,
      newState: 'TODO',
    });

    const content = getContent();
    expect(content).toContain('> [!repeats]- Repeats: 1 (latest 3)');
    expect(content).toMatch(
      /> - #1 · closed \d{4}-\d{2}-\d{2} \w{3} \d{2}:\d{2}/,
    );
    expect(content).toContain('· due 2026-03-10 Tue');
    expect(content).not.toContain('CLOSED:');
    expect(result.repeatCount).toBe(1);
  });

  it('prepends a new entry and increments the total from the title', async () => {
    const getContent = setupVaultProcess(
      [
        'DONE Pay rent',
        '  SCHEDULED: <2026-03-10 Tue +1w>',
        '  > [!repeats]- Repeats: 4 (latest 3)',
        '  > - #4 · closed 2026-03-01 Sun 09:12 · due 2026-03-01 Sun',
        '  > - #3 · closed 2026-02-01 Sat 08:40 · due 2026-02-01 Sat',
      ].join('\n'),
    );

    const result = await writer.applyRecurrenceUpdate(
      recurringTask({ repeatCount: 4 }),
      {
        newScheduledDate: new Date(2026, 2, 17),
        newScheduledRepeat: REPEATER,
        newState: 'TODO',
      },
    );

    const content = getContent();
    expect(content).toContain('Repeats: 5 (latest 3)');
    expect(content).toContain('#5 · closed');
    expect(content).toContain('#4 · closed');
    expect(content).toContain('#3 · closed');
    expect(result.repeatCount).toBe(5);

    // Newest first: #5 appears before #4.
    expect(content.indexOf('#5 · closed')).toBeLessThan(
      content.indexOf('#4 · closed'),
    );
  });

  it('truncates entries to the configured limit while keeping numbering', async () => {
    mockPlugin.settings.repeatHistoryLimit = 2;
    const getContent = setupVaultProcess(
      [
        'DONE Pay rent',
        '  SCHEDULED: <2026-03-10 Tue +1w>',
        '  > [!repeats]- Repeats: 9 (latest 2)',
        '  > - #9 · closed 2026-03-01 Sun 09:12 · due 2026-03-01 Sun',
        '  > - #8 · closed 2026-02-01 Sat 08:40 · due 2026-02-01 Sat',
        '  > - #7 · closed 2026-01-01 Thu 08:40 · due 2026-01-01 Thu',
      ].join('\n'),
    );

    const result = await writer.applyRecurrenceUpdate(
      recurringTask({ repeatCount: 9 }),
      {
        newScheduledDate: new Date(2026, 2, 17),
        newScheduledRepeat: REPEATER,
        newState: 'TODO',
      },
    );

    const content = getContent();
    expect(content).toContain('Repeats: 10 (latest 2)');
    expect(content).toContain('#10 · closed');
    expect(content).toContain('#9 · closed');
    expect(content).not.toContain('#8 · closed');
    expect(content).not.toContain('#7 · closed');
    expect(result.repeatCount).toBe(10);
  });

  it('skips the log for table-cell tasks', async () => {
    const getContent = setupVaultProcess(
      'DONE Pay rent\n  SCHEDULED: <2026-03-10 Tue +1w>',
    );

    await writer.applyRecurrenceUpdate(
      recurringTask({ isTableTask: true, tableCell: { cellIndex: 1 } }),
      {
        newScheduledDate: new Date(2026, 2, 17),
        newScheduledRepeat: REPEATER,
        newState: 'TODO',
      },
    );

    expect(getContent()).not.toContain('[!repeats]');
  });

  it('leaves CLOSED untouched and writes no log when repeat history is disabled', async () => {
    mockPlugin.settings.trackRepeatHistory = false;
    const getContent = setupVaultProcess(
      'DONE Pay rent\n  CLOSED: [2026-03-09 Mon 08:00]\n  SCHEDULED: <2026-03-10 Tue +1w>',
    );

    await writer.applyRecurrenceUpdate(recurringTask(), {
      newScheduledDate: new Date(2026, 2, 17),
      newScheduledRepeat: REPEATER,
      newState: 'TODO',
    });

    const content = getContent();
    expect(content).toContain('CLOSED: [2026-03-09 Mon 08:00]');
    expect(content).not.toContain('[!repeats]');
  });

  it('preserves the blank line after the log when appending via the editor', async () => {
    const lines = [
      '- [ ] TODO Pay rent',
      '  SCHEDULED: <2026-03-10 Tue +1w>',
      '  > [!repeats]- Repeats: 1 (latest 3)',
      '  > - #1 · closed 2026-03-01 Sun 09:12 · due 2026-03-01 Sun',
      '',
      'Some paragraph',
    ];
    const editor = createLineEditor(lines);
    mockApp.workspace.getActiveViewOfType = jest.fn().mockReturnValue({
      file: { path: 'test.md' },
      editor,
      getViewType: () => 'markdown',
      getMode: () => 'source',
    });

    await writer.applyRecurrenceUpdate(
      createBaseTask({
        rawText: '- [ ] TODO Pay rent',
        listMarker: '- [ ] ',
        text: 'Pay rent',
        state: 'TODO',
        completed: false,
        scheduledDate: new Date(2026, 2, 10),
        scheduledDateRepeat: REPEATER,
        repeatCount: 1,
      }),
      {
        newScheduledDate: new Date(2026, 2, 17),
        newScheduledRepeat: REPEATER,
        newState: 'TODO',
      },
    );

    const result = editor.getText();
    const out = result.split('\n');
    expect(result).toContain('Repeats: 2 (latest 3)');
    expect(result).toContain('#2 · closed');
    expect(result).toContain('#1 · closed');
    // The blank line and the paragraph below must survive untouched.
    expect(out).toContain('');
    expect(out[out.length - 1]).toBe('Some paragraph');
    expect(out[out.length - 2]).toBe('');
  });

  it('reuses an existing log across a blank line and removes the blank', async () => {
    const getContent = setupVaultProcess(
      [
        'DONE Pay rent',
        '  SCHEDULED: <2026-03-10 Tue +1w>',
        '',
        '  > [!repeats]- Repeats: 2 (latest 3)',
        '  > - #2 · closed 2026-02-01 Sat 08:40 · due 2026-02-01 Sat',
        '  > - #1 · closed 2026-01-01 Thu 08:40 · due 2026-01-01 Thu',
      ].join('\n'),
    );

    const result = await writer.applyRecurrenceUpdate(
      recurringTask({ repeatCount: 2 }),
      {
        newScheduledDate: new Date(2026, 2, 17),
        newScheduledRepeat: REPEATER,
        newState: 'TODO',
      },
    );

    const content = getContent();
    expect((content.match(/\[!repeats\]/g) || []).length).toBe(1);
    expect(content).toContain('Repeats: 3 (latest 3)');
    expect(content).toContain('#3 · closed');
    expect(content).toContain('#2 · closed');
    expect(content).toContain('#1 · closed');
    expect(content).not.toContain('\n\n');
    expect(result.repeatCount).toBe(3);
  });

  it('removes a blank line in the metadata block when adding the first log', async () => {
    const getContent = setupVaultProcess(
      'DONE Pay rent\n\n  SCHEDULED: <2026-03-10 Tue +1w>',
    );

    await writer.applyRecurrenceUpdate(recurringTask(), {
      newScheduledDate: new Date(2026, 2, 17),
      newScheduledRepeat: REPEATER,
      newState: 'TODO',
    });

    const content = getContent();
    expect(content).not.toContain('\n\n');
    expect(content).toContain('> [!repeats]- Repeats: 1 (latest 3)');
  });

  it('removes the blank line above an existing log via the editor', async () => {
    const editor = createLineEditor([
      '- [ ] TODO Pay rent',
      '  SCHEDULED: <2026-03-10 Tue +1w>',
      '',
      '  > [!repeats]- Repeats: 1 (latest 3)',
      '  > - #1 · closed 2026-03-01 Sun 09:12 · due 2026-03-01 Sun',
    ]);
    mockApp.workspace.getActiveViewOfType = jest.fn().mockReturnValue({
      file: { path: 'test.md' },
      editor,
      getViewType: () => 'markdown',
      getMode: () => 'source',
    });

    await writer.applyRecurrenceUpdate(
      createBaseTask({
        rawText: '- [ ] TODO Pay rent',
        listMarker: '- [ ] ',
        text: 'Pay rent',
        state: 'TODO',
        completed: false,
        scheduledDate: new Date(2026, 2, 10),
        scheduledDateRepeat: REPEATER,
        repeatCount: 1,
      }),
      {
        newScheduledDate: new Date(2026, 2, 17),
        newScheduledRepeat: REPEATER,
        newState: 'TODO',
      },
    );

    const result = editor.getText();
    expect((result.match(/\[!repeats\]/g) || []).length).toBe(1);
    expect(result).not.toContain('\n\n');
    expect(result).toContain('Repeats: 2 (latest 3)');
    expect(result).toContain('#2 · closed');
    expect(result).toContain('#1 · closed');
  });
});
