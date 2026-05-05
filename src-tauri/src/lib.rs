pub mod commands;
mod db;
mod scanner;
mod ucs;
mod riff_meta;

pub struct AppState {
    pub db: std::sync::Mutex<rusqlite::Connection>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let conn = db::open_db().expect("Failed to open database");
    db::init_schema(&conn).expect("Failed to initialize database schema");

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_drag::init())
        .plugin(tauri_plugin_shell::init())
        .manage(AppState {
            db: std::sync::Mutex::new(conn),
        })
        .invoke_handler(tauri::generate_handler![
            commands::import_library,
            commands::get_libraries,
            commands::remove_library,
            commands::refresh_library,
            commands::get_folders,
            commands::search_sounds,
            commands::open_in_finder,
            commands::save_ucs_tag,
            commands::get_ucs_cat_ids,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
