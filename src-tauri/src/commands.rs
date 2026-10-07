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

/// Freesound search results are not stored in the local database; they carry negative ids
/// (`-freesound_id`) so they can never be mistaken for a row in `sounds`.
fn ensure_local_sound(id: i64) -> Result<(), AppError> {
    if id <= 0 {
        return Err(AppError {
            message: "Freesound-Treffer müssen zuerst heruntergeladen und importiert werden.".into(),
        });
    }
    Ok(())
}

// ─── Tauri Commands ──────────────────────────────────────────────────────────

fn lock_err<T>(e: std::sync::PoisonError<T>) -> AppError {
    AppError {
        message: e.to_string(),
    }
}

/// Scans `path` (without holding the DB lock) and syncs the result into the library in a
/// single transaction. Manual UCS tags and collection memberships of files that still
/// exist are preserved.
fn scan_and_sync(
    state: &State<'_, AppState>,
    library_id: i64,
    path: &str,
    not_found_msg: &str,
) -> Result<ImportResult, AppError> {
    let now = now_iso();
    let result = scanner::scan_directory(path, library_id, &now);

    let mut conn = state.db.lock().map_err(lock_err)?;
    db::sync_library_sounds(&mut conn, library_id, &result.sounds, &now)?;

    let library = db::fetch_libraries(&conn)?
        .into_iter()
        .find(|l| l.id == library_id)
        .ok_or_else(|| AppError {
            message: not_found_msg.into(),
        })?;

    Ok(ImportResult {
        library,
        imported: result.sounds.len(),
        errors: result.errors,
    })
}

#[tauri::command]
pub fn import_library(path: String, state: State<'_, AppState>) -> Result<ImportResult, AppError> {
    let name = std::path::Path::new(&path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(&path)
        .to_string();

    let library_id = {
        let conn = state.db.lock().map_err(lock_err)?;
        db::insert_library(&conn, &name, &path, &now_iso())?
    };

    scan_and_sync(&state, library_id, &path, "Library not found after import")
}

#[tauri::command]
pub fn get_libraries(state: State<'_, AppState>) -> Result<Vec<db::Library>, AppError> {
    let conn = state.db.lock().map_err(lock_err)?;
    Ok(db::fetch_libraries(&conn)?)
}

#[tauri::command]
pub fn remove_library(library_id: i64, state: State<'_, AppState>) -> Result<(), AppError> {
    let mut conn = state.db.lock().map_err(lock_err)?;
    db::remove_library_cascade(&mut conn, library_id)?;
    Ok(())
}

#[tauri::command]
pub fn refresh_library(
    library_id: i64,
    state: State<'_, AppState>,
) -> Result<ImportResult, AppError> {
    let path = {
        let conn = state.db.lock().map_err(lock_err)?;
        db::fetch_libraries(&conn)?
            .into_iter()
            .find(|l| l.id == library_id)
            .ok_or_else(|| AppError {
                message: "Library not found".into(),
            })?
            .path
    };

    scan_and_sync(&state, library_id, &path, "Library not found after refresh")
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
    ensure_local_sound(id)?;
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
    ensure_local_sound(sound_id)?;
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
    let token = api_key.map(|k| k.trim().to_string()).filter(|k| !k.is_empty())
        .ok_or_else(|| AppError {
            message: "Kein Freesound-API-Key hinterlegt. Bitte unter Einstellungen eintragen.".into(),
        })?;

    let client = reqwest::Client::new();
    let res = client.get("https://freesound.org/apiv2/search/text/")
        .query(&[
            ("query", query.as_str()),
            ("fields", "id,name,duration,previews,tags,username"),
            ("page_size", "150"),
        ])
        .header("Authorization", format!("Token {}", token))
        .header("User-Agent", "SonicFlow-App")
        .send()
        .await
        .map_err(|e| AppError { message: format!("Request failed: {}", e) })?;

    let status = res.status();
    if !status.is_success() {
        let message = match status.as_u16() {
            401 | 403 => "Freesound hat den API-Key abgelehnt. Bitte Key in den Einstellungen prüfen.".to_string(),
            429 => "Freesound-Anfragelimit erreicht. Bitte später erneut versuchen.".to_string(),
            _ => format!("Freesound-Fehler: HTTP {}", status),
        };
        return Err(AppError { message });
    }

    let data: FreesoundResponse = res.json()
        .await
        .map_err(|e| AppError { message: format!("JSON parsing failed: {}", e) })?;

    let sounds = data.results.into_iter().map(|r| db::Sound {
        id: -r.id,
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

/// Reduces a user-visible name to a safe single path component.
fn sanitize_filename(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect();
    let cleaned = cleaned.trim().trim_matches('.').trim().to_string();
    if cleaned.is_empty() {
        "sound".to_string()
    } else {
        cleaned
    }
}

/// Returns `<dir>/<stem>.mp3`, or `<stem> (n).mp3` if that already exists.
fn unique_target_path(dir: &std::path::Path, stem: &str) -> std::path::PathBuf {
    let mut candidate = dir.join(format!("{}.mp3", stem));
    let mut n = 1;
    while candidate.exists() {
        candidate = dir.join(format!("{} ({}).mp3", stem, n));
        n += 1;
    }
    candidate
}

#[tauri::command]
pub async fn download_sound(url: String, filename: String, target_dir: Option<String>) -> Result<String, AppError> {
    let download_dir = if let Some(path) = target_dir.filter(|p| !p.is_empty()) {
        std::path::PathBuf::from(path)
    } else {
        db::home_dir().join("Music").join("SonicFlow_Downloads")
    };

    std::fs::create_dir_all(&download_dir).map_err(|e| AppError { message: format!("Folder creation failed: {}", e) })?;

    let client = reqwest::Client::new();
    let res = client.get(&url)
        .header("User-Agent", "SonicFlow-App")
        .send()
        .await
        .map_err(|e| AppError { message: format!("Download failed: {}", e) })?;

    if !res.status().is_success() {
        return Err(AppError { message: format!("Download failed: HTTP {}", res.status()) });
    }

    let bytes = res.bytes()
        .await
        .map_err(|e| AppError { message: format!("Failed to read data: {}", e) })?;

    // Never overwrite an existing file; pick a free name right before writing.
    let target_path = unique_target_path(&download_dir, &sanitize_filename(&filename));
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
