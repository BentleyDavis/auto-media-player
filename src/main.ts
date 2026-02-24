import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from '@tauri-apps/api/core';

type VisualElement = HTMLVideoElement | HTMLImageElement;
type MediaKind = 'visual' | 'audio';

interface MediaCatalog {
  visuals: string[];
  audios: string[];
}

class RandomRecentSelector {
  private recentlySent: string[] = [];
  private maxRecentHistory = 0;

  select(files: string[]): string | null {
    if (files.length === 0) {
      return null;
    }

    this.maxRecentHistory = Math.ceil(files.length / 2);
    const availableFiles = files.filter(file => !this.recentlySent.includes(file));
    const pool = availableFiles.length > 0 ? availableFiles : files;
    const randomIndex = Math.floor(Math.random() * pool.length);
    const selected = pool[randomIndex];

    this.recentlySent.push(selected);
    this.recentlySent.splice(0, Math.max(0, this.recentlySent.length - this.maxRecentHistory));

    return selected;
  }
}

let currentVisual: VisualElement | null = null;
let nextVisual: VisualElement | null = null;
let currentAudio: HTMLAudioElement | null = null;
let nextAudio: HTMLAudioElement | null = null;

const IMAGE_DISPLAY_SECONDS = 10;
const RETRY_DELAY_MS = 2000;
let visualTransitionTimer: number | null = null;
let audioRetryTimer: number | null = null;

const selectors: Record<MediaKind, RandomRecentSelector> = {
  visual: new RandomRecentSelector(),
  audio: new RandomRecentSelector(),
};

function scheduleVisualTransition(delayMs: number = 0): void {
  if (visualTransitionTimer) {
    clearTimeout(visualTransitionTimer);
  }

  visualTransitionTimer = window.setTimeout(() => {
    visualTransitionTimer = null;
    transitionToNextVisual().catch((error: Error) => {
      console.error('Visual transition failed:', error);
      scheduleVisualTransition(RETRY_DELAY_MS);
    });
  }, delayMs);
}

function scheduleAudioRetry(delayMs: number = RETRY_DELAY_MS): void {
  if (audioRetryTimer) {
    clearTimeout(audioRetryTimer);
  }

  audioRetryTimer = window.setTimeout(() => {
    audioRetryTimer = null;
    transitionToNextAudio().catch((error: Error) => {
      console.error('Audio transition failed:', error);
      scheduleAudioRetry(RETRY_DELAY_MS);
    });
  }, delayMs);
}

async function getMediaFiles(): Promise<MediaCatalog> {
  try {
    return await invoke<MediaCatalog>('get_media_files');
  } catch (error) {
    console.error('Failed to get media files:', error);
    return { visuals: [], audios: [] };
  }
}

function isVideoPath(path: string): boolean {
  const lowerPath = path.toLowerCase();
  return lowerPath.endsWith('.mp4') || lowerPath.endsWith('.webm') || lowerPath.endsWith('.mkv') || lowerPath.endsWith('.mov');
}

async function fetchNextMedia(kind: MediaKind): Promise<{ url: string; relativePath: string } | null> {
  try {
    const mediaCatalog = await getMediaFiles();
    const files = kind === 'visual' ? mediaCatalog.visuals : mediaCatalog.audios;
    const selectedFile = selectors[kind].select(files);

    if (!selectedFile) {
      console.warn(`No ${kind} files available`);
      return null;
    }

    const filePath = await invoke<string>('get_media_path', { filename: selectedFile });
    const assetUrl = convertFileSrc(filePath);

    return { url: assetUrl, relativePath: selectedFile };
  } catch (error) {
    console.error(`Failed to fetch ${kind} media:`, error);
    return null;
  }
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

function cleanupAudioElement(element: HTMLAudioElement | null): void {
  if (!element) return;
  element.pause();
  element.removeAttribute('src');
  element.load();
}

function cleanupElementListeners(element: { _cleanupListeners?: () => void } | null): void {
  if (!element || !element._cleanupListeners) {
    return;
  }
  element._cleanupListeners();
}

function createVisualElement(url: string, relativePath: string): VisualElement {
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

    const onEnded = () => scheduleVisualTransition();
    const onError = () => scheduleVisualTransition(RETRY_DELAY_MS);

    video.addEventListener('ended', onEnded);
    video.addEventListener('error', onError);

    (video as any)._cleanupListeners = () => {
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('error', onError);
    };

    (video as any)._isVideo = true;
    video.classList.add('media', 'media-video');
    video.style.opacity = '0';

    return video;
  } else {
    const img = document.createElement('img');
    img.src = url;

    const onError = () => scheduleVisualTransition(RETRY_DELAY_MS);
    img.addEventListener('error', onError);

    (img as any)._cleanupListeners = () => {
      img.removeEventListener('error', onError);
    };

    (img as any)._isVideo = false;
    img.classList.add('media', 'media-image');
    img.style.opacity = '0';

    return img;
  }
}

function createAudioElement(url: string): HTMLAudioElement {
  const audio = new Audio(url);
  audio.preload = 'auto';

  const onEnded = () => scheduleAudioRetry();
  const onError = () => scheduleAudioRetry(RETRY_DELAY_MS);

  audio.addEventListener('ended', onEnded);
  audio.addEventListener('error', onError);

  (audio as any)._cleanupListeners = () => {
    audio.removeEventListener('ended', onEnded);
    audio.removeEventListener('error', onError);
  };

  return audio;
}

async function showCurrentVisual(): Promise<void> {
  try {
    if (!nextVisual) {
      console.warn('No next visual ready');
      scheduleVisualTransition(RETRY_DELAY_MS);
      return;
    }

    const oldVisual = currentVisual;
    currentVisual = nextVisual;
    nextVisual = null;

    if ((currentVisual as any)._isVideo) {
      (currentVisual as HTMLVideoElement).play().catch((err: Error) => {
        console.error('Play failed:', err);
        scheduleVisualTransition(RETRY_DELAY_MS);
      });
    } else {
      scheduleVisualTransition(IMAGE_DISPLAY_SECONDS * 1000);
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (currentVisual) {
          currentVisual.style.opacity = '1';
        }
      });
    });

    if (oldVisual) {
      oldVisual.style.opacity = '0';
      setTimeout(() => {
        cleanupElementListeners(oldVisual as any);
        cleanupVisualElement(oldVisual);
        oldVisual.remove();
      }, 500);
    }

    await prepareNextVisual();
  } catch (error) {
    console.error('Failed to show visual media:', error);
    scheduleVisualTransition(RETRY_DELAY_MS);
  }
}

async function prepareNextVisual(): Promise<void> {
  try {
    const media = await fetchNextMedia('visual');
    if (!media) {
      console.warn('No visual media URL returned');
      return;
    }

    if (nextVisual) {
      cleanupElementListeners(nextVisual as any);
      cleanupVisualElement(nextVisual);
      nextVisual.remove();
    }

    nextVisual = createVisualElement(media.url, media.relativePath);
    const mediaDiv = document.getElementById('media-container');
    if (mediaDiv) {
      mediaDiv.appendChild(nextVisual);
    }
  } catch (error) {
    console.error('Failed to prepare next visual:', error);
  }
}

async function transitionToNextVisual(): Promise<void> {
  try {
    await showCurrentVisual();
  } catch (error) {
    console.error('Error during visual transition:', error);
    scheduleVisualTransition(RETRY_DELAY_MS);
  }
}

async function startNextAudio(): Promise<void> {
  try {
    await prepareNextAudio();
    await showCurrentAudio();
  } catch (error) {
    console.error('Failed to start audio playback:', error);
    scheduleAudioRetry(RETRY_DELAY_MS);
  }
}

async function prepareNextAudio(): Promise<void> {
  try {
    const media = await fetchNextMedia('audio');
    if (!media) {
      console.warn('No audio media URL returned');
      return;
    }

    if (nextAudio) {
      cleanupElementListeners(nextAudio as any);
      cleanupAudioElement(nextAudio);
    }

    nextAudio = createAudioElement(media.url);
  } catch (error) {
    console.error('Failed to prepare next audio:', error);
  }
}

async function showCurrentAudio(): Promise<void> {
  try {
    if (!nextAudio) {
      console.warn('No next audio ready');
      scheduleAudioRetry(RETRY_DELAY_MS);
      return;
    }

    const oldAudio = currentAudio;
    currentAudio = nextAudio;
    nextAudio = null;

    await currentAudio.play();

    if (oldAudio) {
      cleanupElementListeners(oldAudio as any);
      cleanupAudioElement(oldAudio);
    }

    await prepareNextAudio();
  } catch (error) {
    console.error('Failed to show audio media:', error);
    scheduleAudioRetry(RETRY_DELAY_MS);
  }
}

async function transitionToNextAudio(): Promise<void> {
  try {
    await showCurrentAudio();
  } catch (error) {
    console.error('Error during audio transition:', error);
    scheduleAudioRetry(RETRY_DELAY_MS);
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  try {
    const mediaCatalog = await getMediaFiles();

    if (mediaCatalog.visuals.length > 0) {
      await prepareNextVisual();
      await showCurrentVisual();
    } else {
      console.warn('No visual media files found');
    }

    if (mediaCatalog.audios.length > 0) {
      await startNextAudio();
    } else {
      console.warn('No audio media files found');
    }
  } catch (error) {
    console.error('Failed to start media loops:', error);
    scheduleVisualTransition(RETRY_DELAY_MS);
    scheduleAudioRetry(RETRY_DELAY_MS);
  }
});
