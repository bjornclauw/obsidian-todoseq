import { TaskWriter, TaskComposeFields } from '../src/services/task-writer';
import {
  createBaseTask,
  createTestKeywordManager,
} from './helpers/test-helper';
import { TFile } from 'obsidian';

class MockTFile extends TFile {
  constructor() {
    super();
  }

  path = 'test.md';
  stat: { ctime: number; mtime: number; size: number } = {
    ctime: 0,
    mtime: 0,
    size: 0,
  };
  basename = 'test';
  extension = 'md';
  name = 'test.md';
}

function makeFields(
  overrides: Partial<TaskComposeFields> = {},
): TaskComposeFields {
  return {
    text: 'Task text',
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

function createWriter() {
  const mockTFile = new MockTFile();
  const mockApp = {
    vault: {
      getAbstractFileByPath: jest.fn().mockReturnValue(mockTFile),
      process: jest.fn(),
    },
    workspace: {
      getActiveViewOfType: jest.fn().mockReturnValue(null),
    },
  };
  const mockPlugin = {
    app: mockApp,
    settings: {
      trackClosedDate: false,
      trackStartedDate: false,
      useExtendedCheckboxStyles: false,
      stateTransitions: {
        defaultInactive: 'TODO',
        defaultActive: 'DOING',
        defaultCompleted: 'DONE',
        transitionStatements: [],
      },
    },
  };
  const keywordManager = createTestKeywordManager();
  const writer = new TaskWriter(mockPlugin as never, keywordManager);
  return { writer, mockApp, mockPlugin, mockTFile };
}

describe('TaskWriter.buildNewTaskLine', () => {
  const keywordManager = createTestKeywordManager();

  it('builds a checkbox task line with the default inactive keyword', () => {
    expect(
      TaskWriter.buildNewTaskLine(
        { text: 'Buy milk', state: 'TODO', priority: null },
        keywordManager,
      ),
    ).toBe('- [ ] TODO Buy milk');
  });

  it('marks completed states with an x checkbox', () => {
    expect(
      TaskWriter.buildNewTaskLine(
        { text: 'Done thing', state: 'DONE', priority: null },
        keywordManager,
      ),
    ).toBe('- [x] DONE Done thing');
  });

  it('includes the priority token', () => {
    expect(
      TaskWriter.buildNewTaskLine(
        { text: 'Urgent', state: 'TODO', priority: 'high' },
        keywordManager,
      ),
    ).toBe('- [ ] TODO [#A] Urgent');
  });

  it('omits trailing text when empty', () => {
    expect(
      TaskWriter.buildNewTaskLine(
        { text: '', state: 'TODO', priority: null },
        keywordManager,
      ),
    ).toBe('- [ ] TODO');
  });
});

describe('TaskWriter.createTaskAtLine', () => {
  it('replaces a blank target line with the task block', async () => {
    const { writer, mockApp } = createWriter();
    const content = 'line 0\n\nline 2';
    mockApp.vault.process = jest.fn((_file, updateFn) =>
      Promise.resolve(updateFn(content)),
    );

    const result = await writer.createTaskAtLine('test.md', 1, makeFields());

    const updateFn = mockApp.vault.process.mock.calls[0][1];
    expect(updateFn(content)).toBe('line 0\n- [ ] TODO Task text\nline 2');
    expect(result?.task.rawText).toBe('- [ ] TODO Task text');
    expect(result?.task.state).toBe('TODO');
  });

  it('inserts the task block before non-blank content', async () => {
    const { writer, mockApp } = createWriter();
    const content = 'line 0\nexisting\nline 2';
    mockApp.vault.process = jest.fn((_file, updateFn) =>
      Promise.resolve(updateFn(content)),
    );

    await writer.createTaskAtLine('test.md', 1, makeFields());

    const updateFn = mockApp.vault.process.mock.calls[0][1];
    expect(updateFn(content)).toBe(
      'line 0\n- [ ] TODO Task text\nexisting\nline 2',
    );
  });

  it('writes description, scheduled and deadline lines in order', async () => {
    const { writer, mockApp } = createWriter();
    const content = '';
    mockApp.vault.process = jest.fn((_file, updateFn) =>
      Promise.resolve(updateFn(content)),
    );

    const fields = makeFields({
      description: 'Some notes',
      scheduledDate: new Date(2026, 2, 10),
      deadlineDate: new Date(2026, 2, 12),
    });
    await writer.createTaskAtLine('test.md', 0, fields);

    const updateFn = mockApp.vault.process.mock.calls[0][1];
    expect(updateFn(content)).toBe(
      [
        '- [ ] TODO Task text',
        '  DESCRIPTION: Some notes',
        '  SCHEDULED: <2026-03-10 Tue>',
        '  DEADLINE: <2026-03-12 Thu>',
      ].join('\n'),
    );
  });

  it('writes a CLOSED line when recordCompletion is set', async () => {
    const { writer, mockApp, mockPlugin } = createWriter();
    mockPlugin.settings.trackClosedDate = true;
    const content = '';
    mockApp.vault.process = jest.fn((_file, updateFn) =>
      Promise.resolve(updateFn(content)),
    );

    await writer.createTaskAtLine('test.md', 0, makeFields(), {
      recordCompletion: true,
    });

    const updateFn = mockApp.vault.process.mock.calls[0][1];
    expect(updateFn(content)).toContain('CLOSED:');
  });

  it('writes a STARTED line before SCHEDULED when creating an active task', async () => {
    const { writer, mockApp, mockPlugin } = createWriter();
    mockPlugin.settings.trackStartedDate = true;
    const content = '';
    mockApp.vault.process = jest.fn((_file, updateFn) =>
      Promise.resolve(updateFn(content)),
    );

    const result = await writer.createTaskAtLine(
      'test.md',
      0,
      makeFields({
        state: 'DOING',
        scheduledDate: new Date(2026, 2, 10),
      }),
    );

    const updateFn = mockApp.vault.process.mock.calls[0][1];
    const written = updateFn(content);
    expect(written).toContain('- [ ] DOING Task text');
    expect(written).toContain('STARTED:');
    expect(written.indexOf('STARTED:')).toBeLessThan(
      written.indexOf('SCHEDULED:'),
    );
    expect(result?.task.startedDate).not.toBeNull();
  });

  it('returns null when the target file cannot be resolved', async () => {
    const { writer, mockApp } = createWriter();
    mockApp.vault.getAbstractFileByPath = jest.fn().mockReturnValue(null);

    const result = await writer.createTaskAtLine('missing.md', 0, makeFields());

    expect(result).toBeNull();
    expect(mockApp.vault.process).not.toHaveBeenCalled();
  });

  it('uses the editor API when the file is active in source mode', async () => {
    const { writer, mockApp } = createWriter();
    const mockEditor = {
      getLine: jest.fn().mockReturnValue(''),
      replaceRange: jest.fn(),
      lineCount: jest.fn().mockReturnValue(1),
    };
    mockApp.workspace.getActiveViewOfType = jest.fn().mockReturnValue({
      file: { path: 'test.md' },
      editor: mockEditor,
      getViewType: () => 'markdown',
      getMode: () => 'source',
    });

    await writer.createTaskAtLine('test.md', 0, makeFields());

    expect(mockEditor.replaceRange).toHaveBeenCalledWith(
      '- [ ] TODO Task text',
      { line: 0, ch: 0 },
      { line: 0, ch: 0 },
    );
    expect(mockApp.vault.process).not.toHaveBeenCalled();
  });
});

describe('TaskWriter.updateTaskFields', () => {
  it('updates text, state and description through the vault API', async () => {
    const { writer, mockApp } = createWriter();
    let content = 'TODO Task text\n';
    mockApp.vault.process = jest.fn(
      (_file, updateFn: (data: string) => string) => {
        content = updateFn(content);
        return Promise.resolve(content);
      },
    );

    const task = createBaseTask({
      rawText: 'TODO Task text',
      text: 'Task text',
      state: 'TODO',
    });
    const result = await writer.updateTaskFields(
      task,
      makeFields({
        text: 'Updated task',
        state: 'DOING',
        description: 'Notes',
      }),
    );

    expect(content).toBe('DOING Updated task\nDESCRIPTION: Notes\n');
    expect(result?.task.text).toBe('Updated task');
    expect(result?.task.state).toBe('DOING');
    expect(result?.task.description).toBe('Notes');
    expect(result?.task.completed).toBe(false);
  });

  it('removes an existing description when cleared', async () => {
    const { writer, mockApp } = createWriter();
    let content = 'DOING Updated task\nDESCRIPTION: Notes\n';
    mockApp.vault.process = jest.fn(
      (_file, updateFn: (data: string) => string) => {
        content = updateFn(content);
        return Promise.resolve(content);
      },
    );

    const task = createBaseTask({
      rawText: 'DOING Updated task',
      text: 'Updated task',
      state: 'DOING',
      description: 'Notes',
    });
    await writer.updateTaskFields(
      task,
      makeFields({ text: 'Updated task', state: 'DOING', description: null }),
    );

    expect(content).toBe('DOING Updated task\n');
  });

  it('adds scheduled and deadline lines', async () => {
    const { writer, mockApp } = createWriter();
    let content = 'TODO Task text\n';
    mockApp.vault.process = jest.fn(
      (_file, updateFn: (data: string) => string) => {
        content = updateFn(content);
        return Promise.resolve(content);
      },
    );

    const task = createBaseTask({
      rawText: 'TODO Task text',
      text: 'Task text',
      state: 'TODO',
    });
    await writer.updateTaskFields(
      task,
      makeFields({
        scheduledDate: new Date(2026, 2, 10),
        deadlineDate: new Date(2026, 2, 12),
      }),
    );

    expect(content).toBe(
      'TODO Task text\nSCHEDULED: <2026-03-10 Tue>\nDEADLINE: <2026-03-12 Thu>\n',
    );
  });

  it('removes scheduled and deadline lines when cleared', async () => {
    const { writer, mockApp } = createWriter();
    let content =
      'TODO Task text\nSCHEDULED: <2026-03-10 Tue>\nDEADLINE: <2026-03-12 Thu>\n';
    mockApp.vault.process = jest.fn(
      (_file, updateFn: (data: string) => string) => {
        content = updateFn(content);
        return Promise.resolve(content);
      },
    );

    const task = createBaseTask({
      rawText: 'TODO Task text',
      text: 'Task text',
      state: 'TODO',
      scheduledDate: new Date(2026, 2, 10),
      deadlineDate: new Date(2026, 2, 12),
    });
    await writer.updateTaskFields(
      task,
      makeFields({ scheduledDate: null, deadlineDate: null }),
    );

    expect(content).toBe('TODO Task text\n');
  });

  it('uses the editor API for the active source-mode file', async () => {
    const { writer, mockApp } = createWriter();
    const lines = ['TODO Task text'];
    const mockEditor = {
      lineCount: jest.fn().mockReturnValue(lines.length),
      getLine: jest.fn((i: number) => lines[i]),
      replaceRange: jest.fn((text: string, from: { line: number }) => {
        const newLines = text.split('\n');
        lines.splice(from.line, 1, ...newLines);
      }),
      getCursor: jest.fn().mockReturnValue({ line: 0, ch: 0 }),
      setCursor: jest.fn(),
    };
    mockApp.workspace.getActiveViewOfType = jest.fn().mockReturnValue({
      file: { path: 'test.md' },
      editor: mockEditor,
      getViewType: () => 'markdown',
      getMode: () => 'source',
    });

    const task = createBaseTask({
      rawText: 'TODO Task text',
      text: 'Task text',
      state: 'TODO',
    });
    await writer.updateTaskFields(
      task,
      makeFields({ text: 'Updated task', state: 'DOING' }),
    );

    expect(mockEditor.replaceRange).toHaveBeenCalled();
    expect(mockApp.vault.process).not.toHaveBeenCalled();
  });

  it('records a CLOSED date when recordCompletion is set for an inactive write', async () => {
    const { writer, mockApp, mockPlugin } = createWriter();
    mockPlugin.settings.trackClosedDate = true;
    let content = 'TODO Task text\n';
    mockApp.vault.process = jest.fn(
      (_file, updateFn: (data: string) => string) => {
        content = updateFn(content);
        return Promise.resolve(content);
      },
    );

    const task = createBaseTask({
      rawText: 'TODO Task text',
      text: 'Task text',
      state: 'TODO',
    });
    const result = await writer.updateTaskFields(
      task,
      makeFields({ state: 'TODO' }),
      { recordCompletion: true },
    );

    expect(content).toContain('CLOSED:');
    expect(result?.task.closedDate).not.toBeNull();
  });

  it('returns null when the task file cannot be resolved', async () => {
    const { writer, mockApp } = createWriter();
    mockApp.vault.getAbstractFileByPath = jest.fn().mockReturnValue(null);

    const result = await writer.updateTaskFields(
      createBaseTask(),
      makeFields(),
    );

    expect(result).toBeNull();
  });
});
