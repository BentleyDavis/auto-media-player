import type { MediaLoopAdapter, NextMedia } from '../mediaLoop';

export type AudioElement = HTMLAudioElement & { _cleanupListeners?: () => void };

function cleanupAudioElement(element: HTMLAudioElement | null): void {
  if (!element) return;
  element.pause();
  element.removeAttribute('src');
  element.load();
}

function createAudioElement(url: string, scheduleNext: () => void, scheduleRetry: () => void): AudioElement {
  const audio = new Audio(url) as AudioElement;
  audio.preload = 'auto';

  const onEnded = () => scheduleNext();
  const onError = () => scheduleRetry();

  audio.addEventListener('ended', onEnded);
  audio.addEventListener('error', onError);

  audio._cleanupListeners = () => {
    audio.removeEventListener('ended', onEnded);
    audio.removeEventListener('error', onError);
  };

  return audio;
}

export function createAudioAdapter(options: {
  retryDelayMs: number;
  fetchNextMedia: () => Promise<NextMedia | null>;
}): MediaLoopAdapter<AudioElement> {
  const { retryDelayMs, fetchNextMedia } = options;

  return {
    name: 'audio',
    retryDelayMs,
    fetchNextMedia,
    createElement: (media, controls) =>
      createAudioElement(media.url, () => controls.scheduleNext(), () => controls.scheduleRetry(retryDelayMs)),
    activateElement: async (element) => {
      await element.play();
    },
    cleanupElement: (element) => {
      cleanupAudioElement(element);
    },
    retireCurrentElement: (element, dispose) => {
      dispose(element);
    },
  };
}