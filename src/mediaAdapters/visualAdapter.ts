import type { LoopControls, MediaLoopAdapter, NextMedia } from '../mediaLoop';

export type VisualElement = (HTMLVideoElement | HTMLImageElement) & {
  _cleanupListeners?: () => void;
  _isVideo: boolean;
};

function isVideoPath(path: string): boolean {
  const lowerPath = path.toLowerCase();
  return lowerPath.endsWith('.mp4') || lowerPath.endsWith('.webm') || lowerPath.endsWith('.mkv') || lowerPath.endsWith('.mov');
}

function cleanupVisualElement(element: VisualElement | null): void {
  if (!element) return;

  if (element.tagName === 'VIDEO') {
    const video = element as HTMLVideoElement;
    video.pause();
    video.removeAttribute('src');
    video.load();
  } else if (element.tagName === 'IMG') {
    element.removeAttribute('src');
  }
}

function createVisualElement(url: string, relativePath: string, controls: LoopControls, retryDelayMs: number): VisualElement {
  const isVideo = isVideoPath(relativePath);

  if (isVideo) {
    const video = document.createElement('video');
    video.src = url;
    video.controls = false;
    video.autoplay = false;
    video.muted = true;
    video.playsInline = true;
    video.disableRemotePlayback = true;
    video.preload = 'auto';

    const onEnded = () => controls.scheduleNext();
    const onError = () => controls.scheduleRetry(retryDelayMs);

    video.addEventListener('ended', onEnded);
    video.addEventListener('error', onError);

    (video as VisualElement)._cleanupListeners = () => {
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('error', onError);
    };

    (video as VisualElement)._isVideo = true;
    video.classList.add('media', 'media-video');
    video.style.opacity = '0';

    return video as VisualElement;
  }

  const img = document.createElement('img');
  img.src = url;

  const onError = () => controls.scheduleRetry(retryDelayMs);
  img.addEventListener('error', onError);

  (img as VisualElement)._cleanupListeners = () => {
    img.removeEventListener('error', onError);
  };

  (img as VisualElement)._isVideo = false;
  img.classList.add('media', 'media-image');
  img.style.opacity = '0';

  return img as VisualElement;
}

export function createVisualAdapter(options: {
  retryDelayMs: number;
  imageDisplaySeconds: number;
  fetchNextMedia: () => Promise<NextMedia | null>;
}): MediaLoopAdapter<VisualElement> {
  const { retryDelayMs, imageDisplaySeconds, fetchNextMedia } = options;

  return {
    name: 'visual',
    retryDelayMs,
    fetchNextMedia,
    createElement: (media, controls) => createVisualElement(media.url, media.relativePath, controls, retryDelayMs),
    mountElement: (element) => {
      const mediaDiv = document.getElementById('media-container');
      if (mediaDiv) {
        mediaDiv.appendChild(element);
      }
    },
    unmountElement: (element) => {
      element.remove();
    },
    activateElement: async (element, controls) => {
      if (element._isVideo) {
        await (element as HTMLVideoElement).play();
      } else {
        controls.scheduleNext(imageDisplaySeconds * 1000);
      }

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          element.style.opacity = '1';
        });
      });
    },
    cleanupElement: (element) => {
      cleanupVisualElement(element);
    },
    retireCurrentElement: (element, dispose) => {
      element.style.opacity = '0';
      setTimeout(() => {
        dispose(element);
      }, 500);
    },
  };
}