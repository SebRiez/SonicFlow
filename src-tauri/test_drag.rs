use tauri::{DragItem, Manager, WebviewWindow};
fn test_drag(window: tauri::Window) {
    let item = DragItem::Files(vec![std::path::PathBuf::from("/tmp")]);
    let _ = window.start_drag(item);
}
