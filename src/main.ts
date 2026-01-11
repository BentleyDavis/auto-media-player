import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from '@tauri-apps/api/core';

let currentMedia: (HTMLVideoElement | HTMLImageElement) | null = null;
let nextMedia: (HTMLVideoElement | HTMLImageElement) | null = null;
const IMAGE_DISPLAY_SECONDS = 10;
const RETRY_DELAY_MS = 2000;
let transitionTimer: number | null = null;

// Track recently sent media
const recentlySent: string[] = [];
let maxRecentHistory = 0;

function scheduleTransition(delayMs: number = 0): void {
  if (transitionTimer) {
    clearTimeout(transitionTimer);
  }

  transitionTimer = window.setTimeout(() => {
    transitionTimer = null;
    transitionToNext().catch((error: Error) => {
      console.error('Transition failed:', error);
      scheduleTransition(RETRY_DELAY_MS);
    });
  }, delayMs);
}

async function getMediaFiles(): Promise<string[]> {
  try {
    const files = await invoke<string[]>('get_media_files');
    // Update max history size to half the total files (rounded up)
    maxRecentHistory = Math.ceil(files.length / 2);
    return files;
  } catch (error) {
    console.error('Failed to get media files:', error);
    return [];
  }
}

function getRandomUnrecentMedia(files: string[]): string | null {
  if (files.length === 0) return null;
  
  // Filter out recently sent files
  const availableFiles = files.filter(f => !recentlySent.includes(f));
  
  // If all files were recently sent, clear the history and use all files
  const poolToUse = availableFiles.length > 0 ? availableFiles : files;
  
  // Select random file from available pool
  const randomIndex = Math.floor(Math.random() * poolToUse.length);
  const selectedFile = poolToUse[randomIndex];
  
  // Add to history
  recentlySent.push(selectedFile);
  
  // Keep history at exactly max size
  recentlySent.splice(0, Math.max(0, recentlySent.length - maxRecentHistory));
  
  return selectedFile;
}

async function fetchNextMedia(): Promise<string | null> {
  try {
    const files = await getMediaFiles();
    const selectedFile = getRandomUnrecentMedia(files);
    
    if (!selectedFile) {
      console.error('No media files available');
      return null;
    }
    
    // Get the full file path from Rust
    const filePath = await invoke<string>('get_media_path', { filename: selectedFile });
    console.log('File path from Rust:', filePath);
    
    // Convert to asset URL
    const assetUrl = convertFileSrc(filePath);
    console.log('Converted asset URL:', assetUrl);
    
    return assetUrl;
  } catch (error) {
    console.error('Failed to fetch media:', error);
    return null;
  }
}

function cleanupMediaElement(element: HTMLVideoElement | HTMLImageElement | null): void {
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

function createMediaElement(url: string): HTMLVideoElement | HTMLImageElement {
  const isVideo = url.endsWith('.mp4') || url.endsWith('.webm') || url.endsWith('.mkv') || url.endsWith('.mov');
  
  if (isVideo) {
    const video = document.createElement('video');
    video.src = url;
    video.controls = false;
    video.autoplay = false;
    video.muted = true;
    video.playsInline = true;
    video.disableRemotePlayback = true;
    video.preload = 'auto';
    
    const onEnded = () => scheduleTransition();
    const onError = () => scheduleTransition(RETRY_DELAY_MS);
    
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
    
    const onError = () => scheduleTransition(RETRY_DELAY_MS);
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

async function showCurrentMedia(): Promise<void> {
  try {
    if (!nextMedia) {
      console.warn('No next media ready');
      scheduleTransition(RETRY_DELAY_MS);
      return;
    }
    
    const oldMedia = currentMedia;
    currentMedia = nextMedia;
    nextMedia = null;
    
    if ((currentMedia as any)._isVideo) {
      (currentMedia as HTMLVideoElement).play().catch((err: Error) => {
        console.error('Play failed:', err);
        scheduleTransition(RETRY_DELAY_MS);
      });
    } else {
      scheduleTransition(IMAGE_DISPLAY_SECONDS * 1000);
    }
    
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (currentMedia) {
          currentMedia.style.opacity = '1';
        }
      });
    });
    
    if (oldMedia) {
      oldMedia.style.opacity = '0';
      setTimeout(() => {
        if ((oldMedia as any)._cleanupListeners) {
          (oldMedia as any)._cleanupListeners();
        }
        cleanupMediaElement(oldMedia);
        oldMedia.remove();
      }, 500);
    }
    
    await prepareNextMedia();
  } catch (error) {
    console.error('Failed to show media:', error);
    scheduleTransition(RETRY_DELAY_MS);
  }
}

async function prepareNextMedia(): Promise<void> {
  try {
    const url = await fetchNextMedia();
    if (!url) {
      console.warn('No media URL returned');
      return;
    }
    
    if (nextMedia) {
      if ((nextMedia as any)._cleanupListeners) {
        (nextMedia as any)._cleanupListeners();
      }
      cleanupMediaElement(nextMedia);
      nextMedia.remove();
    }
    
    nextMedia = createMediaElement(url);
    const mediaDiv = document.getElementById('media-container');
    if (mediaDiv) {
      mediaDiv.appendChild(nextMedia);
    }
  } catch (error) {
    console.error('Failed to prepare next media:', error);
  }
}

async function transitionToNext(): Promise<void> {
  try {
    await showCurrentMedia();
  } catch (error) {
    console.error('Error during transition:', error);
    scheduleTransition(RETRY_DELAY_MS);
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  try {
    await prepareNextMedia();
    await showCurrentMedia();
  } catch (error) {
    console.error('Failed to start media loop:', error);
    scheduleTransition(RETRY_DELAY_MS);
  }
});
