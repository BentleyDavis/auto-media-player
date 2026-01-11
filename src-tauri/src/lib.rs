use std::fs;
use std::path::PathBuf;
use tauri_plugin_opener::OpenerExt;

const MEDIA_EXTENSIONS: [&str; 9] = [".mp4", ".webm", ".mkv", ".mov", ".jpg", ".jpeg", ".png", ".gif", ".webp"];
const APP_NAME: &str = "auto-media-player";

#[tauri::command]
fn get_media_files() -> Result<Vec<String>, String> {
    let media_dir = get_media_directory();
    
    if !media_dir.exists() {
        fs::create_dir_all(&media_dir)
            .map_err(|e| format!("Failed to create media directory: {}", e))?;
        return Ok(Vec::new());
    }
    
    let mut files = Vec::new();
    
    match fs::read_dir(&media_dir) {
        Ok(entries) => {
            for entry in entries {
                if let Ok(entry) = entry {
                    let path = entry.path();
                    if path.is_file() {
                        if let Some(ext) = path.extension() {
                            let ext_lower = format!(".{}", ext.to_string_lossy().to_lowercase());
                            if MEDIA_EXTENSIONS.contains(&ext_lower.as_str()) {
                                if let Some(filename) = path.file_name() {
                                    files.push(filename.to_string_lossy().to_string());
                                }
                            }
                        }
                    }
                }
            }
        }
        Err(e) => return Err(format!("Failed to read media directory: {}", e)),
    }
    
    Ok(files)
}

#[tauri::command]
fn get_media_path(filename: String) -> Result<String, String> {
    let media_dir = get_media_directory();
    let file_path = media_dir.join(&filename);
    
    if !file_path.exists() {
        return Err(format!("File not found: {}", filename));
    }
    
    // Return the absolute path - the frontend will convert it to an asset URL
    match file_path.canonicalize() {
        Ok(absolute_path) => Ok(absolute_path.to_string_lossy().to_string()),
        Err(e) => Err(format!("Failed to get absolute path: {}", e))
    }
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

#[tauri::command]
fn open_media_folder() -> Result<String, String> {
    let media_dir = get_media_directory();
    
    // Create the directory if it doesn't exist
    if !media_dir.exists() {
        fs::create_dir_all(&media_dir)
            .map_err(|e| format!("Failed to create media directory: {}", e))?;
    }
    
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
                should_open = true;
            } else {
                // Check if folder is empty (no media files)
                if let Ok(entries) = fs::read_dir(&media_dir) {
                    let has_media = entries.filter_map(|e| e.ok()).any(|entry| {
                        if let Ok(path) = entry.path().canonicalize() {
                            if path.is_file() {
                                if let Some(ext) = path.extension() {
                                    let ext_lower = format!(".{}", ext.to_string_lossy().to_lowercase());
                                    return MEDIA_EXTENSIONS.contains(&ext_lower.as_str());
                                }
                            }
                        }
                        false
                    });
                    
                    if !has_media {
                        should_open = true;
                    }
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
