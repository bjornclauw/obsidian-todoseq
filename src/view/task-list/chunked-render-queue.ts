const CHUNK_BATCH_SIZE = 15;
const YIELD_EVERY_N_TASKS = 5;
const PRIORITY_FIRST_BATCH = 10;

export class ChunkedRenderQueue {
  private pending: unknown[] = [];
  private isProcessing = false;
  private renderFn: ((item: unknown) => HTMLLIElement) | null = null;
  private container: Element | null = null;
  private generation = 0;
  private currentRenderPromise: Promise<void> | null = null;

  async enqueue<T>(
    items: T[],
    renderFn: (item: T) => HTMLLIElement,
    container: Element,
  ): Promise<void> {
    this.generation++;
    this.pending = [];
    this.isProcessing = false;

    this.renderFn = renderFn;
    this.container = container;
    this.pending = items;

    this.isProcessing = true;
    this.currentRenderPromise = this.processQueue();
    await this.currentRenderPromise;
    this.currentRenderPromise = null;
  }

  private async processQueue(): Promise<void> {
    const renderFn = this.renderFn;
    const container = this.container;
    const currentGeneration = this.generation;
    if (!renderFn || !container) return;

    let priorityRendered = 0;
    let renderedInBatch = 0;

    while (this.pending.length > 0) {
      if (this.generation !== currentGeneration) {
        return;
      }

      const isFirstBatch = priorityRendered < PRIORITY_FIRST_BATCH;
      const batchSize = isFirstBatch
        ? Math.min(CHUNK_BATCH_SIZE, PRIORITY_FIRST_BATCH - priorityRendered)
        : CHUNK_BATCH_SIZE;

      const batch = this.pending.splice(0, batchSize);

      for (const item of batch) {
        if (this.generation !== currentGeneration) {
          return;
        }

        const element = renderFn(item);
        container.appendChild(element);
        priorityRendered++;
        renderedInBatch++;

        if (renderedInBatch >= YIELD_EVERY_N_TASKS) {
          renderedInBatch = 0;
          await new Promise((resolve) => window.setTimeout(resolve, 0));
        }
      }
    }

    this.isProcessing = false;
  }

  clear(): void {
    this.generation++;
    this.pending = [];
    this.isProcessing = false;
  }

  get isEmpty(): boolean {
    return this.pending.length === 0 && !this.isProcessing;
  }

  async renderToFragment<T>(
    items: T[],
    renderFn: (item: T) => HTMLLIElement,
    yieldDuringRender = true,
  ): Promise<DocumentFragment> {
    const fragment = createFragment();

    for (let i = 0; i < items.length; i++) {
      const element = renderFn(items[i]);
      fragment.appendChild(element);

      if (yieldDuringRender && i > 0 && i % YIELD_EVERY_N_TASKS === 0) {
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      }
    }

    return fragment;
  }
}
