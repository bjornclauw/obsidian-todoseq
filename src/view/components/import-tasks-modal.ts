import { App, Modal, Notice, TFolder } from 'obsidian';
import type { KeywordManager } from '../../utils/keyword-manager';
import {
  DEFAULT_PRIORITY_MAPPING,
  type PriorityLevel,
  type PriorityMapping,
  type TodoPriority,
} from '../../services/import/obsidian-tasks-converter';
import {
  ObsidianTasksImporter,
  type ImportCandidate,
} from '../../services/import/obsidian-tasks-importer';
import { buildConverterOptions } from '../../services/import/import-converter-options';
import { buildDiffRows, type DiffRow } from '../../services/import/line-diff';

export interface ImportTasksModalOptions {
  app: App;
  keywordManager: KeywordManager;
  /** Called after files are written so the vault can be rescanned. */
  onApplied?: () => void | Promise<void>;
}

const PRIORITY_LEVELS: ReadonlyArray<{ level: PriorityLevel; label: string }> =
  [
    { level: 'highest', label: 'Highest (⏫)' },
    { level: 'high', label: 'High (🔼)' },
    { level: 'medium', label: 'Medium' },
    { level: 'low', label: 'Low (🔽)' },
    { level: 'lowest', label: 'Lowest (⏬)' },
  ];

const PRIORITY_CHOICES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'A', label: 'A (high)' },
  { value: 'B', label: 'B (medium)' },
  { value: 'C', label: 'C (low)' },
  { value: 'none', label: 'No token' },
];

const ROOT_SCOPE = '';
/** Unchanged lines kept around each change before collapsing a gap. */
const DIFF_CONTEXT = 3;
type PreviewMode = 'changes' | 'warnings' | 'converted';

function plural(count: number, singular: string): string {
  return `${count.toLocaleString()} ${singular}${count === 1 ? '' : 's'}`;
}

/**
 * Interactive migration from the Obsidian Tasks plugin to TODOseq.
 *
 * Desktop-only. Scans the selected top-level folders, shows every convertible
 * file with a summary of the changes, and renders an aligned, scroll-safe
 * before/after diff (single scroll container, one grid row per line pair).
 */
export class ImportTasksModal extends Modal {
  private priorityMapping: PriorityMapping = { ...DEFAULT_PRIORITY_MAPPING };

  private candidates: ImportCandidate[] = [];
  private selected = new Set<string>();
  private activePath: string | null = null;
  private previewMode: PreviewMode = 'changes';
  private scanning = false;
  private scanned = false;

  private availableFolders: string[] = [];
  private selectedFolders = new Set<string>();
  private folderInputs: Array<{ prefix: string; checkbox: HTMLInputElement }> =
    [];
  private fileFilter = '';

  private summaryEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private scanButton: HTMLButtonElement | null = null;
  private resultsEl: HTMLElement | null = null;
  private fileListEl: HTMLElement | null = null;
  private previewEl: HTMLElement | null = null;
  private selectionLabelEl: HTMLElement | null = null;
  private optionsSummaryEl: HTMLElement | null = null;
  private importButton: HTMLButtonElement | null = null;

  constructor(private readonly options: ImportTasksModalOptions) {
    super(options.app);
  }

  onOpen(): void {
    this.setTitle('Import Obsidian tasks');
    this.modalEl.addClass('todoseq-import-modal-container');
    this.contentEl.addClass('todoseq-import-modal');

    this.renderIntro();
    this.renderSummary();
    this.renderOptions();
    this.renderResultsContainer();
    this.renderFooter();
    void this.runScan();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private buildOptions() {
    return buildConverterOptions(
      this.options.keywordManager,
      this.priorityMapping,
    );
  }

  private renderIntro(): void {
    const intro = this.contentEl.createDiv({ cls: 'todoseq-import-intro' });
    intro.setText(
      'Converts Obsidian Tasks checkboxes and metadata into TODOseq keyword ' +
        'and date lines. Preview every change before anything is written.',
    );
    const disclaimer = this.contentEl.createDiv({
      cls: 'todoseq-import-disclaimer',
    });
    disclaimer.createSpan({ cls: 'todoseq-import-disclaimer-icon', text: '⚠' });
    disclaimer.createSpan({
      text:
        'Make a backup of your vault before importing. TODOseq writes the ' +
        'converted files in place and does not create snapshots.',
    });
  }

  private renderSummary(): void {
    this.summaryEl = this.contentEl.createDiv({
      cls: 'todoseq-import-summary',
    });
    this.updateSummary();
  }

  private updateSummary(): void {
    if (!this.summaryEl) return;
    this.summaryEl.empty();
    if (!this.scanned) {
      this.summaryEl.createSpan({
        cls: 'todoseq-import-chip',
        text: 'Scanning vault…',
      });
      return;
    }
    const files = this.candidates.length;
    const lines = this.candidates.reduce((s, c) => s + c.changedLineCount, 0);
    const warnings = this.candidates.reduce((s, c) => s + c.warnings.length, 0);
    const add = (text: string, cls = '') =>
      this.summaryEl?.createSpan({
        cls: `todoseq-import-chip ${cls}`.trim(),
        text,
      });
    add(plural(files, 'file'));
    add(plural(lines, 'line'));
    add(plural(warnings, 'warning'), warnings > 0 ? 'is-warn' : 'is-ok');
  }

  private renderOptions(): void {
    const card = this.contentEl.createDiv({
      cls: 'todoseq-import-options-card',
    });
    const header = card.createDiv({ cls: 'todoseq-import-options-header' });
    const heading = header.createDiv({
      cls: 'todoseq-import-options-heading',
    });
    heading.createSpan({
      cls: 'todoseq-import-section-title',
      text: 'Conversion options',
    });
    this.optionsSummaryEl = heading.createSpan({
      cls: 'todoseq-import-options-summary',
    });
    const toggle = header.createEl('button', {
      cls: 'todoseq-import-options-toggle',
      text: 'Hide',
    });
    toggle.type = 'button';
    toggle.ariaExpanded = 'true';
    const body = card.createDiv({ cls: 'todoseq-import-options' });
    toggle.addEventListener('click', () => {
      const collapsed = body.classList.toggle('is-collapsed');
      toggle.setText(collapsed ? 'Show' : 'Hide');
      toggle.ariaExpanded = collapsed ? 'false' : 'true';
    });

    const stateCol = body.createDiv({ cls: 'todoseq-import-options-col' });
    this.renderStateMapping(stateCol);

    const priorityCol = body.createDiv({ cls: 'todoseq-import-options-col' });
    priorityCol
      .createDiv({ cls: 'todoseq-import-section-title' })
      .setText('Priority mapping');
    for (const { level, label } of PRIORITY_LEVELS) {
      const row = priorityCol.createDiv({ cls: 'todoseq-import-option-row' });
      row.createSpan({ text: label });
      const select = row.createEl('select');
      for (const choice of PRIORITY_CHOICES) {
        select.createEl('option', { value: choice.value, text: choice.label });
      }
      select.value = this.priorityMapping[level] ?? 'none';
      select.addEventListener('change', () => {
        this.priorityMapping[level] = this.parsePriority(select.value);
        this.updateOptionsSummary();
        this.markOptionsStale();
      });
    }

    const foldersCol = body.createDiv({ cls: 'todoseq-import-options-col' });
    const foldersHeader = foldersCol.createDiv({
      cls: 'todoseq-import-section-title-row',
    });
    foldersHeader.createSpan({
      cls: 'todoseq-import-section-title',
      text: 'Folders to scan',
    });
    const allBtn = foldersHeader.createEl('button', {
      cls: 'todoseq-import-link-btn',
      text: 'Select all',
    });
    const noneBtn = foldersHeader.createEl('button', {
      cls: 'todoseq-import-link-btn',
      text: 'Select none',
    });
    allBtn.addEventListener('click', () => this.setAllFolders(true));
    noneBtn.addEventListener('click', () => this.setAllFolders(false));
    this.renderFolderScope(foldersCol);
    this.updateOptionsSummary();

    const scanRow = this.contentEl.createDiv({
      cls: 'todoseq-import-scan-row',
    });
    this.scanButton = scanRow.createEl('button', { text: 'Scan vault' });
    this.scanButton.addEventListener('click', () => void this.runScan());
    this.statusEl = scanRow.createSpan({ cls: 'todoseq-import-status' });
  }

  private renderStateMapping(container: HTMLElement): void {
    container
      .createDiv({ cls: 'todoseq-import-section-title' })
      .setText('State mapping');
    const options = this.buildOptions();
    const states: ReadonlyArray<readonly [string, string]> = [
      ['Open', options.defaultState],
      ['In progress', options.inProgressState],
      ['Completed', options.completedState],
      ['Cancelled', options.cancelledState],
    ];
    for (const [label, keyword] of states) {
      const row = container.createDiv({ cls: 'todoseq-import-state-row' });
      row.createSpan({ text: label });
      row.createEl('code', { text: keyword });
    }
  }

  private updateOptionsSummary(): void {
    if (!this.optionsSummaryEl) return;
    const options = this.buildOptions();
    const folderSummary =
      this.availableFolders.length === 0
        ? 'folders not loaded'
        : `${this.selectedFolders.size} of ${this.availableFolders.length} folders`;
    this.optionsSummaryEl.setText(
      `${folderSummary}; open becomes ${options.defaultState}, completed becomes ${options.completedState}`,
    );
  }

  private topLevelScopeOptions(): Array<{ prefix: string; label: string }> {
    const options: Array<{ prefix: string; label: string }> = [
      { prefix: ROOT_SCOPE, label: '(vault root)' },
    ];
    const root = this.options.app.vault.getRoot();
    for (const child of root.children) {
      if (child instanceof TFolder) {
        options.push({ prefix: child.path, label: child.path });
      }
    }
    return options;
  }

  private renderFolderScope(container: HTMLElement): void {
    const list = container.createDiv({ cls: 'todoseq-import-folders' });
    const options = this.topLevelScopeOptions();
    this.availableFolders = options.map((option) => option.prefix);
    this.selectedFolders = new Set(this.availableFolders);
    this.folderInputs = [];

    for (const option of options) {
      const label = list.createEl('label', {
        cls: 'todoseq-import-checkbox-label',
      });
      const checkbox = label.createEl('input', { type: 'checkbox' });
      checkbox.checked = true;
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) this.selectedFolders.add(option.prefix);
        else this.selectedFolders.delete(option.prefix);
        this.updateOptionsSummary();
        this.markOptionsStale();
      });
      label.createSpan({ text: option.label });
      this.folderInputs.push({ prefix: option.prefix, checkbox });
    }
  }

  private setAllFolders(checked: boolean): void {
    for (const { prefix, checkbox } of this.folderInputs) {
      checkbox.checked = checked;
      if (checked) this.selectedFolders.add(prefix);
      else this.selectedFolders.delete(prefix);
    }
    this.updateOptionsSummary();
    this.markOptionsStale();
  }

  private getScopePrefixes(): string[] | undefined {
    if (this.selectedFolders.size === this.availableFolders.length) {
      return undefined;
    }
    return Array.from(this.selectedFolders);
  }

  private renderResultsContainer(): void {
    this.resultsEl = this.contentEl.createDiv({
      cls: 'todoseq-import-results',
    });
  }

  private renderFooter(): void {
    const footer = this.contentEl.createDiv({ cls: 'todoseq-import-footer' });
    const summary = footer.createSpan({ cls: 'todoseq-import-footer-summary' });
    this.selectionLabelEl = summary;
    const cancel = footer.createEl('button', { text: 'Cancel' });
    cancel.addEventListener('click', () => this.close());
    this.importButton = footer.createEl('button', {
      cls: 'mod-cta',
      text: 'Import selected',
    });
    this.importButton.disabled = true;
    this.importButton.addEventListener(
      'click',
      () => void this.applySelected(),
    );
  }

  private parsePriority(value: string): TodoPriority {
    return value === 'A' || value === 'B' || value === 'C' ? value : null;
  }

  private markOptionsStale(): void {
    if (this.candidates.length > 0) {
      this.statusEl?.setText('Options changed — rescan to apply.');
    }
  }

  private async runScan(): Promise<void> {
    if (this.scanning) return;
    this.scanning = true;
    this.scanned = false;
    this.updateSummary();
    if (this.scanButton) {
      this.scanButton.disabled = true;
      this.scanButton.setText('Rescan');
    }
    this.statusEl?.setText('Scanning vault…');

    try {
      const importer = new ObsidianTasksImporter(
        this.options.app,
        this.buildOptions(),
      );
      const result = await importer.scan({
        onProgress: (processed, total) => {
          this.statusEl?.setText(`Scanning vault… ${processed}/${total}`);
        },
        folderPrefixes: this.getScopePrefixes(),
      });

      this.candidates = result.candidates;
      this.selected = new Set(result.candidates.map((c) => c.path));
      this.activePath = null;
      this.scanned = true;
      this.statusEl?.setText(
        result.candidates.length === 0
          ? `No convertible tasks found in ${plural(result.scannedFiles, 'file')}.`
          : `Found ${plural(result.candidates.length, 'file')} to convert (scanned ${plural(result.scannedFiles, 'file')}).`,
      );
      this.updateSummary();
      this.renderResults();
    } catch (error) {
      this.scanned = true;
      this.statusEl?.setText('Scan failed.');
      this.updateSummary();
      new Notice('Import scan failed. See console for details.');
      console.error('TODOseq: import scan failed', error);
    } finally {
      this.scanning = false;
      if (this.scanButton) this.scanButton.disabled = false;
      this.updateImportButton();
    }
  }

  private renderResults(): void {
    if (!this.resultsEl) return;
    this.resultsEl.empty();
    if (this.candidates.length === 0) {
      this.fileListEl = null;
      this.previewEl = null;
      return;
    }

    const toolbar = this.resultsEl.createDiv({ cls: 'todoseq-import-toolbar' });
    const selectAll = toolbar.createEl('button', { text: 'Select all' });
    const selectNone = toolbar.createEl('button', { text: 'Select none' });
    const filter = toolbar.createEl('input', {
      cls: 'todoseq-import-filter',
      attr: { type: 'search', placeholder: 'Filter files' },
    });
    filter.value = this.fileFilter;

    const main = this.resultsEl.createDiv({ cls: 'todoseq-import-main' });
    this.fileListEl = main.createDiv({ cls: 'todoseq-import-files' });
    this.previewEl = main.createDiv({ cls: 'todoseq-import-preview' });

    selectAll.addEventListener('click', () => {
      for (const candidate of this.visibleCandidates()) {
        this.selected.add(candidate.path);
      }
      this.refreshFileList();
      this.updateImportButton();
    });
    selectNone.addEventListener('click', () => {
      for (const candidate of this.visibleCandidates()) {
        this.selected.delete(candidate.path);
      }
      this.refreshFileList();
      this.updateImportButton();
    });
    filter.addEventListener('input', () => {
      this.fileFilter = filter.value;
      this.refreshFileList();
    });

    this.refreshFileList();
    const first = this.visibleCandidates()[0]?.path;
    if (first) this.showPreview(first);
    this.updateImportButton();
  }

  private visibleCandidates(): ImportCandidate[] {
    const query = this.fileFilter.trim().toLowerCase();
    const sorted = [...this.candidates].sort((a, b) =>
      a.path.localeCompare(b.path),
    );
    if (query === '') return sorted;
    return sorted.filter((candidate) =>
      candidate.path.toLowerCase().includes(query),
    );
  }

  private refreshFileList(): void {
    if (!this.fileListEl) return;
    this.fileListEl.empty();
    const fragment = createFragment();

    for (const candidate of this.visibleCandidates()) {
      const row = createDiv();
      row.className = 'todoseq-import-file';
      row.dataset.path = candidate.path;
      if (candidate.path === this.activePath) row.classList.add('is-active');

      const checkbox = createEl('input');
      checkbox.type = 'checkbox';
      checkbox.checked = this.selected.has(candidate.path);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) this.selected.add(candidate.path);
        else this.selected.delete(candidate.path);
        this.updateImportButton();
      });
      row.appendChild(checkbox);

      const info = createDiv();
      info.className = 'todoseq-import-file-info';
      const pathEl = createDiv();
      pathEl.className = 'todoseq-import-file-path';
      pathEl.setText(candidate.path);

      const meta = createDiv();
      meta.className = 'todoseq-import-file-meta';
      meta.createSpan({
        text: plural(candidate.changedLineCount, 'line'),
      });
      if (candidate.warnings.length > 0) {
        meta.createSpan({
          cls: 'todoseq-import-badge is-warn',
          text: `⚠ ${candidate.warnings.length}`,
        });
      }

      info.appendChild(pathEl);
      info.appendChild(meta);
      row.appendChild(info);

      row.addEventListener('click', (event: MouseEvent) => {
        if (event.target !== checkbox) this.showPreview(candidate.path);
      });
      fragment.appendChild(row);
    }

    this.fileListEl.appendChild(fragment);
    this.updateSelectionLabel();
  }

  private updateSelectionLabel(): void {
    this.selectionLabelEl?.setText(
      `${this.selected.size} of ${this.candidates.length} selected`,
    );
  }

  private showPreview(path: string): void {
    const candidate = this.candidates.find((c) => c.path === path);
    if (!candidate || !this.previewEl) return;

    this.activePath = path;
    if (this.fileListEl) {
      for (const child of Array.from(this.fileListEl.children)) {
        const el = child as HTMLElement;
        el.classList.toggle('is-active', el.dataset.path === path);
      }
    }

    this.previewEl.empty();

    const header = this.previewEl.createDiv({
      cls: 'todoseq-import-preview-header',
    });
    const title = header.createDiv({ cls: 'todoseq-import-preview-title' });
    title.setText(path);
    const stats = header.createDiv({ cls: 'todoseq-import-preview-stats' });
    stats.createSpan({
      cls: 'todoseq-import-badge is-muted',
      text: plural(candidate.changedLineCount, 'line'),
    });
    if (candidate.warnings.length > 0) {
      stats.createSpan({
        cls: 'todoseq-import-badge is-warn',
        text: `⚠ ${plural(candidate.warnings.length, 'warning')}`,
      });
    }

    this.renderPreviewTabs(candidate);

    if (this.previewMode === 'warnings') {
      this.renderWarnings(candidate);
    } else if (this.previewMode === 'converted') {
      this.renderFullFile(candidate.convertedContent);
    } else {
      this.renderDiff(candidate.originalContent, candidate.convertedContent);
    }
  }

  private renderPreviewTabs(candidate: ImportCandidate): void {
    if (!this.previewEl) return;
    const tabs = this.previewEl.createDiv({
      cls: 'todoseq-import-preview-tabs',
    });
    const tabOptions: ReadonlyArray<{
      mode: PreviewMode;
      label: string;
      disabled?: boolean;
    }> = [
      { mode: 'changes', label: 'Changes' },
      {
        mode: 'warnings',
        label: `Warnings (${candidate.warnings.length})`,
        disabled: candidate.warnings.length === 0,
      },
      { mode: 'converted', label: 'Converted file' },
    ];

    if (candidate.warnings.length === 0 && this.previewMode === 'warnings') {
      this.previewMode = 'changes';
    }

    for (const option of tabOptions) {
      const tab = tabs.createEl('button', {
        cls: 'todoseq-import-preview-tab',
        text: option.label,
      });
      tab.type = 'button';
      tab.disabled = option.disabled === true;
      tab.classList.toggle('is-active', option.mode === this.previewMode);
      tab.addEventListener('click', () => {
        this.previewMode = option.mode;
        this.showPreview(candidate.path);
      });
    }
  }

  private renderWarnings(candidate: ImportCandidate): void {
    if (!this.previewEl) return;
    const warnings = this.previewEl.createDiv({
      cls: 'todoseq-import-warnings is-expanded',
    });
    warnings.createDiv({
      cls: 'todoseq-import-warnings-title',
      text: plural(candidate.warnings.length, 'warning') + ' in this file',
    });
    const list = warnings.createDiv({
      cls: 'todoseq-import-warnings-list',
    });
    const originalLines = candidate.originalContent.split('\n');
    const convertedLines = candidate.convertedContent.split('\n');
    for (const warning of candidate.warnings) {
      this.renderWarningItem(list, warning, originalLines, convertedLines);
    }
  }

  private renderWarningItem(
    container: HTMLElement,
    warning: string,
    originalLines: string[],
    convertedLines: string[],
  ): void {
    const item = container.createDiv({ cls: 'todoseq-import-warning-item' });
    const match = /^Line (\d+):\s*(.*)$/.exec(warning);
    const lineNumber = match ? Number(match[1]) : null;
    const message = match ? match[2] : warning;

    const header = item.createDiv({ cls: 'todoseq-import-warning-header' });
    header.createSpan({
      cls: 'todoseq-import-warning-line',
      text: lineNumber === null ? 'Warning' : `Line ${lineNumber}`,
    });
    header.createSpan({
      cls: 'todoseq-import-warning-message',
      text: message,
    });

    if (lineNumber === null) return;
    const original = originalLines[lineNumber - 1];
    const converted = convertedLines[lineNumber - 1];
    if (original === undefined && converted === undefined) return;

    const context = item.createDiv({ cls: 'todoseq-import-warning-context' });
    context.createDiv({
      cls: 'todoseq-import-warning-context-label',
      text: 'Before',
    });
    context.createEl('code', {
      cls: 'todoseq-import-warning-code',
      text: original ?? '',
    });
    context.createDiv({
      cls: 'todoseq-import-warning-context-label',
      text: 'After',
    });
    context.createEl('code', {
      cls: 'todoseq-import-warning-code',
      text: converted ?? '',
    });
  }

  private renderFullFile(content: string): void {
    if (!this.previewEl) return;
    const full = this.previewEl.createDiv({ cls: 'todoseq-import-full-file' });
    const lines = content.split('\n');
    lines.forEach((line, index) => {
      const row = full.createDiv({ cls: 'todoseq-import-full-file-row' });
      row.createSpan({
        cls: 'todoseq-import-diff-gutter',
        text: (index + 1).toString(),
      });
      row.createEl('code', {
        cls: 'todoseq-import-full-file-code',
        text: line,
      });
    });
  }

  private renderDiff(before: string, after: string): void {
    if (!this.previewEl) return;
    const diff = this.previewEl.createDiv({ cls: 'todoseq-import-diff' });

    const head = diff.createDiv({ cls: 'todoseq-import-diff-row is-head' });
    head.createSpan({ cls: 'todoseq-import-diff-gutter' });
    head.createSpan({
      cls: 'todoseq-import-diff-heading',
      text: 'Before',
    });
    head.createSpan({ cls: 'todoseq-import-diff-gutter' });
    head.createSpan({
      cls: 'todoseq-import-diff-heading',
      text: 'After',
    });

    const rows = buildDiffRows(before, after);
    const keep = new Set<number>();
    rows.forEach((row, index) => {
      if (row.kind === 'equal') return;
      for (let i = index - DIFF_CONTEXT; i <= index + DIFF_CONTEXT; i++) {
        if (i >= 0 && i < rows.length) keep.add(i);
      }
    });

    let lastRendered = -1;
    rows.forEach((row, index) => {
      if (!keep.has(index)) return;
      if (lastRendered !== -1 && index - lastRendered > 1) {
        diff.createDiv({
          cls: 'todoseq-import-diff-row is-collapsed',
          text: `⋯ ${plural(index - lastRendered - 1, 'unchanged line')}`,
        });
      }
      this.renderDiffRow(diff, row);
      lastRendered = index;
    });
  }

  private renderDiffRow(container: HTMLElement, row: DiffRow): void {
    const rowEl = container.createDiv({
      cls: `todoseq-import-diff-row is-${row.kind}`,
    });
    rowEl.createSpan({
      cls: 'todoseq-import-diff-gutter',
      text: row.leftLineNumber?.toString() ?? '',
    });
    rowEl.createEl('code', {
      cls: 'todoseq-import-diff-code is-left',
      text: row.leftText ?? '',
    });
    rowEl.createSpan({
      cls: 'todoseq-import-diff-gutter',
      text: row.rightLineNumber?.toString() ?? '',
    });
    rowEl.createEl('code', {
      cls: 'todoseq-import-diff-code is-right',
      text: row.rightText ?? '',
    });
  }

  private updateImportButton(): void {
    if (!this.importButton) return;
    const hasSelection = this.selected.size > 0;
    this.importButton.disabled =
      this.scanning || !hasSelection || this.candidates.length === 0;
    if (!this.scanning) {
      this.importButton.setText(
        hasSelection
          ? `Import ${plural(this.selected.size, 'file')}`
          : 'Import selected',
      );
    }
    this.updateSelectionLabel();
  }

  private async applySelected(): Promise<void> {
    const chosen = this.candidates.filter((c) => this.selected.has(c.path));
    if (chosen.length === 0 || !this.importButton) return;

    this.importButton.disabled = true;
    this.importButton.setText('Importing…');

    try {
      const importer = new ObsidianTasksImporter(
        this.options.app,
        this.buildOptions(),
      );
      const result = await importer.apply(chosen);
      const errorNote =
        result.errors.length > 0
          ? ` ${plural(result.errors.length, 'file')} failed.`
          : '';
      new Notice(
        `Converted ${plural(result.filesWritten, 'file')}.${errorNote}`,
      );
      await this.options.onApplied?.();
      this.close();
    } catch (error) {
      new Notice('Import failed. See console for details.');
      console.error('TODOseq: import failed', error);
      this.importButton.disabled = false;
      this.updateImportButton();
    }
  }
}
