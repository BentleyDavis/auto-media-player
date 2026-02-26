use std::fs;
use std::path::Path;
use std::path::PathBuf;
use chrono::{Local, Timelike};
use serde::Deserialize;
use serde::Serialize;
use tauri_plugin_opener::OpenerExt;

const VISUAL_EXTENSIONS: [&str; 9] = [".mp4", ".webm", ".mkv", ".mov", ".jpg", ".jpeg", ".png", ".gif", ".webp"];
const AUDIO_EXTENSIONS: [&str; 1] = [".mp3"];
const APP_NAME: &str = "auto-media-player";
const PLAYBACK_CONFIG_FILE: &str = "playback-config.json";
const DEFAULT_PLAYBACK_CONFIG: &str = include_str!("../defaults/playback-config.json");

#[derive(Serialize)]
struct MediaCatalog {
    visuals: Vec<String>,
    audios: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PlaybackConfig {
    schedules: Vec<ScheduleRule>,
    fallback: Option<MediaFilter>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ScheduleRule {
    name: Option<String>,
    start: String,
    end: String,
    visual_dirs: Option<Vec<String>>,
    audio_dirs: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct MediaFilter {
    visual_dirs: Option<Vec<String>>,
    audio_dirs: Option<Vec<String>>,
}

#[tauri::command]
fn get_media_files() -> Result<MediaCatalog, String> {
    let media_dir = get_media_directory();

    if !media_dir.exists() {
        fs::create_dir_all(&media_dir)
            .map_err(|e| format!("Failed to create media directory: {}", e))?;
        ensure_default_playback_config(&media_dir)?;
        ensure_media_subfolders(&media_dir)?;
        return Ok(MediaCatalog {
            visuals: Vec::new(),
            audios: Vec::new(),
        });
    }

    ensure_default_playback_config(&media_dir)?;

    let catalog = collect_media_recursive(&media_dir)?;
    Ok(apply_time_based_filter(&media_dir, catalog))
}

#[tauri::command]
fn get_media_path(filename: String) -> Result<String, String> {
    let media_dir = get_media_directory();

    let canonical_root = media_dir
        .canonicalize()
        .map_err(|e| format!("Failed to access media directory: {}", e))?;

    let file_path = media_dir.join(&filename);

    if !file_path.exists() {
        return Err(format!("File not found: {}", filename));
    }

    match file_path.canonicalize() {
        Ok(absolute_path) => {
            if !absolute_path.starts_with(&canonical_root) {
                return Err("Invalid media path".to_string());
            }

            if !absolute_path.is_file() {
                return Err("Resolved media path is not a file".to_string());
            }

            Ok(absolute_path.to_string_lossy().to_string())
        }
        Err(e) => Err(format!("Failed to get absolute path: {}", e))
    }
}

fn classify_relative_path(relative: String) -> Option<(bool, String)> {
    let ext_lower = Path::new(&relative)
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy().to_lowercase()))?;

    if VISUAL_EXTENSIONS.contains(&ext_lower.as_str()) {
        return Some((true, relative));
    }

    if AUDIO_EXTENSIONS.contains(&ext_lower.as_str()) {
        return Some((false, relative));
    }

    None
}

fn to_relative_unix_path(base_dir: &Path, file_path: &Path) -> Option<String> {
    let relative = file_path.strip_prefix(base_dir).ok()?;
    Some(relative.to_string_lossy().replace('\\', "/"))
}

fn visit_dir(base_dir: &Path, current_dir: &Path, visuals: &mut Vec<String>, audios: &mut Vec<String>) -> Result<(), String> {
    let entries = fs::read_dir(current_dir)
        .map_err(|e| format!("Failed to read media directory: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to access media entry: {}", e))?;
        let path = entry.path();

        if path.is_dir() {
            visit_dir(base_dir, &path, visuals, audios)?;
            continue;
        }

        if !path.is_file() {
            continue;
        }

        if let Some(relative) = to_relative_unix_path(base_dir, &path) {
            if let Some((is_visual, media_path)) = classify_relative_path(relative) {
                if is_visual {
                    visuals.push(media_path);
                } else {
                    audios.push(media_path);
                }
            }
        }
    }

    Ok(())
}

fn collect_media_recursive(media_dir: &Path) -> Result<MediaCatalog, String> {
    let mut visuals = Vec::new();
    let mut audios = Vec::new();

    visit_dir(media_dir, media_dir, &mut visuals, &mut audios)?;

    visuals.sort();
    audios.sort();

    Ok(MediaCatalog { visuals, audios })
}

fn normalize_dir_prefix(dir: &str) -> String {
    dir.trim().replace('\\', "/").trim_matches('/').to_string()
}

fn path_in_any_dir(path: &str, dirs: &[String]) -> bool {
    dirs.iter().any(|dir| {
        let prefix = normalize_dir_prefix(dir);
        if prefix.is_empty() {
            return false;
        }

        path == prefix || path.starts_with(&(prefix + "/"))
    })
}

fn filter_paths_by_dirs(paths: Vec<String>, dirs: &Option<Vec<String>>) -> Vec<String> {
    match dirs {
        None => paths,
        Some(list) if list.is_empty() => paths,
        Some(list) => paths
            .into_iter()
            .filter(|p| path_in_any_dir(p, list))
            .collect(),
    }
}

fn parse_time_to_minutes(time_text: &str) -> Option<u16> {
    let value = time_text.trim();
    if value.is_empty() {
        return None;
    }

    if let Some((hours_part, minutes_part)) = value.split_once(':') {
        let hours: u16 = hours_part.trim().parse().ok()?;
        let minutes: u16 = minutes_part.trim().parse().ok()?;
        if hours <= 23 && minutes <= 59 {
            return Some(hours * 60 + minutes);
        }
        return None;
    }

    let hours: u16 = value.parse().ok()?;
    if hours <= 23 {
        return Some(hours * 60);
    }

    None
}

fn time_in_window(now_minutes: u16, start_minutes: u16, end_minutes: u16) -> bool {
    if start_minutes == end_minutes {
        return true;
    }

    if start_minutes < end_minutes {
        now_minutes >= start_minutes && now_minutes < end_minutes
    } else {
        now_minutes >= start_minutes || now_minutes < end_minutes
    }
}

fn get_active_schedule<'a>(config: &'a PlaybackConfig, now_minutes: u16) -> Option<&'a ScheduleRule> {
    config.schedules.iter().find(|rule| {
        match (parse_time_to_minutes(&rule.start), parse_time_to_minutes(&rule.end)) {
            (Some(start), Some(end)) => time_in_window(now_minutes, start, end),
            _ => false,
        }
    })
}

fn load_playback_config(media_dir: &Path) -> Option<PlaybackConfig> {
    let config_path = media_dir.join(PLAYBACK_CONFIG_FILE);
    let raw = match fs::read_to_string(&config_path) {
        Ok(content) => content,
        Err(_) => return None,
    };

    match serde_json::from_str::<PlaybackConfig>(&raw) {
        Ok(config) => Some(config),
        Err(err) => {
            eprintln!("Invalid {}: {}", PLAYBACK_CONFIG_FILE, err);
            None
        }
    }
}

fn apply_time_based_filter(media_dir: &Path, catalog: MediaCatalog) -> MediaCatalog {
    let config = match load_playback_config(media_dir) {
        Some(c) => c,
        None => return catalog,
    };

    let now = Local::now();
    let now_minutes = (now.hour() as u16) * 60 + (now.minute() as u16);

    let active_schedule = get_active_schedule(&config, now_minutes);

    let visual_dirs = active_schedule
        .and_then(|s| s.visual_dirs.clone())
        .or_else(|| config.fallback.as_ref().and_then(|f| f.visual_dirs.clone()));

    let audio_dirs = active_schedule
        .and_then(|s| s.audio_dirs.clone())
        .or_else(|| config.fallback.as_ref().and_then(|f| f.audio_dirs.clone()));

    MediaCatalog {
        visuals: filter_paths_by_dirs(catalog.visuals, &visual_dirs),
        audios: filter_paths_by_dirs(catalog.audios, &audio_dirs),
    }
}

fn ensure_default_playback_config(media_dir: &Path) -> Result<(), String> {
    let config_path = media_dir.join(PLAYBACK_CONFIG_FILE);

    if config_path.exists() {
        return Ok(());
    }

    serde_json::from_str::<PlaybackConfig>(DEFAULT_PLAYBACK_CONFIG)
        .map_err(|e| format!("Invalid bundled {}: {}", PLAYBACK_CONFIG_FILE, e))?;

    fs::write(&config_path, DEFAULT_PLAYBACK_CONFIG)
        .map_err(|e| format!("Failed to create {}: {}", PLAYBACK_CONFIG_FILE, e))?;

    Ok(())
}

fn get_media_directory() -> PathBuf {
    // Use Documents/{AppName} directory
    if let Some(doc_dir) = dirs::document_dir() {
        doc_dir.join(APP_NAME)
    } else {
        // Fallback to current directory if Documents folder cannot be found
        PathBuf::from("media")
    }
}

fn ensure_media_subfolders(media_dir: &Path) -> Result<(), String> {
    let mut subfolders = Vec::new();

    if let Some(config) = load_playback_config(media_dir) {
        for rule in &config.schedules {
            if let Some(visual_dirs) = &rule.visual_dirs {
                for dir in visual_dirs {
                    let normalized = normalize_dir_prefix(dir);
                    if !normalized.is_empty() && !normalized.contains("..") {
                        subfolders.push(normalized);
                    }
                }
            }

            if let Some(audio_dirs) = &rule.audio_dirs {
                for dir in audio_dirs {
                    let normalized = normalize_dir_prefix(dir);
                    if !normalized.is_empty() && !normalized.contains("..") {
                        subfolders.push(normalized);
                    }
                }
            }
        }

        if let Some(fallback) = &config.fallback {
            if let Some(visual_dirs) = &fallback.visual_dirs {
                for dir in visual_dirs {
                    let normalized = normalize_dir_prefix(dir);
                    if !normalized.is_empty() && !normalized.contains("..") {
                        subfolders.push(normalized);
                    }
                }
            }

            if let Some(audio_dirs) = &fallback.audio_dirs {
                for dir in audio_dirs {
                    let normalized = normalize_dir_prefix(dir);
                    if !normalized.is_empty() && !normalized.contains("..") {
                        subfolders.push(normalized);
                    }
                }
            }
        }
    }

    subfolders.sort();
    subfolders.dedup();

    for subfolder in subfolders {
        let subfolder_path = media_dir.join(subfolder);
        if !subfolder_path.exists() {
            fs::create_dir_all(&subfolder_path)
                .map_err(|e| format!("Failed to create media directory: {}", e))?;
        }
    }
    Ok(())
}

#[tauri::command]
fn open_media_folder() -> Result<String, String> {
    let media_dir = get_media_directory();

    // Create the directory if it doesn't exist
    if !media_dir.exists() {
        fs::create_dir_all(&media_dir)
            .map_err(|e| format!("Failed to create media directory: {}", e))?;
    }

    ensure_default_playback_config(&media_dir)?;
    ensure_media_subfolders(&media_dir)?;
    
    Ok(media_dir.to_string_lossy().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![get_media_files, get_media_path, open_media_folder])
        .setup(|app| {
            // Check if media directory exists on startup
            let media_dir = get_media_directory();
            let mut should_open = false;

            if !media_dir.exists() {
                // Create the directory
                if let Err(e) = fs::create_dir_all(&media_dir) {
                    eprintln!("Failed to create media directory: {}", e);
                    return Ok(());
                }

                if let Err(e) = ensure_default_playback_config(&media_dir) {
                    eprintln!("{}", e);
                }

                if let Err(e) = ensure_media_subfolders(&media_dir) {
                    eprintln!("{}", e);
                }

                should_open = true;
            } else {
                if let Err(e) = ensure_default_playback_config(&media_dir) {
                    eprintln!("{}", e);
                }

                if let Err(e) = ensure_media_subfolders(&media_dir) {
                    eprintln!("{}", e);
                }

                if let Ok(catalog) = collect_media_recursive(&media_dir) {
                    if catalog.visuals.is_empty() && catalog.audios.is_empty() {
                        should_open = true;
                    }
                } else {
                    should_open = true;
                }
            }

            if should_open {
                // Open the folder in file explorer using opener plugin
                let path_str = media_dir.to_string_lossy().to_string();
                let _ = app.opener().open_path(path_str, None::<String>);
            }
            
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
