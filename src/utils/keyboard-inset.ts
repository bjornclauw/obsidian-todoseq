/** Inset below this is browser chrome wobble, not a soft keyboard. */
export const KEYBOARD_OPEN_THRESHOLD_PX = 100;

/**
 * Tracks the soft-keyboard inset on Obsidian mobile.
 *
 * Obsidian's Android WebView is keyboard-blind: `window.innerHeight` and
 * `visualViewport` stay at full height while the keyboard is up. Obsidian
 * instead writes `--keyboard-height` as an inline style on
 * `document.documentElement`, so that inline style is treated as the primary
 * signal. `visualViewport`/`innerHeight` deltas remain as fallbacks for
 * platforms that do report the keyboard through the viewport.
 *
 * The watcher is platform-agnostic; callers should gate on
 * `Platform.isMobile` to avoid unnecessary work on desktop.
 */
export class KeyboardInsetWatcher {
  private inset = 0;
  private baselineHeight = 0;
  private baselineWidth = 0;
  private observer: MutationObserver | null = null;
  private visualViewport: VisualViewport | null = null;
  private win: Window | null = null;
  private measureHandler: (() => void) | null = null;

  /**
   * Start watching the given window for keyboard inset changes.
   * @param win Window that owns the modal (supports popout windows).
   * @param onChange Called with the inset in px (0 when the keyboard is closed).
   * @returns A detach function that stops watching.
   */
  start(win: Window, onChange: (inset: number) => void): () => void {
    const doc = win.document;
    const vv = win.visualViewport ?? null;
    this.visualViewport = vv;
    this.win = win;

    this.measureHandler = () => {
      const inset = this.measure(doc, win, vv);
      if (inset === this.inset) return;
      this.inset = inset;
      onChange(inset);
    };

    // Obsidian updates --keyboard-height by rewriting documentElement's inline
    // style; the observer is the only reliable Android trigger.
    this.observer = new MutationObserver(this.measureHandler);
    this.observer.observe(doc.documentElement, {
      attributes: true,
      attributeFilter: ['style'],
    });
    vv?.addEventListener('resize', this.measureHandler);
    vv?.addEventListener('scroll', this.measureHandler);
    win.addEventListener('resize', this.measureHandler);

    // Emit the initial state in case the keyboard is already open.
    this.measureHandler();

    return () => this.stop();
  }

  /** Stop watching and reset the measured inset. */
  stop(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.measureHandler) {
      this.visualViewport?.removeEventListener('resize', this.measureHandler);
      this.visualViewport?.removeEventListener('scroll', this.measureHandler);
      this.win?.removeEventListener('resize', this.measureHandler);
      this.measureHandler = null;
    }
    this.visualViewport = null;
    this.win = null;
    this.inset = 0;
  }

  /** The most recently measured inset in px. */
  getInset(): number {
    return this.inset;
  }

  private measure(
    doc: Document,
    win: Window,
    vv: VisualViewport | null,
  ): number {
    // A rotation changes the width (a keyboard never does); reset the baseline
    // so the old height isn't misread as an open keyboard in landscape.
    if (win.innerWidth !== this.baselineWidth) {
      this.baselineWidth = win.innerWidth;
      this.baselineHeight = win.innerHeight;
    }
    this.baselineHeight = Math.max(this.baselineHeight, win.innerHeight);

    const obsidianInset = parseFloat(
      doc.documentElement.style.getPropertyValue('--keyboard-height'),
    );
    const visualInset = vv
      ? Math.max(0, win.innerHeight - vv.height - vv.offsetTop)
      : 0;
    const resizeInset = Math.max(0, this.baselineHeight - win.innerHeight);

    const inset = Math.max(
      Number.isFinite(obsidianInset) ? obsidianInset : 0,
      visualInset,
      resizeInset,
    );

    return inset > KEYBOARD_OPEN_THRESHOLD_PX ? Math.round(inset) : 0;
  }
}
