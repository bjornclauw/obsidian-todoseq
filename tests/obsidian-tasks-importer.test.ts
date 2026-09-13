import { App, TFile } from 'obsidian';
import { ObsidianTasksImporter } from '../src/services/import/obsidian-tasks-importer';

interface FakeFile {
  path: string;
  content: string;
}

function makeFile(path: string): TFile {
  const file = new TFile();
  file.path = path;
  file.name = path.split('/').pop() ?? path;
  file.extension = 'md';
  return file;
}

class FakeVault {
  private files = new Map<string, FakeFile>();

  constructor(files: FakeFile[]) {
    for (const file of files) this.files.set(file.path, file);
  }

  getMarkdownFiles(): TFile[] {
    return Array.from(this.files.values()).map((file) => makeFile(file.path));
  }

  async cachedRead(file: TFile): Promise<string> {
    return this.files.get(file.path)?.content ?? '';
  }

  async process(file: TFile, fn: (data: string) => string): Promise<string> {
    const current = this.files.get(file.path)?.content ?? '';
    const updated = fn(current);
    const entry = this.files.get(file.path);
    if (entry) entry.content = updated;
    return updated;
  }

  setContent(path: string, content: string): void {
    const entry = this.files.get(path);
    if (entry) entry.content = content;
  }

  getContent(path: string): string | undefined {
    return this.files.get(path)?.content;
  }
}

function createApp(files: FakeFile[]): { app: App; vault: FakeVault } {
  const vault = new FakeVault(files);
  return { app: { vault } as unknown as App, vault };
}

describe('ObsidianTasksImporter', () => {
  test('scan returns only files with convertible lines', async () => {
    const { app } = createApp([
      { path: 'a.md', content: '- [ ] Task ⏳ 2026-01-15' },
      { path: 'b.md', content: '- [ ] TODO Already done' },
      { path: 'c.md', content: '- [ ] Plain ⏫' },
    ]);
    const importer = new ObsidianTasksImporter(app);
    const result = await importer.scan();

    expect(result.scannedFiles).toBe(3);
    expect(result.candidates.map((c) => c.path)).toEqual(['a.md', 'c.md']);
    expect(result.candidates[0].changedLineCount).toBe(1);
    expect(result.candidates[0].convertedContent).toBe(
      '- [ ] TODO Task\n  SCHEDULED: <2026-01-15 Thu>',
    );
  });

  test('scan reports progress', async () => {
    const { app } = createApp([{ path: 'a.md', content: '- [ ] Task' }]);
    const importer = new ObsidianTasksImporter(app);
    const calls: Array<[number, number]> = [];
    await importer.scan({
      onProgress: (processed, total) => calls.push([processed, total]),
    });
    expect(calls).toEqual([[1, 1]]);
  });

  test('scan limits files to the selected top-level folders', async () => {
    const { app } = createApp([
      { path: 'root.md', content: '- [ ] Root' },
      { path: 'projects/a.md', content: '- [ ] A' },
      { path: 'archive/b.md', content: '- [ ] B' },
    ]);
    const importer = new ObsidianTasksImporter(app);

    const projects = await importer.scan({ folderPrefixes: ['projects'] });
    expect(projects.scannedFiles).toBe(1);
    expect(projects.candidates.map((c) => c.path)).toEqual(['projects/a.md']);

    const root = await importer.scan({ folderPrefixes: [''] });
    expect(root.candidates.map((c) => c.path)).toEqual(['root.md']);

    const both = await importer.scan({
      folderPrefixes: ['projects', 'archive'],
    });
    expect(both.scannedFiles).toBe(2);
  });

  test('apply writes converted content', async () => {
    const { app, vault } = createApp([
      { path: 'note.md', content: '- [ ] Task 📅 2026-01-20' },
    ]);
    const importer = new ObsidianTasksImporter(app);
    const { candidates } = await importer.scan();
    const result = await importer.apply(candidates);

    expect(result.filesWritten).toBe(1);
    expect(result.errors).toEqual([]);
    expect(vault.getContent('note.md')).toBe(
      '- [ ] TODO Task\n  DEADLINE: <2026-01-20 Tue>',
    );
  });

  test('apply converts the freshest content rather than the scan snapshot', async () => {
    const { app, vault } = createApp([
      { path: 'note.md', content: '- [ ] Task' },
    ]);
    const importer = new ObsidianTasksImporter(app);
    const { candidates } = await importer.scan();
    vault.setContent('note.md', '- [ ] Fresh ⏳ 2026-01-15');
    await importer.apply(candidates);
    expect(vault.getContent('note.md')).toBe(
      '- [ ] TODO Fresh\n  SCHEDULED: <2026-01-15 Thu>',
    );
  });

  test('apply collects per-file errors', async () => {
    const { app, vault } = createApp([
      { path: 'note.md', content: '- [ ] Task' },
    ]);
    const importer = new ObsidianTasksImporter(app);
    const { candidates } = await importer.scan();
    vault.process = async () => {
      throw new Error('disk full');
    };
    const result = await importer.apply(candidates);
    expect(result.filesWritten).toBe(0);
    expect(result.errors).toEqual([{ path: 'note.md', message: 'disk full' }]);
  });

  test('honours custom converter options', async () => {
    const { app } = createApp([{ path: 'note.md', content: '- [ ] Task ⏫' }]);
    const importer = new ObsidianTasksImporter(app, {
      defaultState: 'TODO',
      completedState: 'DONE',
      inProgressState: 'DOING',
      cancelledState: 'CANCELED',
      priorityMapping: {
        highest: 'C',
        high: 'B',
        medium: null,
        low: null,
        lowest: null,
      },
      includePriority: true,
      knownKeywords: ['TODO', 'DONE'],
    });
    const { candidates } = await importer.scan();
    expect(candidates[0].convertedContent).toBe('- [ ] TODO [#C] Task');
  });
});
