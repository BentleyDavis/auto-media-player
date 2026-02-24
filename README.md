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

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
