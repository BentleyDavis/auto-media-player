export interface NextMedia {
  url: string;
  relativePath: string;
}

export interface LoopControls {
  scheduleNext: (delayMs?: number) => void;
  scheduleRetry: (delayMs?: number) => void;
}

type CleanupCapable = {
  _cleanupListeners?: () => void;
};

export interface MediaLoopAdapter<TElement extends CleanupCapable> {
  name: string;
  retryDelayMs: number;
  fetchNextMedia: () => Promise<NextMedia | null>;
  createElement: (media: NextMedia, controls: LoopControls) => TElement;
  activateElement: (element: TElement, controls: LoopControls) => Promise<void>;
  cleanupElement: (element: TElement) => void;
  mountElement?: (element: TElement) => void;
  unmountElement?: (element: TElement) => void;
  retireCurrentElement: (element: TElement, dispose: (value: TElement) => void) => void;
}

export class MediaLoop<TElement extends CleanupCapable> {
  private currentElement: TElement | null = null;
  private nextElement: TElement | null = null;
  private transitionTimer: number | null = null;

  constructor(private readonly adapter: MediaLoopAdapter<TElement>) {}

  private readonly controls: LoopControls = {
    scheduleNext: (delayMs: number = 0) => this.scheduleTransition(delayMs),
    scheduleRetry: (delayMs: number = this.adapter.retryDelayMs) => this.scheduleTransition(delayMs),
  };

  private cleanupListeners(element: TElement | null): void {
    if (!element || !element._cleanupListeners) {
      return;
    }
    element._cleanupListeners();
  }

  private disposeElement = (element: TElement): void => {
    this.cleanupListeners(element);
    this.adapter.cleanupElement(element);
    this.adapter.unmountElement?.(element);
  };

  private async prepareNext(): Promise<void> {
    try {
      const media = await this.adapter.fetchNextMedia();
      if (!media) {
        console.warn(`No ${this.adapter.name} media URL returned`);
        return;
      }

      if (this.nextElement) {
        this.disposeElement(this.nextElement);
      }

      this.nextElement = this.adapter.createElement(media, this.controls);
      this.adapter.mountElement?.(this.nextElement);
    } catch (error) {
      console.error(`Failed to prepare next ${this.adapter.name}:`, error);
    }
  }

  private async transitionToNext(): Promise<void> {
    try {
      if (!this.nextElement) {
        await this.prepareNext();
      }

      if (!this.nextElement) {
        console.warn(`No next ${this.adapter.name} ready`);
        this.controls.scheduleRetry();
        return;
      }

      const candidate = this.nextElement;
      const previous = this.currentElement;

      try {
        await this.adapter.activateElement(candidate, this.controls);
      } catch (error) {
        console.error(`${this.adapter.name} activation failed:`, error);
        this.disposeElement(candidate);

        if (this.nextElement === candidate) {
          this.nextElement = null;
        }

        await this.prepareNext();
        this.controls.scheduleRetry();
        return;
      }

      this.currentElement = candidate;
      this.nextElement = null;

      if (previous) {
        this.adapter.retireCurrentElement(previous, this.disposeElement);
      }

      await this.prepareNext();
    } catch (error) {
      console.error(`Error during ${this.adapter.name} transition:`, error);
      this.controls.scheduleRetry();
    }
  }

  scheduleTransition(delayMs: number = 0): void {
    if (this.transitionTimer) {
      clearTimeout(this.transitionTimer);
    }

    this.transitionTimer = window.setTimeout(() => {
      this.transitionTimer = null;
      this.transitionToNext().catch((error: Error) => {
        console.error(`${this.adapter.name} transition failed:`, error);
        this.controls.scheduleRetry();
      });
    }, delayMs);
  }

  async start(): Promise<void> {
    await this.prepareNext();
    await this.transitionToNext();
  }
}