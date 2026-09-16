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

describe('TaskWriter - work log', () => {
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
        repeatHistoryLimit: 50,
        trackWorkLog: true,
      },
    };
    writer = new TaskWriter(
      mockPlugin as never,
      new KeywordManager({ additionalInactiveKeywords: [] }),
    );
  });

  afterEach(() => {
    jest.useRealTimers();
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

  it('writes a TIMER line when starting a session', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 8, 14, 10, 2));
    const getContent = setupVaultProcess(
      '- [ ] TODO Task\n  SCHEDULED: <2026-09-14 Mon>',
    );

    const result = await writer.startWorkSession(createBaseTask());

    const content = getContent();
    expect(content).toContain('TIMER: [2026-09-14 Mon 10:02]');
    expect(content).toContain('SCHEDULED: <2026-09-14 Mon>');
    expect(result?.lineDelta).toBe(1);
  });

  it('does not start twice while a session is running', async () => {
    const getContent = setupVaultProcess('- [ ] TODO Task\n  TIMER: [x]');
    const result = await writer.startWorkSession(
      createBaseTask({ timerStart: new Date(2026, 8, 14, 9, 0) }),
    );
    expect(result).toBeNull();
    expect(getContent()).toBe('');
  });

  it('does nothing when work logging is disabled', async () => {
    mockPlugin.settings.trackWorkLog = false;
    const getContent = setupVaultProcess('- [ ] TODO Task');
    const result = await writer.startWorkSession(createBaseTask());
    expect(result).toBeNull();
    expect(getContent()).toBe('');
  });

  it('pauses a session into the [!work] callout and removes TIMER', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 8, 14, 10, 2));
    const getContent = setupVaultProcess(
      [
        '- [ ] TODO Task',
        '  SCHEDULED: <2026-09-14 Mon>',
        '  TIMER: [2026-09-14 Mon 09:32]',
      ].join('\n'),
    );

    const result = await writer.pauseWorkSession(
      createBaseTask({ timerStart: new Date(2026, 8, 14, 9, 32) }),
    );

    const content = getContent();
    expect(content).not.toContain('TIMER:');
    expect(content).toContain('> [!work]- Total: 30m');
    expect(content).toContain('> - 30m · 2026-09-14 09:32–10:02');
    expect(content).toContain('SCHEDULED: <2026-09-14 Mon>');
    expect(result?.lineDelta).toBeGreaterThan(0);
  });

  it('adds to an existing total and keeps previous entries', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 8, 14, 10, 2));
    const getContent = setupVaultProcess(
      [
        '- [ ] TODO Task',
        '  TIMER: [2026-09-14 Mon 09:32]',
        '  > [!work]- Total: 1h',
        '  > - 1h · 2026-09-13 14:10–15:10',
      ].join('\n'),
    );

    await writer.pauseWorkSession(
      createBaseTask({ timerStart: new Date(2026, 8, 14, 9, 32) }),
    );

    const content = getContent();
    expect(content).toContain('Total: 1h 30m');
    expect(content).toContain('> - 30m · 2026-09-14 09:32–10:02');
    expect(content).toContain('> - 1h · 2026-09-13 14:10–15:10');
    // Newest entry sits directly under the title.
    expect(content.indexOf('30m · 2026-09-14')).toBeLessThan(
      content.indexOf('1h · 2026-09-13'),
    );
  });

  it('does nothing on pause when no session is running', async () => {
    const getContent = setupVaultProcess('- [ ] TODO Task');
    const result = await writer.pauseWorkSession(createBaseTask());
    expect(result).toBeNull();
    expect(getContent()).toBe('');
  });

  it('round-trips start then pause via the editor path', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 8, 14, 10, 2));
    const editor = createLineEditor([
      '- [ ] TODO Task',
      '  SCHEDULED: <2026-09-14 Mon>',
    ]);
    mockApp.workspace.getActiveViewOfType = jest.fn().mockReturnValue({
      file: { path: 'test.md' },
      editor,
      getViewType: () => 'markdown',
      getMode: () => 'source',
    });

    await writer.startWorkSession(createBaseTask());
    expect(editor.getText()).toContain('TIMER: [2026-09-14 Mon 10:02]');

    jest.setSystemTime(new Date(2026, 8, 14, 10, 32));
    const result = await writer.pauseWorkSession(
      createBaseTask({ timerStart: new Date(2026, 8, 14, 10, 2) }),
    );

    const text = editor.getText();
    expect(result).not.toBeNull();
    expect(text).not.toContain('TIMER:');
    expect(text).toContain('> [!work]- Total: 30m');
    expect(text).toContain('> - 30m · 2026-09-14 10:02–10:32');
    expect(text).toContain('SCHEDULED: <2026-09-14 Mon>');
  });

  it('keeps the paragraph below the block intact via the editor path', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 8, 14, 10, 2));
    const editor = createLineEditor([
      '- [ ] TODO Task',
      '  TIMER: [2026-09-14 Mon 09:32]',
      '',
      'Some paragraph',
    ]);
    mockApp.workspace.getActiveViewOfType = jest.fn().mockReturnValue({
      file: { path: 'test.md' },
      editor,
      getViewType: () => 'markdown',
      getMode: () => 'source',
    });

    await writer.pauseWorkSession(
      createBaseTask({ timerStart: new Date(2026, 8, 14, 9, 32) }),
    );

    const out = editor.getText().split('\n');
    expect(out).toContain('Some paragraph');
    expect(out[out.length - 1]).toBe('Some paragraph');
    expect(editor.getText()).toContain('Total: 30m');
  });
});
