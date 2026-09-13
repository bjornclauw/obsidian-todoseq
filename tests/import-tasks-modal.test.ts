/**
 * @jest-environment jsdom
 */

import { App, TFile, TFolder } from 'obsidian';
import { installObsidianDomMocks } from './helpers/obsidian-dom-mock';
import { createTestKeywordManager } from './helpers/test-helper';
import { ImportTasksModal } from '../src/view/components/import-tasks-modal';

beforeAll(() => {
  installObsidianDomMocks();
});

interface FakeFile {
  path: string;
  content: string;
}

class FakeVault {
  private files = new Map<string, FakeFile>();

  constructor(files: FakeFile[]) {
    for (const file of files) this.files.set(file.path, file);
  }

  getMarkdownFiles(): TFile[] {
    return Array.from(this.files.keys()).map((path) => {
      const file = new TFile();
      file.path = path;
      file.name = path.split('/').pop() ?? path;
      file.extension = 'md';
      return file;
    });
  }

  getRoot(): TFolder {
    const root = new TFolder();
    root.path = '';
    root.name = '';
    const seen = new Map<string, TFolder>();
    for (const path of this.files.keys()) {
      const slash = path.indexOf('/');
      if (slash === -1) continue;
      const top = path.slice(0, slash);
      if (!seen.has(top)) {
        const folder = new TFolder();
        folder.path = top;
        folder.name = top;
        seen.set(top, folder);
      }
    }
    root.children = Array.from(seen.values());
    return root;
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

  getContent(path: string): string | undefined {
    return this.files.get(path)?.content;
  }
}

function createApp(files: FakeFile[]): { app: App; vault: FakeVault } {
  const vault = new FakeVault(files);
  return { app: { vault } as unknown as App, vault };
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 4000,
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('Timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function query<T extends Element>(selector: string): T {
  const el = document.querySelector(selector);
  if (!el) throw new Error(`Expected element ${selector}`);
  return el as T;
}

function filePaths(): string[] {
  return Array.from(document.querySelectorAll('.todoseq-import-file-path')).map(
    (el) => el.textContent ?? '',
  );
}

function folderCheckbox(prefix: string): HTMLInputElement {
  const labels = document.querySelectorAll('.todoseq-import-folders label');
  for (const label of Array.from(labels)) {
    if (label.querySelector('span')?.textContent === prefix) {
      const input = label.querySelector('input');
      if (input) return input;
    }
  }
  throw new Error(`No folder checkbox for ${prefix}`);
}

afterEach(() => {
  document.querySelectorAll('.modal-container').forEach((el) => el.remove());
});

describe('ImportTasksModal', () => {
  test('scans the vault and lists convertible files with summary chips', async () => {
    const { app } = createApp([
      { path: 'a.md', content: '- [ ] Task ⏳ 2026-01-15' },
      { path: 'b.md', content: '- [ ] TODO Already converted' },
    ]);
    const modal = new ImportTasksModal({
      app,
      keywordManager: createTestKeywordManager(),
    });
    modal.open();
    await waitFor(
      () => document.querySelectorAll('.todoseq-import-file').length === 1,
    );

    expect(document.querySelectorAll('.todoseq-import-file').length).toBe(1);
    expect(query('.todoseq-import-status').textContent).toContain(
      'Found 1 file',
    );
    expect(query('.todoseq-import-summary').textContent).toContain('1 file');
  });

  test('shows a backup disclaimer', () => {
    const { app } = createApp([]);
    const modal = new ImportTasksModal({
      app,
      keywordManager: createTestKeywordManager(),
    });
    modal.open();
    expect(query('.todoseq-import-disclaimer').textContent).toContain(
      'Make a backup',
    );
  });

  test('shows a message when nothing is convertible', async () => {
    const { app } = createApp([
      { path: 'a.md', content: '- [ ] TODO Already converted' },
    ]);
    const modal = new ImportTasksModal({
      app,
      keywordManager: createTestKeywordManager(),
    });
    modal.open();
    await waitFor(() =>
      (query('.todoseq-import-status').textContent ?? '').includes(
        'No convertible tasks',
      ),
    );

    expect(document.querySelector('.todoseq-import-file')).toBeNull();
  });

  test('renders an aligned diff in a single scroll container', async () => {
    const { app } = createApp([
      { path: 'a.md', content: '- [ ] Task 📅 2026-01-20' },
    ]);
    const modal = new ImportTasksModal({
      app,
      keywordManager: createTestKeywordManager(),
    });
    modal.open();
    await waitFor(
      () => document.querySelectorAll('.todoseq-import-diff').length === 1,
    );

    expect(document.querySelectorAll('.todoseq-import-diff').length).toBe(1);
    expect(
      document.querySelectorAll('.todoseq-import-diff-row.is-change').length,
    ).toBe(1);
    expect(
      document.querySelectorAll('.todoseq-import-diff-row.is-add').length,
    ).toBe(1);
    // Line-number gutters are present.
    expect(
      document.querySelectorAll('.todoseq-import-diff-gutter').length,
    ).toBeGreaterThan(0);
  });

  test('shows a warnings panel with full messages', async () => {
    const { app } = createApp([{ path: 'a.md', content: '- [?] Task' }]);
    const modal = new ImportTasksModal({
      app,
      keywordManager: createTestKeywordManager(),
    });
    modal.open();
    await waitFor(() =>
      Array.from(
        document.querySelectorAll<HTMLButtonElement>(
          '.todoseq-import-preview-tab',
        ),
      ).some((tab) => tab.textContent?.includes('Warnings')),
    );

    const warningTab = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        '.todoseq-import-preview-tab',
      ),
    ).find((tab) => tab.textContent?.includes('Warnings'));
    warningTab?.click();

    const panel = query('.todoseq-import-warnings');
    expect(panel.textContent).toContain('unknown checkbox status');
    expect(panel.textContent).toContain('Before');
    expect(panel.textContent).toContain('After');
  });

  test('shows the fully converted file preview', async () => {
    const { app } = createApp([
      { path: 'a.md', content: '- [ ] Task 📅 2026-01-20' },
    ]);
    const modal = new ImportTasksModal({
      app,
      keywordManager: createTestKeywordManager(),
    });
    modal.open();
    await waitFor(
      () => document.querySelectorAll('.todoseq-import-preview-tab').length > 0,
    );

    const convertedTab = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        '.todoseq-import-preview-tab',
      ),
    ).find((tab) => tab.textContent === 'Converted file');
    convertedTab?.click();

    const fullFile = query('.todoseq-import-full-file');
    expect(fullFile.textContent).toContain('- [ ] TODO Task');
    expect(fullFile.textContent).toContain('DEADLINE: <2026-01-20 Tue>');
  });

  test('selecting none disables the import button', async () => {
    const { app } = createApp([{ path: 'a.md', content: '- [ ] Task' }]);
    const modal = new ImportTasksModal({
      app,
      keywordManager: createTestKeywordManager(),
    });
    modal.open();
    await waitFor(
      () => document.querySelectorAll('.todoseq-import-file').length === 1,
    );

    const importButton = query<HTMLButtonElement>(
      '.todoseq-import-footer .mod-cta',
    );
    expect(importButton.disabled).toBe(false);

    query<HTMLButtonElement>(
      '.todoseq-import-toolbar button:nth-child(2)',
    ).click();
    expect(importButton.disabled).toBe(true);
    expect(query('.todoseq-import-footer-summary').textContent).toContain(
      '0 of 1 selected',
    );
  });

  test('filters the file list', async () => {
    const { app } = createApp([
      { path: 'alpha.md', content: '- [ ] A' },
      { path: 'beta.md', content: '- [ ] B' },
    ]);
    const modal = new ImportTasksModal({
      app,
      keywordManager: createTestKeywordManager(),
    });
    modal.open();
    await waitFor(
      () => document.querySelectorAll('.todoseq-import-file').length === 2,
    );

    const filter = query<HTMLInputElement>('.todoseq-import-filter');
    filter.value = 'beta';
    filter.dispatchEvent(new Event('input'));

    expect(filePaths()).toEqual(['beta.md']);
  });

  test('imports selected files and calls onApplied', async () => {
    const { app, vault } = createApp([
      { path: 'a.md', content: '- [ ] Task 📅 2026-01-20' },
    ]);
    const onApplied = jest.fn();
    const modal = new ImportTasksModal({
      app,
      keywordManager: createTestKeywordManager(),
      onApplied,
    });
    modal.open();
    await waitFor(
      () => document.querySelectorAll('.todoseq-import-file').length === 1,
    );

    query<HTMLButtonElement>('.todoseq-import-footer .mod-cta').click();
    await waitFor(() => onApplied.mock.calls.length === 1);

    expect(vault.getContent('a.md')).toBe(
      '- [ ] TODO Task\n  DEADLINE: <2026-01-20 Tue>',
    );
  });

  test('restricts the scan to the selected folders', async () => {
    const { app } = createApp([
      { path: 'projects/a.md', content: '- [ ] A' },
      { path: 'archive/b.md', content: '- [ ] B' },
    ]);
    const modal = new ImportTasksModal({
      app,
      keywordManager: createTestKeywordManager(),
    });
    modal.open();
    await waitFor(
      () => document.querySelectorAll('.todoseq-import-file').length === 2,
    );

    const archive = folderCheckbox('archive');
    archive.checked = false;
    archive.dispatchEvent(new Event('change'));
    query<HTMLButtonElement>('.todoseq-import-scan-row button').click();
    await waitFor(() => filePaths().length === 1);

    expect(filePaths()).toEqual(['projects/a.md']);
  });

  test('folder select none clears the scope', async () => {
    const { app } = createApp([{ path: 'projects/a.md', content: '- [ ] A' }]);
    const modal = new ImportTasksModal({
      app,
      keywordManager: createTestKeywordManager(),
    });
    modal.open();
    await waitFor(
      () => document.querySelectorAll('.todoseq-import-file').length === 1,
    );

    const linkButtons = document.querySelectorAll<HTMLButtonElement>(
      '.todoseq-import-link-btn',
    );
    linkButtons[1].click(); // Select none
    query<HTMLButtonElement>('.todoseq-import-scan-row button').click();
    await waitFor(() =>
      (query('.todoseq-import-status').textContent ?? '').includes(
        'No convertible tasks',
      ),
    );

    expect(document.querySelectorAll('.todoseq-import-file').length).toBe(0);
  });

  test('renders the priority mapping selects with defaults', () => {
    const { app } = createApp([]);
    const modal = new ImportTasksModal({
      app,
      keywordManager: createTestKeywordManager(),
    });
    modal.open();

    const rows = document.querySelectorAll('.todoseq-import-option-row');
    expect(rows.length).toBeGreaterThanOrEqual(5);
    expect(rows[0].querySelector('select')?.value).toBe('A');
  });

  test('renders accessible conversion options with folder and state summaries', () => {
    const { app } = createApp([
      { path: 'projects/a.md', content: '- [ ] A' },
      { path: 'archive/b.md', content: '- [ ] B' },
    ]);
    const modal = new ImportTasksModal({
      app,
      keywordManager: createTestKeywordManager(),
    });
    modal.open();

    expect(query('.todoseq-import-options-header').textContent).toContain(
      'Conversion options',
    );
    expect(query('.todoseq-import-options-summary').textContent).toContain(
      '3 of 3 folders',
    );
    expect(query('.todoseq-import-options-card').textContent).toContain(
      'State mapping',
    );
    expect(query('.todoseq-import-options-card').textContent).toContain(
      'Open',
    );

    const archive = folderCheckbox('archive');
    archive.checked = false;
    archive.dispatchEvent(new Event('change'));

    expect(query('.todoseq-import-options-summary').textContent).toContain(
      '2 of 3 folders',
    );
  });
});
