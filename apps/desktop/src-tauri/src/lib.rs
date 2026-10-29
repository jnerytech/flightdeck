//! Thin Tauri shell: everything else lives in the React frontend and the daemon.
//! Native pieces: the OS credential store for host tokens, single instance with deep-link
//! forwarding, the terminal of "Abrir no terminal", and the official plugins (notifications,
//! deep links, opener).

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::menu::{Menu, MenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager, State, WindowEvent, Wry};

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
    entry(&host_id)?
        .set_password(&token)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn token_delete(host_id: String) -> Result<(), String> {
    match entry(&host_id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// The tray's "Precisa de você (N)" submenu, and whether closing hides to the tray.
struct TrayState {
    needs_you: Submenu<Wry>,
    close_to_tray: AtomicBool,
}

/// One open request of the submenu, built by the frontend (apps/desktop/src/lib/tray.ts).
#[derive(serde::Deserialize)]
struct TrayEntry {
    key: String,
    label: String,
    actions: Vec<String>,
}

/// A click in the submenu, sent to the frontend as `tray-action`.
#[derive(Clone, serde::Serialize)]
struct TrayAction {
    key: String,
    action: String,
}

/// Menu ids of the submenu's actions: `act:<action>:<key>` (the key may hold colons too).
const ACTION_PREFIX: &str = "act:";
const ACTIONS: [(&str, &str); 3] = [("approve", "Aprovar"), ("deny", "Negar"), ("open", "Abrir")];

/// Windows menus read `&` as a mnemonic marker; a command like `a && b` must show as typed.
fn menu_text(text: &str) -> String {
    if cfg!(windows) {
        text.replace('&', "&&")
    } else {
        text.to_string()
    }
}

fn nothing_waiting(app: &tauri::AppHandle) -> tauri::Result<MenuItem<Wry>> {
    MenuItem::new(app, "Nada esperando você", false, None::<&str>)
}

/// Rebuilds the submenu: one entry per request with its actions, then "e mais N…".
#[tauri::command]
fn tray_set_menu(
    app: tauri::AppHandle,
    state: State<TrayState>,
    items: Vec<TrayEntry>,
    more: u32,
) -> Result<(), String> {
    let err = |e: tauri::Error| e.to_string();
    let needs_you = &state.needs_you;
    while needs_you.remove_at(0).map_err(err)?.is_some() {}
    if items.is_empty() && more == 0 {
        needs_you
            .append(&nothing_waiting(&app).map_err(err)?)
            .map_err(err)?;
    }
    for item in &items {
        let entry = Submenu::new(&app, menu_text(&item.label), true).map_err(err)?;
        for (action, label) in ACTIONS {
            if item.actions.iter().any(|a| a == action) {
                let id = format!("{ACTION_PREFIX}{action}:{}", item.key);
                let button = MenuItem::with_id(&app, id, label, true, None::<&str>).map_err(err)?;
                entry.append(&button).map_err(err)?;
            }
        }
        needs_you.append(&entry).map_err(err)?;
    }
    if more > 0 {
        let id = format!("{ACTION_PREFIX}open:more");
        let label = format!("e mais {more}…");
        let rest = MenuItem::with_id(&app, id, label, true, None::<&str>).map_err(err)?;
        needs_you.append(&rest).map_err(err)?;
    }
    Ok(())
}

/// Approve and deny go to the frontend, which answers without showing the window; open shows it.
fn on_tray_action(app: &tauri::AppHandle, id: &str) {
    let Some((action, key)) = id
        .strip_prefix(ACTION_PREFIX)
        .and_then(|rest| rest.split_once(':'))
    else {
        return;
    };
    if action == "open" {
        bring_to_front(app);
    }
    let payload = TrayAction {
        key: key.to_string(),
        action: action.to_string(),
    };
    let _ = app.emit("tray-action", payload);
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

/// What "Abrir no terminal" can use on this machine.
#[derive(serde::Serialize)]
struct TerminalEnv {
    windows: bool,
    wt: bool,
}

#[tauri::command]
fn terminal_probe() -> TerminalEnv {
    TerminalEnv {
        windows: cfg!(windows),
        wt: cfg!(windows) && on_path("wt.exe"),
    }
}

/// `symlink_metadata`: `wt.exe` is an app execution alias, a reparse point `is_file` rejects.
fn on_path(program: &str) -> bool {
    std::env::var_os("PATH")
        .map(|paths| {
            std::env::split_paths(&paths)
                .any(|dir| std::fs::symlink_metadata(dir.join(program)).is_ok())
        })
        .unwrap_or(false)
}

/// The only programs the frontend may start: the command is built there (apps/desktop/src/lib/terminal.ts).
const TERMINAL_PROGRAMS: [&str; 2] = ["wt.exe", "cmd.exe"];

/// Starts the terminal with the arguments as a list; no shell in between, except the `cmd /k` of
/// the fallback without Windows Terminal.
#[tauri::command]
fn terminal_open(program: String, args: Vec<String>) -> Result<(), String> {
    if !TERMINAL_PROGRAMS
        .iter()
        .any(|p| p.eq_ignore_ascii_case(&program))
    {
        return Err(format!("programa não permitido: {program}"));
    }
    let mut command = std::process::Command::new(&program);
    command.args(&args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // `cmd /c start` opens the terminal's own console; the outer cmd needs no window.
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        if program.eq_ignore_ascii_case("cmd.exe") {
            command.creation_flags(CREATE_NO_WINDOW);
        }
    }
    command
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("{program}: {e}"))
}

#[tauri::command]
fn set_close_to_tray(state: State<TrayState>, enabled: bool) {
    state.close_to_tray.store(enabled, Ordering::Relaxed);
}

fn build_tray(app: &tauri::App) -> tauri::Result<TrayState> {
    let open = MenuItem::with_id(app, "open", "Abrir", true, None::<&str>)?;
    let needs_you = Submenu::with_id(app, "needs-you", "Precisa de você (0)", true)?;
    needs_you.append(&nothing_waiting(app.handle())?)?;
    let quit = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &needs_you, &quit])?;
    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("Flightdeck")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => bring_to_front(app),
            "quit" => app.exit(0),
            id => on_tray_action(app, id),
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
            tray_set_menu,
            set_close_to_tray,
            focus_main,
            terminal_probe,
            terminal_open
        ])
        .run(tauri::generate_context!())
        .expect("error while running Flightdeck");
}
