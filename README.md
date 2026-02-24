# Tauri + Vanilla TS

This template should help get you started developing with Tauri in vanilla HTML, CSS and Typescript.

## Media Layout

- Media root folder: `Documents/auto-media-player`
- Visual files (videos and images): place them in `Documents/auto-media-player/videos` (or any nested subfolder)
- Audio files (MP3): place them in `Documents/auto-media-player/audio` (or any nested subfolder)
- File discovery is recursive for both visuals and audio.
- Visual playback and MP3 playback are randomized independently and are not synchronized.
- If only one type exists (only visuals or only audio), the app still runs that type.

## Time-Based Playback (No UI)

- Config file path: `Documents/auto-media-player/playback-config.json`
- The app reads this file every time it checks for the next media file, so edits are picked up automatically.
- Default folders are created for you:
	- `videos`
	- `audio`
	- `videos/night`
	- `audio/night`

Default config template:

```json
{
	"schedules": [
		{
			"name": "night",
			"start": "20:00",
			"end": "07:00",
			"visualDirs": ["videos/night"],
			"audioDirs": ["audio/night"]
		}
	],
	"fallback": {
		"visualDirs": ["videos"],
		"audioDirs": ["audio"]
	}
}
```

Notes:

- `start` and `end` support `HH` or `HH:MM` local time.
- Overnight windows are supported (for example, `20:00` to `07:00`).
- First matching schedule wins.
- If no schedule matches, `fallback` is used.
- `visualDirs`/`audioDirs` are paths relative to `Documents/auto-media-player`.
- Recommended approach: keep stable folder names (for example `night`) and change times in config, rather than renaming folders while media is in use.

## External MP3 Prep Tool (FFmpeg)

This repo includes an external utility script for MP3 preprocessing:

- Script: `tools/mp3-process.ts`
- Runtime: Node.js with TypeScript type stripping (not part of app bundle)
- Goal: FM-radio-loud style compression + loudness normalization for easier listening in noisy environments
- Behavior:
	- Reads MP3 files recursively from an input folder
	- Writes processed MP3 files to a separate output folder (same relative structure)
	- Moves source files to an `_originals` archive folder after successful processing
	- Automatically creates missing input/output/originals folders at startup

- Default folders (under `Documents/auto-media-player`):
	- Input: `_toBeNormalized`
	- Output: `_normalized`
	- Originals archive: `_originals`

### Requirements

- FFmpeg installed and available in `PATH` (`ffmpeg`, `ffprobe`)
- Node.js version that supports `--experimental-strip-types`

### Install FFmpeg (Windows)

Use one of these options:

```powershell
winget install Gyan.FFmpeg
```

Manual install (alternative):

1. Download FFmpeg and extract to a folder (for example `C:\ffmpeg`).
2. The winget install already adds `C:\ffmpeg\bin` to your user or system `PATH`.
3. Open a new terminal and verify:

```powershell
ffmpeg -version
ffprobe -version
```

### Usage

Dry run:

```bash
npm run audio:prep:dry
```

Process files:

```bash
npm run audio:prep -- --concurrency 2
```

By default, the command uses:

- `C:\\Users\\<you>\\Documents\\auto-media-player\\_toBeNormalized`
- `C:\\Users\\<you>\\Documents\\auto-media-player\\_normalized`
- `C:\\Users\\<you>\\Documents\\auto-media-player\\_originals`

Override directories (optional):

```bash
npm run audio:prep -- --input "C:\\Users\\you\\Documents\\auto-media-player\\_toBeNormalized" --output "C:\\Users\\you\\Documents\\auto-media-player\\_normalized" --originals "C:\\Users\\you\\Documents\\auto-media-player\\_originals"
```

Optional flags:

- `--force` to overwrite already-processed output files
- `--concurrency <n>` to control parallel jobs (default: `2`)
- `--quiet` to suppress non-error logs

Tip:

- Do not run this while the player is actively using the same files.
- After processing, point your `audioDirs` in `playback-config.json` to the processed folder tree you want to use.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
