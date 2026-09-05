import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from '@tauri-apps/api/core';
import { MediaLoop, type NextMedia } from './mediaLoop';
import { createVisualAdapter, type VisualElement } from './mediaAdapters/visualAdapter';
import { createAudioAdapter, type AudioElement } from './mediaAdapters/audioAdapter';
type MediaKind = 'visual' | 'audio';

interface MediaCatalog {
  visuals: string[];
  audios: string[];
  currentSchedule: ScheduleRule | null;
}

interface ScheduleRule {
  name?: string;
  start?: string;
  end?: string;
  brightness?: number;
  volume?: number;
  visualDirs?: string[];
  audioDirs?: string[];
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

const IMAGE_DISPLAY_SECONDS = 10;
const RETRY_DELAY_MS = 2000;

const selectors: Record<MediaKind, RandomRecentSelector> = {
  visual: new RandomRecentSelector(),
  audio: new RandomRecentSelector(),
};

let currentAudioVolume = 1;

function normalizePercent(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(100, Math.max(0, value))
    : fallback;
}

function applyBrightness(brightness: number | undefined): void {
  const overlay = document.getElementById('brightness-overlay');
  if (!overlay) {
    return;
  }

  const normalizedBrightness = normalizePercent(brightness, 100);
  overlay.style.opacity = String(1 - normalizedBrightness / 100);
}

function applyPlaybackSettings(schedule: ScheduleRule | null): void {
  applyBrightness(schedule?.brightness);
  currentAudioVolume = normalizePercent(schedule?.volume, 100) / 100;
}

async function getMediaFiles(): Promise<MediaCatalog> {
  try {
    const mediaCatalog = await invoke<MediaCatalog>('get_media_files');
    applyPlaybackSettings(mediaCatalog.currentSchedule);
    return mediaCatalog;
  } catch (error) {
    console.error('Failed to get media files:', error);
    applyPlaybackSettings(null);
    return { visuals: [], audios: [], currentSchedule: null };
  }
}

async function fetchNextMedia(kind: MediaKind): Promise<NextMedia | null> {
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

const visualLoop = new MediaLoop<VisualElement>(
  createVisualAdapter({
    retryDelayMs: RETRY_DELAY_MS,
    imageDisplaySeconds: IMAGE_DISPLAY_SECONDS,
    fetchNextMedia: () => fetchNextMedia('visual'),
  }),
);

const audioLoop = new MediaLoop<AudioElement>(
  createAudioAdapter({
    retryDelayMs: RETRY_DELAY_MS,
    fetchNextMedia: () => fetchNextMedia('audio'),
    getVolume: () => currentAudioVolume,
  }),
);

window.addEventListener('DOMContentLoaded', async () => {
  try {
    const mediaCatalog = await getMediaFiles();

    if (mediaCatalog.visuals.length > 0) {
      await visualLoop.start();
    } else {
      console.warn('No visual media files found');
    }

    if (mediaCatalog.audios.length > 0) {
      await audioLoop.start();
    } else {
      console.warn('No audio media files found');
    }
  } catch (error) {
    console.error('Failed to start media loops:', error);
    visualLoop.scheduleTransition(RETRY_DELAY_MS);
    audioLoop.scheduleTransition(RETRY_DELAY_MS);
  }
});
