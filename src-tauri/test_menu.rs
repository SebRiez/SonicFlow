fn check_menu(app: &tauri::App) -> tauri::Result<()> {
    let menu = tauri::menu::Menu::default(app)?;
    Ok(())
}
