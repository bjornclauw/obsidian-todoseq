import { App, Modal, setIcon } from 'obsidian';

/**
 * Full-size photo viewer with zoom controls and drag-to-pan, opened from the
 * metadata frame's photo card.
 */
export class PhotoLightbox extends Modal {
  private scale = 1;
  private offsetX = 0;
  private offsetY = 0;
  private dragging = false;
  private dragStartX = 0;
  private dragStartY = 0;

  // Never zoom out below the fit size, so the image can't get smaller than the
  // lightbox.
  private readonly MIN_SCALE = 1;
  private readonly MAX_SCALE = 6;

  private imgEl: HTMLImageElement | null = null;
  private bodyEl: HTMLElement | null = null;

  constructor(
    app: App,
    private readonly src: string,
    private readonly titleText?: string,
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass('todoseq-photo-lightbox');

    const header = this.modalEl.createDiv({
      cls: 'todoseq-photo-lightbox-header',
    });
    if (this.titleText) {
      header.createSpan({
        cls: 'todoseq-photo-lightbox-title',
        text: this.titleText,
      });
    }
    const controls = header.createDiv({
      cls: 'todoseq-photo-lightbox-controls',
    });

    const zoomOut = controls.createEl('button', {
      cls: 'clickable-icon',
      attr: { 'aria-label': 'Zoom out', type: 'button' },
    });
    setIcon(zoomOut, 'zoom-out');
    zoomOut.addEventListener('click', () => this.setScale(this.scale - 0.25));

    const reset = controls.createEl('button', {
      cls: 'clickable-icon',
      attr: { 'aria-label': 'Reset zoom', type: 'button' },
    });
    setIcon(reset, 'maximize-2');
    reset.addEventListener('click', () => this.reset());

    const zoomIn = controls.createEl('button', {
      cls: 'clickable-icon',
      attr: { 'aria-label': 'Zoom in', type: 'button' },
    });
    setIcon(zoomIn, 'zoom-in');
    zoomIn.addEventListener('click', () => this.setScale(this.scale + 0.25));

    const body = this.modalEl.createDiv({ cls: 'todoseq-photo-lightbox-body' });
    this.bodyEl = body;
    this.imgEl = body.createEl('img', { cls: 'todoseq-photo-lightbox-img' });
    this.imgEl.src = this.src;
    this.imgEl.alt = this.titleText ?? '';
    this.imgEl.setAttribute('draggable', 'false');

    body.addEventListener(
      'wheel',
      (evt: WheelEvent) => {
        evt.preventDefault();
        this.setScale(this.scale + (evt.deltaY < 0 ? 0.25 : -0.25));
      },
      { passive: false },
    );

    body.addEventListener('pointerdown', this.onPointerDown);
    body.addEventListener('pointermove', this.onPointerMove);
    body.addEventListener('pointerup', this.onPointerUp);
    body.addEventListener('pointercancel', this.onPointerUp);

    this.updateCursor();
  }

  onClose(): void {
    this.bodyEl?.removeEventListener('pointerdown', this.onPointerDown);
    this.bodyEl?.removeEventListener('pointermove', this.onPointerMove);
    this.bodyEl?.removeEventListener('pointerup', this.onPointerUp);
    this.bodyEl?.removeEventListener('pointercancel', this.onPointerUp);
    this.modalEl.empty();
    this.imgEl = null;
    this.bodyEl = null;
  }

  private onPointerDown = (evt: PointerEvent): void => {
    // Only pan when there is something to pan (zoomed in).
    if (this.scale <= 1) {
      return;
    }
    this.dragging = true;
    this.dragStartX = evt.clientX - this.offsetX;
    this.dragStartY = evt.clientY - this.offsetY;
    this.bodyEl?.setPointerCapture(evt.pointerId);
    this.updateCursor();
    evt.preventDefault();
  };

  private onPointerMove = (evt: PointerEvent): void => {
    if (!this.dragging) {
      return;
    }
    this.offsetX = evt.clientX - this.dragStartX;
    this.offsetY = evt.clientY - this.dragStartY;
    this.clampOffsets();
    this.applyTransform();
  };

  private onPointerUp = (evt: PointerEvent): void => {
    if (!this.dragging) {
      return;
    }
    this.dragging = false;
    try {
      this.bodyEl?.releasePointerCapture(evt.pointerId);
    } catch {
      // Capture may already be released.
    }
    this.updateCursor();
  };

  private setScale(next: number): void {
    this.scale = Math.min(this.MAX_SCALE, Math.max(this.MIN_SCALE, next));
    // Zooming out reduces the overflow, so keep the pan within bounds.
    this.clampOffsets();
    this.applyTransform();
    this.updateCursor();
  }

  /**
   * Keep the image edges inside the lightbox: the pan may not exceed half the
   * overflow of the scaled image over the viewport (transform is centred), and
   * an axis with no overflow cannot be panned at all.
   */
  private clampOffsets(): void {
    const img = this.imgEl;
    const body = this.bodyEl;
    if (!img || !body) {
      return;
    }
    const imgW = img.clientWidth;
    const imgH = img.clientHeight;
    const viewW = body.clientWidth;
    const viewH = body.clientHeight;
    if (imgW === 0 || imgH === 0 || viewW === 0 || viewH === 0) {
      return;
    }
    const maxX = Math.max(0, (imgW * this.scale - viewW) / 2);
    const maxY = Math.max(0, (imgH * this.scale - viewH) / 2);
    this.offsetX = Math.min(maxX, Math.max(-maxX, this.offsetX));
    this.offsetY = Math.min(maxY, Math.max(-maxY, this.offsetY));
  }

  private reset(): void {
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    this.applyTransform();
    this.updateCursor();
  }

  private applyTransform(): void {
    if (this.imgEl) {
      this.imgEl.style.transform = `translate(${this.offsetX}px, ${this.offsetY}px) scale(${this.scale})`;
    }
  }

  private updateCursor(): void {
    if (!this.bodyEl) {
      return;
    }
    const canPan = this.scale > 1;
    this.bodyEl.toggleClass('todoseq-photo-pan-enabled', canPan);
    this.bodyEl.toggleClass('todoseq-photo-panning', canPan && this.dragging);
  }
}
