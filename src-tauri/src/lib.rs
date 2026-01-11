use std::fs;
use std::path::PathBuf;

const MEDIA_EXTENSIONS: [&str; 9] = [".mp4", ".webm", ".mkv", ".mov", ".jpg", ".jpeg", ".png", ".gif", ".webp"];

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
    // In development, use project root. In production, use executable directory.
    let mut path = std::env::current_exe()
        .unwrap_or_else(|_| PathBuf::from("."));
    path.pop(); // Remove executable name
    
    // Check if we're in dev mode by looking for Cargo.toml in parent directories
    let mut dev_check = path.clone();
    for _ in 0..5 {
        let cargo_toml = dev_check.join("Cargo.toml");
        if cargo_toml.exists() {
            // We're in dev mode, go up to project root and use media folder there
            dev_check.pop(); // Go up from src-tauri
            dev_check.push("media");
            return dev_check;
        }
        if !dev_check.pop() {
            break;
        }
    }
    
    // Production mode: use media folder next to executable
    path.push("media");
    path
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![get_media_files, get_media_path])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
