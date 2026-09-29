mod market;
mod store;

use std::sync::Mutex;
use store::{OpenTool, Settings, Snapshot, Store};
use tauri::{Manager, State, WebviewWindow};

type Database = Mutex<Store>;
type Result<T> = std::result::Result<T, String>;

fn with_store<T>(
    window: WebviewWindow,
    state: State<Database>,
    action: impl FnOnce(&mut Store) -> Result<T>,
) -> Result<T> {
    if window.label() != "main" {
        return Err("未授权的窗口".into());
    }
    let mut store = state.lock().map_err(|_| "数据库不可用".to_string())?;
    action(&mut store)
}

#[tauri::command]
fn snapshot(window: WebviewWindow, state: State<Database>) -> Result<Snapshot> {
    with_store(window, state, |store| store.snapshot())
}

#[tauri::command]
fn install_tool(
    window: WebviewWindow,
    state: State<Database>,
    id: String,
    html: String,
    envelope: market::Envelope,
) -> Result<Snapshot> {
    let release = market::verify_package(&id, &html, &envelope)?;
    with_store(window, state, |store| {
        store.install_market(&id, &html, &release)
    })
}

#[tauri::command]
async fn market_request(window: WebviewWindow, path: String) -> Result<String> {
    if window.label() != "main" {
        return Err("未授权的窗口".into());
    }
    market::request(&path).await
}

#[tauri::command]
fn uninstall_tool(window: WebviewWindow, state: State<Database>, id: String) -> Result<Snapshot> {
    with_store(window, state, |store| store.uninstall(&id))
}

#[tauri::command]
fn set_favorite(
    window: WebviewWindow,
    state: State<Database>,
    id: String,
    favorite: bool,
) -> Result<Snapshot> {
    with_store(window, state, |store| store.favorite(&id, favorite))
}

#[tauri::command]
fn set_enabled(
    window: WebviewWindow,
    state: State<Database>,
    id: String,
    enabled: bool,
) -> Result<Snapshot> {
    with_store(window, state, |store| store.enabled(&id, enabled))
}

#[tauri::command]
fn open_tool(window: WebviewWindow, state: State<Database>, id: String) -> Result<OpenTool> {
    with_store(window, state, |store| store.open_tool(&id))
}

#[tauri::command]
fn save_settings(
    window: WebviewWindow,
    state: State<Database>,
    settings: Settings,
) -> Result<Snapshot> {
    with_store(window, state, |store| store.save_settings(settings))
}

#[tauri::command]
fn clear_tasks(window: WebviewWindow, state: State<Database>) -> Result<Snapshot> {
    with_store(window, state, |store| store.clear_tasks())
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let directory = app.path().app_data_dir()?;
            #[cfg(debug_assertions)]
            let directory = std::env::var_os("XTOOLS_TEST_DATA_DIR")
                .map(std::path::PathBuf::from)
                .unwrap_or(directory);
            std::fs::create_dir_all(&directory)?;
            let store =
                Store::open(&directory.join("xtools.sqlite")).map_err(std::io::Error::other)?;
            app.manage(Mutex::new(store));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            snapshot,
            install_tool,
            uninstall_tool,
            set_favorite,
            set_enabled,
            open_tool,
            save_settings,
            clear_tasks,
            market_request
        ])
        .run(tauri::generate_context!())
        .expect("Failed to start XTools");
}
