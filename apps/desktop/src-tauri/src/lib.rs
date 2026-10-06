mod market;
mod store;

use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
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

#[tauri::command]
fn create_group(window: WebviewWindow, state: State<Database>, name: String) -> Result<Snapshot> {
    with_store(window, state, |store| store.create_group(&name))
}

#[tauri::command]
fn rename_group(
    window: WebviewWindow,
    state: State<Database>,
    id: String,
    name: String,
) -> Result<Snapshot> {
    with_store(window, state, |store| store.rename_group(&id, &name))
}

#[tauri::command]
fn delete_group(window: WebviewWindow, state: State<Database>, id: String) -> Result<Snapshot> {
    with_store(window, state, |store| store.delete_group(&id))
}

#[tauri::command]
fn set_tool_group(
    window: WebviewWindow,
    state: State<Database>,
    ids: Vec<String>,
    group_id: Option<String>,
) -> Result<Snapshot> {
    with_store(window, state, |store| {
        store.set_tool_group(&ids, group_id.as_deref())
    })
}

pub fn run() {
    let startup_shown = Arc::new(AtomicBool::new(false));
    let page_shown = Arc::clone(&startup_shown);
    let builder = tauri::Builder::default();
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
    }));
    builder
        .plugin(tauri_plugin_deep_link::init())
        .on_page_load(move |webview, payload| {
            if webview.label() == "main"
                && payload.event() == tauri::webview::PageLoadEvent::Finished
                && !page_shown.swap(true, Ordering::Relaxed)
            {
                let _ = webview.window().show();
            }
        })
        .setup(move |app| {
            // A failed navigation must not leave the application permanently hidden.
            if let Some(window) = app.get_webview_window("main") {
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(8));
                    if !startup_shown.swap(true, Ordering::Relaxed) {
                        let _ = window.show();
                    }
                });
            }
            #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                app.deep_link().register_all()?;
            }
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
            create_group,
            rename_group,
            delete_group,
            set_tool_group,
            market_request
        ])
        .run(tauri::generate_context!())
        .expect("Failed to start XTools");
}
