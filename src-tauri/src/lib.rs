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
            commands::get_collections,
            commands::create_collection,
            commands::delete_collection,
            commands::add_to_collection,
            commands::remove_from_collection,
            commands::get_collection_sounds,
            commands::open_with_app,
            commands::toggle_dock_mode,
            commands::search_freesound,
            commands::download_sound,
            commands::show_help,
        ])
        .setup(|app| {
            use tauri::menu::{Menu, MenuItem, Submenu};
            
            let help_menu = Submenu::with_id(app, "help", "Help", true)?;
            let doc_item = MenuItem::with_id(app, "documentation", "SonicFlow Dokumentation", true, None::<&str>)?;
            help_menu.append(&doc_item)?;
            
            let menu = Menu::with_id(app, "main")?;
            menu.append(&help_menu)?;
            app.set_menu(menu)?;
            
            app.on_menu_event(move |app, event| {
                if event.id() == "documentation" {
                    let _ = tauri::WebviewWindowBuilder::new(
                        app,
                        "help",
                        tauri::WebviewUrl::App("help.html".into())
                    )
                    .title("SonicFlow Hilfe & Dokumentation")
                    .inner_size(900.0, 800.0)
                    .resizable(true)
                    .build();
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
