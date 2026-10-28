//! Thin Tauri shell: everything else lives in the React frontend and the daemon.
//! Native pieces: the OS credential store for host tokens, single instance with deep-link
//! forwarding, and the official plugins (notifications, deep links, opener).

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, State, WindowEvent, Wry};

const KEYRING_SERVICE: &str = "dev.flightdeck.app";

fn entry(host_id: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, host_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn token_get(host_id: String) -> Result<Option<String>, String> {
    match entry(&host_id)?.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn token_set(host_id: String, token: String) -> Result<(), String> {
    entry(&host_id)?.set_password(&token).map_err(|e| e.to_string())
}

#[tauri::command]
fn token_delete(host_id: String) -> Result<(), String> {
    match entry(&host_id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// Tray menu entry that shows the pending count, and whether closing hides to the tray.
struct TrayState {
    needs_you: MenuItem<Wry>,
    close_to_tray: AtomicBool,
}

/// Updates the tray tooltip and the "Precisa de você (N)" entry (computed by the frontend).
#[tauri::command]
fn tray_set_status(
    app: tauri::AppHandle,
    state: State<TrayState>,
    count: u32,
    tooltip: String,
) -> Result<(), String> {
    state
        .needs_you
        .set_text(format!("Precisa de você ({count})"))
        .map_err(|e| e.to_string())?;
    if let Some(tray) = app.tray_by_id("main") {
        tray.set_tooltip(Some(tooltip)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Brings the window to the front for the global shortcut (the window may be hidden in the tray).
#[tauri::command]
fn focus_main(app: tauri::AppHandle) {
    bring_to_front(&app);
}

#[tauri::command]
fn set_close_to_tray(state: State<TrayState>, enabled: bool) {
    state.close_to_tray.store(enabled, Ordering::Relaxed);
}

fn build_tray(app: &tauri::App) -> tauri::Result<TrayState> {
    let open = MenuItem::with_id(app, "open", "Abrir", true, None::<&str>)?;
    let needs_you = MenuItem::with_id(app, "needs-you", "Precisa de você (0)", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &needs_you, &quit])?;
    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("Flightdeck")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => bring_to_front(app),
            "needs-you" => bring_to_front(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                bring_to_front(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(TrayState {
        needs_you,
        close_to_tray: AtomicBool::new(true),
    })
}

/// Brings the main window back (from the tray, minimized or behind other windows).
fn bring_to_front(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // Must be the first plugin: a second launch focuses this window, and with the `deep-link`
    // feature its `flightdeck://` argument is forwarded to the deep-link plugin.
    #[cfg(desktop)]
    {
        builder = builder
            .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
                bring_to_front(app);
            }))
            // Off by default; the settings page turns it on through the plugin's JS API.
            .plugin(tauri_plugin_autostart::init(
                tauri_plugin_autostart::MacosLauncher::LaunchAgent,
                None,
            ))
            // Registered from the frontend (configurable accelerator), never with a fixed one here.
            .plugin(tauri_plugin_global_shortcut::Builder::new().build());
    }

    builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            // Registers the scheme at runtime too, so dev builds work without an installer.
            #[cfg(any(windows, target_os = "linux"))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                app.deep_link().register_all()?;
            }
            let tray = build_tray(app)?;
            app.manage(tray);
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the window keeps the app running in the tray, unless turned off.
            if let WindowEvent::CloseRequested { api, .. } = event {
                let state = window.app_handle().state::<TrayState>();
                if state.close_to_tray.load(Ordering::Relaxed) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            token_get,
            token_set,
            token_delete,
            tray_set_status,
            set_close_to_tray,
            focus_main
        ])
        .run(tauri::generate_context!())
        .expect("error while running Flightdeck");
}
