import { TaskWriter } from '../src/services/task-writer';
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
  const mockPlugin = { app: mockApp, settings: {} };
  const writer = new TaskWriter(
    mockPlugin as never,
    createTestKeywordManager(),
  );
  return { writer, mockApp };
}

describe('TaskWriter.setTaskPhoto', () => {
  it('inserts a PHOTO line directly below the task when absent', async () => {
    const { writer, mockApp } = createWriter();
    const content = '- [ ] TODO Task text\nnext';
    mockApp.vault.process = jest.fn((_file, updateFn) =>
      Promise.resolve(updateFn(content)),
    );

    const task = createBaseTask({ line: 0, indent: '', listMarker: '- ' });
    const delta = await writer.setTaskPhoto(task, '![[img.webp]]');

    const updateFn = mockApp.vault.process.mock.calls[0][1];
    expect(updateFn(content)).toBe(
      '- [ ] TODO Task text\nPHOTO: ![[img.webp]]\nnext',
    );
    expect(delta).toBe(1);
  });

  it('inserts the PHOTO line after an existing DESCRIPTION line', async () => {
    const { writer, mockApp } = createWriter();
    const content =
      '- [ ] TODO Task text\nDESCRIPTION: notes\nSCHEDULED: <2026-01-10 Sat>';
    mockApp.vault.process = jest.fn((_file, updateFn) =>
      Promise.resolve(updateFn(content)),
    );

    const task = createBaseTask({ line: 0, indent: '', listMarker: '- ' });
    const delta = await writer.setTaskPhoto(task, '![[img.webp]]');

    const updateFn = mockApp.vault.process.mock.calls[0][1];
    expect(updateFn(content)).toBe(
      '- [ ] TODO Task text\nDESCRIPTION: notes\nPHOTO: ![[img.webp]]\nSCHEDULED: <2026-01-10 Sat>',
    );
    expect(delta).toBe(1);
  });

  it('updates an existing PHOTO line in place', async () => {
    const { writer, mockApp } = createWriter();
    const content = '- [ ] TODO Task text\nPHOTO: ![[old.webp]]';
    mockApp.vault.process = jest.fn((_file, updateFn) =>
      Promise.resolve(updateFn(content)),
    );

    const task = createBaseTask({ line: 0, indent: '', listMarker: '- ' });
    const delta = await writer.setTaskPhoto(task, '![[new.webp]]');

    const updateFn = mockApp.vault.process.mock.calls[0][1];
    expect(updateFn(content)).toBe(
      '- [ ] TODO Task text\nPHOTO: ![[new.webp]]',
    );
    expect(delta).toBe(0);
  });

  it('removes the PHOTO line when passed null', async () => {
    const { writer, mockApp } = createWriter();
    const content =
      '- [ ] TODO Task text\nPHOTO: ![[img.webp]]\nSCHEDULED: <2026-01-10 Sat>';
    mockApp.vault.process = jest.fn((_file, updateFn) =>
      Promise.resolve(updateFn(content)),
    );

    const task = createBaseTask({ line: 0, indent: '', listMarker: '- ' });
    const delta = await writer.setTaskPhoto(task, null);

    const updateFn = mockApp.vault.process.mock.calls[0][1];
    expect(updateFn(content)).toBe(
      '- [ ] TODO Task text\nSCHEDULED: <2026-01-10 Sat>',
    );
    expect(delta).toBe(-1);
  });

  it('is a no-op when removing a missing PHOTO line', async () => {
    const { writer, mockApp } = createWriter();
    const content = '- [ ] TODO Task text';
    mockApp.vault.process = jest.fn((_file, updateFn) =>
      Promise.resolve(updateFn(content)),
    );

    const task = createBaseTask({ line: 0, indent: '', listMarker: '- ' });
    const delta = await writer.setTaskPhoto(task, null);

    const updateFn = mockApp.vault.process.mock.calls[0][1];
    expect(updateFn(content)).toBe('- [ ] TODO Task text');
    expect(delta).toBe(0);
  });
});
