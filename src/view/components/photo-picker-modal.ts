import { App, Modal, Platform, TFile, setIcon } from 'obsidian';
import { imageMatchesQuery, isImagePath } from '../../utils/task-photo';

export type PhotoSelection =
  { kind: 'vault'; file: TFile } | { kind: 'file'; file: File };

export interface PhotoPickerOptions {
  /** Called with the chosen image (vault file or freshly picked File). */
  onSelect: (selection: PhotoSelection) => void | Promise<void>;
  /** Called when the modal closes without a selection (cancelled). */
  onClose?: () => void;
  /** How many cells to append per render batch. Default 120. */
  batchSize?: number;
}

/**
 * Visual image picker: a scrollable thumbnail grid with a search filter, plus
 * upload / camera actions.
 *
 * Performance: cells are appended in batches as the user scrolls (a scroll
 * listener, not a fragile sentinel), and each `<img>` uses native lazy loading
 * + async decoding so offscreen thumbnails are neither fetched nor decoded.
 */
export class PhotoPickerModal extends Modal {
  private allImages: TFile[] = [];
  private filtered: TFile[] = [];
  private renderedCount = 0;
  private readonly batchSize: number;

  private gridEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private scrollEl: HTMLElement | null = null;
  private searchDebounce: number | null = null;
  private scrollRaf = 0;

  constructor(
    app: App,
    private readonly options: PhotoPickerOptions,
  ) {
    super(app);
    this.batchSize = options.batchSize ?? 120;
  }

  onOpen(): void {
    this.titleEl.setText('Add photo');
    this.modalEl.addClass('todoseq-photo-picker-modal');
    const root = this.contentEl;
    root.addClass('todoseq-photo-picker');

    const header = root.createDiv({ cls: 'todoseq-photo-picker-header' });

    const actions = header.createDiv({ cls: 'todoseq-photo-picker-actions' });
    const chooseBtn = actions.createEl('button', {
      cls: 'mod-cta',
      attr: { type: 'button' },
    });
    setIcon(
      chooseBtn.createSpan({ cls: 'todoseq-photo-picker-btn-icon' }),
      'image',
    );
    chooseBtn.createSpan({ text: 'Choose image' });
    chooseBtn.addEventListener('click', () => this.pickFile(false));

    if (Platform.isMobile) {
      const cameraBtn = actions.createEl('button', {
        attr: { type: 'button' },
      });
      setIcon(
        cameraBtn.createSpan({ cls: 'todoseq-photo-picker-btn-icon' }),
        'camera',
      );
      cameraBtn.createSpan({ text: 'Take photo' });
      cameraBtn.addEventListener('click', () => this.pickFile(true));
    }

    const searchInput = header.createEl('input', {
      cls: 'todoseq-photo-picker-search',
      attr: {
        type: 'search',
        placeholder: 'Search images…',
        'aria-label': 'Search images',
      },
    });
    searchInput.addEventListener('input', () =>
      this.onSearch(searchInput.value),
    );

    this.statusEl = root.createDiv({ cls: 'todoseq-photo-picker-status' });

    this.scrollEl = root.createDiv({ cls: 'todoseq-photo-picker-scroll' });
    this.gridEl = this.scrollEl.createDiv({
      cls: 'todoseq-photo-picker-grid',
    });
    this.scrollEl.addEventListener('scroll', this.onScroll, { passive: true });

    this.allImages = this.getRecentImages();
    this.filtered = this.allImages;

    this.renderNextBatch();
    window.setTimeout(() => searchInput.focus(), 0);
  }

  onClose(): void {
    if (this.searchDebounce !== null) {
      window.clearTimeout(this.searchDebounce);
      this.searchDebounce = null;
    }
    if (this.scrollRaf) {
      window.cancelAnimationFrame(this.scrollRaf);
      this.scrollRaf = 0;
    }
    this.scrollEl?.removeEventListener('scroll', this.onScroll);
    this.gridEl = null;
    this.statusEl = null;
    this.scrollEl = null;
    this.contentEl.empty();
    this.options.onClose?.();
  }

  private onScroll = (): void => {
    if (this.scrollRaf) {
      return;
    }
    this.scrollRaf = window.requestAnimationFrame(() => {
      this.scrollRaf = 0;
      const el = this.scrollEl;
      if (!el) {
        return;
      }
      // Load more when within one viewport of the bottom.
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - el.clientHeight) {
        this.renderNextBatch();
      }
    });
  };

  private onSearch(value: string): void {
    if (this.searchDebounce !== null) {
      window.clearTimeout(this.searchDebounce);
    }
    this.searchDebounce = window.setTimeout(() => {
      this.searchDebounce = null;
      this.filtered = this.allImages.filter((file) =>
        imageMatchesQuery(file.path, value),
      );
      this.resetGrid();
      this.renderNextBatch();
    }, 120);
  }

  private resetGrid(): void {
    if (!this.gridEl) {
      return;
    }
    this.gridEl.empty();
    this.renderedCount = 0;
    if (this.scrollEl) {
      this.scrollEl.scrollTop = 0;
    }
  }

  private renderNextBatch(): void {
    if (!this.gridEl || !this.statusEl) {
      return;
    }
    const end = Math.min(
      this.renderedCount + this.batchSize,
      this.filtered.length,
    );
    for (let i = this.renderedCount; i < end; i++) {
      this.renderCell(this.filtered[i]);
    }
    this.renderedCount = end;

    if (this.filtered.length === 0) {
      this.statusEl.setText(
        this.allImages.length === 0
          ? 'No images in the vault yet.'
          : 'No images match your search.',
      );
      return;
    }
    this.statusEl.setText(
      `${this.renderedCount} of ${this.filtered.length} image${
        this.filtered.length === 1 ? '' : 's'
      }`,
    );
  }

  private renderCell(file: TFile): void {
    if (!this.gridEl) {
      return;
    }
    const cell = this.gridEl.createEl('button', {
      cls: 'todoseq-photo-picker-cell',
      attr: { type: 'button', 'aria-label': file.basename, title: file.path },
    });
    const img = cell.createEl('img', { cls: 'todoseq-photo-picker-thumb' });
    img.alt = file.basename;
    img.setAttribute('draggable', 'false');
    // Native lazy loading + async decode keeps scrolling smooth on large grids.
    img.setAttribute('loading', 'lazy');
    img.setAttribute('decoding', 'async');
    img.src = this.app.vault.getResourcePath(file);
    cell.addEventListener('click', () => {
      void this.choose({ kind: 'vault', file });
    });
  }

  private pickFile(capture: boolean): void {
    const input = this.contentEl.createEl('input', {
      attr: { type: 'file', accept: 'image/*' },
    });
    if (capture) {
      input.setAttribute('capture', 'environment');
    }
    input.addClass('todoseq-hidden');
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file) {
        void this.choose({ kind: 'file', file });
      }
      input.remove();
    });
    input.click();
  }

  private async choose(selection: PhotoSelection): Promise<void> {
    this.close();
    await this.options.onSelect(selection);
  }

  private getRecentImages(): TFile[] {
    return this.app.vault
      .getFiles()
      .filter((file) => isImagePath(file.path))
      .sort((a, b) => (b.stat?.mtime ?? 0) - (a.stat?.mtime ?? 0));
  }
}
