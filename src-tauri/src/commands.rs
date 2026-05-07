use crate::db;
use crate::scanner;
use crate::ucs;
use crate::AppState;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize)]
pub struct ImportResult {
    pub library: db::Library,
    pub imported: usize,
    pub errors: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AppError {
    pub message: String,
}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        AppError {
            message: e.to_string(),
        }
    }
}

fn now_iso() -> String {
    chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string()
}

// ─── Tauri Commands ──────────────────────────────────────────────────────────

#[tauri::command]
pub fn import_library(path: String, state: State<'_, AppState>) -> Result<ImportResult, AppError> {
    let conn = state.db.lock().map_err(|e| AppError {
        message: e.to_string(),
    })?;
    let now = now_iso();

    let name = std::path::Path::new(&path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(&path)
        .to_string();

    let library_id = db::insert_library(&conn, &name, &path, &now)?;
    db::delete_sounds_for_library(&conn, library_id)?;

    let result = scanner::scan_directory(&path, library_id, &now);

    conn.execute_batch("BEGIN").map_err(|e| AppError {
        message: e.to_string(),
    })?;
    for sound in &result.sounds {
        db::insert_sound(&conn, sound)?;
    }
    conn.execute_batch("COMMIT").map_err(|e| AppError {
        message: e.to_string(),
    })?;

    db::update_library_count(&conn, library_id, &now)?;

    let libs = db::fetch_libraries(&conn)?;
    let library = libs
        .into_iter()
        .find(|l| l.id == library_id)
        .ok_or_else(|| AppError {
            message: "Library not found after import".into(),
        })?;

    Ok(ImportResult {
        library,
        imported: result.sounds.len(),
        errors: result.errors,
    })
}

#[tauri::command]
pub fn get_libraries(state: State<'_, AppState>) -> Result<Vec<db::Library>, AppError> {
    let conn = state.db.lock().map_err(|e| AppError {
        message: e.to_string(),
    })?;
    Ok(db::fetch_libraries(&conn)?)
}

#[tauri::command]
pub fn remove_library(library_id: i64, state: State<'_, AppState>) -> Result<(), AppError> {
    let conn = state.db.lock().map_err(|e| AppError {
        message: e.to_string(),
    })?;
    db::delete_sounds_for_library(&conn, library_id)?;
    db::delete_library(&conn, library_id)?;
    Ok(())
}

#[tauri::command]
pub fn refresh_library(
    library_id: i64,
    state: State<'_, AppState>,
) -> Result<ImportResult, AppError> {
    let path = {
        let conn = state.db.lock().map_err(|e| AppError {
            message: e.to_string(),
        })?;
        let libs = db::fetch_libraries(&conn)?;
        libs.into_iter()
            .find(|l| l.id == library_id)
            .ok_or_else(|| AppError {
                message: "Library not found".into(),
            })?
            .path
    };

    let conn = state.db.lock().map_err(|e| AppError {
        message: e.to_string(),
    })?;
    let now = now_iso();
    db::delete_sounds_for_library(&conn, library_id)?;
    let result = scanner::scan_directory(&path, library_id, &now);
    conn.execute_batch("BEGIN").map_err(|e| AppError {
        message: e.to_string(),
    })?;
    for sound in &result.sounds {
        db::insert_sound(&conn, sound)?;
    }
    conn.execute_batch("COMMIT").map_err(|e| AppError {
        message: e.to_string(),
    })?;
    db::update_library_count(&conn, library_id, &now)?;

    let libs = db::fetch_libraries(&conn)?;
    let library = libs
        .into_iter()
        .find(|l| l.id == library_id)
        .ok_or_else(|| AppError {
            message: "Library not found after refresh".into(),
        })?;

    Ok(ImportResult {
        library,
        imported: result.sounds.len(),
        errors: result.errors,
    })
}

#[tauri::command]
pub fn get_folders(
    library_id: i64,
    state: State<'_, AppState>,
) -> Result<Vec<db::FolderNode>, AppError> {
    let conn = state.db.lock().map_err(|e| AppError {
        message: e.to_string(),
    })?;
    Ok(db::fetch_folder_tree(&conn, library_id)?)
}

#[tauri::command]
pub fn search_sounds(
    query: String,
    filters: db::SearchFilters,
    state: State<'_, AppState>,
) -> Result<Vec<db::Sound>, AppError> {
    let conn = state.db.lock().map_err(|e| AppError {
        message: e.to_string(),
    })?;
    Ok(db::query_sounds(&conn, &query, &filters)?)
}

#[tauri::command]
pub fn open_in_finder(path: String) -> Result<(), AppError> {
    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg("-R")
        .arg(&path)
        .spawn()
        .map_err(|e| AppError {
            message: e.to_string(),
        })?;

    #[cfg(target_os = "windows")]
    std::process::Command::new("explorer")
        .arg("/select,")
        .arg(&path)
        .spawn()
        .map_err(|e| AppError {
            message: e.to_string(),
        })?;

    // Linux doesn't have a universal 'reveal file' flag, so we just open the directory
    #[cfg(target_os = "linux")]
    {
        let dir = std::path::Path::new(&path)
            .parent()
            .unwrap_or(std::path::Path::new(&path));
        std::process::Command::new("xdg-open")
            .arg(dir)
            .spawn()
            .map_err(|e| AppError {
                message: e.to_string(),
            })?;
    }

    Ok(())
}

/// Persist a manually assigned UCS user category for a sound.
/// This field is NEVER overwritten by the scanner — only by this command.
#[tauri::command]
pub fn save_ucs_tag(
    id: i64,
    ucs_user_category: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let conn = state.db.lock().map_err(|e| AppError { message: e.to_string() })?;
    let cat = if ucs_user_category.is_empty() { None } else { Some(ucs_user_category.as_str()) };
    db::save_ucs_user_category(&conn, id, cat)?;
    Ok(())
}

#[tauri::command]
pub fn get_collections(state: State<'_, AppState>) -> Result<Vec<db::Collection>, AppError> {
    let conn = state.db.lock().map_err(|e| AppError { message: e.to_string() })?;
    Ok(db::fetch_collections(&conn)?)
}

#[tauri::command]
pub fn create_collection(name: String, state: State<'_, AppState>) -> Result<i64, AppError> {
    let conn = state.db.lock().map_err(|e| AppError { message: e.to_string() })?;
    let now = now_iso();
    Ok(db::create_collection(&conn, &name, &now)?)
}

#[tauri::command]
pub fn delete_collection(id: i64, state: State<'_, AppState>) -> Result<(), AppError> {
    let conn = state.db.lock().map_err(|e| AppError { message: e.to_string() })?;
    db::delete_collection(&conn, id)?;
    Ok(())
}

#[tauri::command]
pub fn add_to_collection(collection_id: i64, sound_id: i64, state: State<'_, AppState>) -> Result<(), AppError> {
    let conn = state.db.lock().map_err(|e| AppError { message: e.to_string() })?;
    db::add_to_collection(&conn, collection_id, sound_id)?;
    Ok(())
}

#[tauri::command]
pub fn remove_from_collection(collection_id: i64, sound_id: i64, state: State<'_, AppState>) -> Result<(), AppError> {
    let conn = state.db.lock().map_err(|e| AppError { message: e.to_string() })?;
    db::remove_from_collection(&conn, collection_id, sound_id)?;
    Ok(())
}

#[tauri::command]
pub fn get_collection_sounds(collection_id: i64, state: State<'_, AppState>) -> Result<Vec<db::Sound>, AppError> {
    let conn = state.db.lock().map_err(|e| AppError { message: e.to_string() })?;
    Ok(db::query_collection_sounds(&conn, collection_id)?)
}

#[tauri::command]
pub fn open_with_app(path: String, app: Option<String>) -> Result<(), AppError> {
    #[cfg(target_os = "macos")]
    {
        let mut cmd = std::process::Command::new("open");
        if let Some(a) = app {
            cmd.arg("-a").arg(a);
        }
        cmd.arg(&path).spawn().map_err(|e| AppError { message: e.to_string() })?;
    }

    #[cfg(target_os = "windows")]
    {
        if let Some(a) = app {
            std::process::Command::new(a).arg(&path).spawn().map_err(|e| AppError { message: e.to_string() })?;
        } else {
            std::process::Command::new("cmd").arg("/c").arg("start").arg("").arg(&path).spawn().map_err(|e| AppError { message: e.to_string() })?;
        }
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open").arg(&path).spawn().map_err(|e| AppError { message: e.to_string() })?;
    }

    Ok(())
}

#[tauri::command]
pub fn toggle_dock_mode(window: tauri::Window, enabled: bool) -> Result<(), AppError> {
    window.set_always_on_top(enabled).map_err(|e| AppError { message: e.to_string() })?;
    if enabled {
        window.set_size(tauri::Size::Logical(tauri::LogicalSize { width: 600.0, height: 150.0 })).ok();
    } else {
        window.set_size(tauri::Size::Logical(tauri::LogicalSize { width: 1280.0, height: 800.0 })).ok();
    }
    Ok(())
}

/// Returns the full sorted list of official UCS CatIDs for frontend dropdowns.
#[tauri::command]
pub fn get_ucs_cat_ids() -> Vec<&'static str> {
    ucs::all_cat_ids()
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FreesoundPreviews {
    #[serde(rename = "preview-lq-mp3")]
    pub preview_lq_mp3: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FreesoundResult {
    pub id: i64,
    pub name: String,
    pub duration: f64,
    pub previews: FreesoundPreviews,
    pub tags: Vec<String>,
    pub username: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FreesoundResponse {
    pub results: Vec<FreesoundResult>,
}

#[tauri::command]
pub async fn search_freesound(query: String, api_key: Option<String>) -> Result<Vec<db::Sound>, AppError> {
    // Use the provided key or fallback to the default one
    let token = api_key.filter(|k| !k.is_empty())
        .unwrap_or_else(|| "q47MYc1l0Hyrer1rcjKrxo6Ju0baARMTMgWh4C1O".to_string()); 
    let url = format!(
        "https://freesound.org/apiv2/search/text/?query={}&token={}&fields=id,name,duration,previews,tags,username&page_size=30",
        query, token
    );

    let client = reqwest::Client::new();
    let res = client.get(&url)
        .header("User-Agent", "SonicFlow-App")
        .send()
        .await
        .map_err(|e| AppError { message: format!("Request failed: {}", e) })?;

    let data: FreesoundResponse = res.json()
        .await
        .map_err(|e| AppError { message: format!("JSON parsing failed: {}", e) })?;

    let sounds = data.results.into_iter().map(|r| db::Sound {
        id: r.id,
        library_id: 0, 
        filename: r.name,
        filepath: r.previews.preview_lq_mp3,
        relative_folder: "Freesound".to_string(),
        extension: "mp3".to_string(), 
        filesize: 0,
        duration: Some(r.duration),
        samplerate: Some(44100),
        bitdepth: Some(16),
        channels: Some(2),
        bitrate: None,
        tag_title: None,
        tag_artist: Some(r.username),
        tag_album: None,
        tag_comment: None,
        tag_genre: None,
        tag_bpm: None,
        tag_description: None,
        tag_keywords: Some(r.tags.join("; ")),
        tag_tracknumber: None,
        imported_at: "".to_string(),
        ucs_cat_id: None,
        ucs_fx_name: None,
        ucs_creator_id: None,
        ucs_source_id: None,
        ucs_user_category: None,
    }).collect();

    Ok(sounds)
}

#[tauri::command]
pub async fn download_sound(url: String, filename: String, target_dir: Option<String>) -> Result<String, AppError> {
    let download_dir = if let Some(path) = target_dir.filter(|p| !p.is_empty()) {
        std::path::PathBuf::from(path)
    } else {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
        std::path::Path::new(&home).join("Music").join("SonicFlow_Downloads")
    };
    
    if !download_dir.exists() {
        std::fs::create_dir_all(&download_dir).map_err(|e| AppError { message: format!("Folder creation failed: {}", e) })?;
    }

    let sanitized_name = filename.replace('/', "_").replace('\\', "_");
    let target_path = download_dir.join(format!("{}.mp3", sanitized_name));
    
    let client = reqwest::Client::new();
    let res = client.get(&url)
        .header("User-Agent", "SonicFlow-App")
        .send()
        .await
        .map_err(|e| AppError { message: format!("Download failed: {}", e) })?;

    let bytes = res.bytes()
        .await
        .map_err(|e| AppError { message: format!("Failed to read data: {}", e) })?;

    std::fs::write(&target_path, bytes)
        .map_err(|e| AppError { message: format!("Save failed: {}", e) })?;

    Ok(target_path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn show_help(handle: tauri::AppHandle) -> Result<(), AppError> {
    let _ = tauri::WebviewWindowBuilder::new(
        &handle,
        "help",
        tauri::WebviewUrl::App("help.html".into())
    )
    .title("SonicFlow Hilfe & Dokumentation")
    .inner_size(900.0, 800.0)
    .resizable(true)
    .build()
    .map_err(|e| AppError { message: format!("Could not open help: {}", e) })?;
    Ok(())
}
