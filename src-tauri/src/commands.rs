use crate::db;
use crate::scanner;
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


