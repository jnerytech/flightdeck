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

/// Phase 16: the vault's values live in the OS credential store under their own service, one
/// entry per secret id. The list and metadata stay in the app's storage and never hold a value.
const VAULT_SERVICE: &str = "flightdeck-vault";

/// The Windows credential store keeps at most 2560 bytes per entry, and `keyring` writes UTF-16.
const WINDOWS_CREDENTIAL_MAX_BYTES: usize = 2560;

fn vault_entry(id: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(VAULT_SERVICE, id).map_err(|e| e.to_string())
}

#[tauri::command]
fn vault_get(id: String) -> Result<Option<String>, String> {
    match vault_entry(&id)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn vault_set(id: String, value: String) -> Result<(), String> {
    if cfg!(windows) && value.encode_utf16().count() * 2 > WINDOWS_CREDENTIAL_MAX_BYTES {
        return Err(format!(
            "the value is over {WINDOWS_CREDENTIAL_MAX_BYTES} bytes, the limit of the Windows credential store"
        ));
    }
    vault_entry(&id)?
        .set_password(&value)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn vault_delete(id: String) -> Result<(), String> {
    match vault_entry(&id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// A key pair `ssh-keygen` made: the private key goes to the vault, the public one to the screen.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct GeneratedKey {
    private_key: String,
    public_key: String,
}

/// Runs `ssh-keygen` inside `dir` (a folder only this user can read) and reads both files back.
fn run_keygen(dir: &std::path::Path, comment: &str) -> Result<GeneratedKey, String> {
    let key = dir.join("key");
    let mut command = std::process::Command::new("ssh-keygen");
    command
        .args(["-q", "-t", "ed25519", "-N", "", "-C"])
        .arg(comment)
        .arg("-f")
        .arg(&key);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let output = command.output().map_err(|e| format!("ssh-keygen: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "ssh-keygen: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let private_key = std::fs::read_to_string(&key).map_err(|e| e.to_string())?;
    let public_key = std::fs::read_to_string(dir.join("key.pub"))
        .map_err(|e| e.to_string())?
        .trim()
        .to_string();
    Ok(GeneratedKey {
        private_key,
        public_key,
    })
}

/// Makes an `ed25519` pair with the local `ssh-keygen`, no passphrase, in a temporary folder that
/// is deleted before returning (the private key never stays on disk).
#[tauri::command]
async fn vault_generate_key(comment: String) -> Result<GeneratedKey, String> {
    if comment.chars().any(|c| c.is_control()) {
        return Err("the key comment has control characters".to_string());
    }
    // A missing or slow `ssh-keygen` must not freeze the window.
    tauri::async_runtime::spawn_blocking(move || generate_key(&comment))
        .await
        .map_err(|e| e.to_string())?
}

fn generate_key(comment: &str) -> Result<GeneratedKey, String> {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let dir = std::env::temp_dir().join(format!(
        "flightdeck-keygen-{}-{nanos}",
        std::process::id()
    ));
    let mut builder = std::fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(&dir).map_err(|e| e.to_string())?;
    let result = run_keygen(&dir, comment);
    let _ = std::fs::remove_dir_all(&dir);
    result
}

/// The key file the person picked last. Only that file may be removed afterwards, so the frontend
/// cannot delete an arbitrary path.
#[derive(Default)]
struct PickedFile(std::sync::Mutex<Option<std::path::PathBuf>>);

#[derive(serde::Serialize)]
struct PickedFileInfo {
    path: String,
    text: String,
}

/// A key file is a few KiB; anything bigger is not one.
const PICKED_FILE_MAX_BYTES: u64 = 1024 * 1024;

/// Opens the system file dialog and reads the chosen file as text; `None` when it is cancelled.
#[tauri::command]
async fn vault_pick_file(
    app: tauri::AppHandle,
    state: State<'_, PickedFile>,
) -> Result<Option<PickedFileInfo>, String> {
    use std::io::Read;
    use tauri_plugin_dialog::DialogExt;
    // A new pick forgets the last one, even when this one fails or is cancelled.
    *state.0.lock().map_err(|e| e.to_string())? = None;
    let Some(picked) = app.dialog().file().blocking_pick_file() else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    // Bounded while reading, so a file that grows (or a device) cannot get past the cap.
    let mut text = String::new();
    std::fs::File::open(&path)
        .map_err(|e| e.to_string())?
        .take(PICKED_FILE_MAX_BYTES + 1)
        .read_to_string(&mut text)
        .map_err(|e| e.to_string())?;
    if text.len() as u64 > PICKED_FILE_MAX_BYTES {
        return Err("the file is too big to be a key".to_string());
    }
    *state.0.lock().map_err(|e| e.to_string())? = Some(path.clone());
    Ok(Some(PickedFileInfo {
        path: path.to_string_lossy().into_owned(),
        text,
    }))
}

/// Opens the system folder dialog; `None` when it is cancelled. The folder is only a suggestion:
/// the daemon checks it against its allowed roots before anything uses it.
#[tauri::command]
async fn pick_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let Some(picked) = app.dialog().file().blocking_pick_folder() else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    // A path that is not valid UTF-8 would reach the daemon changed: refuse it here instead.
    let text = path.to_str().ok_or("the folder's name is not valid text")?;
    Ok(Some(text.to_string()))
}

/// Deletes the file `vault_pick_file` returned last, and nothing else.
#[tauri::command]
fn vault_remove_file(path: String, state: State<PickedFile>) -> Result<(), String> {
    let mut picked = state.0.lock().map_err(|e| e.to_string())?;
    if picked.as_deref() != Some(std::path::Path::new(&path)) {
        return Err("only the file picked last can be deleted".to_string());
    }
    // Delete the path the dialog gave, not the string the frontend sent.
    if let Some(stored) = picked.take() {
        std::fs::remove_file(&stored).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// The tray's "Abrir" and "Sair" items, its "Precisa de você (N)" submenu, and whether closing
/// hides to the tray. Their texts come translated from the frontend (phase 10).
struct TrayState {
    show: MenuItem<Wry>,
    needs_you: Submenu<Wry>,
    quit: MenuItem<Wry>,
    close_to_tray: AtomicBool,
}

/// One open request of the submenu, built by the frontend (apps/desktop/src/lib/tray.ts).
#[derive(serde::Deserialize)]
struct TrayEntry {
    key: String,
    label: String,
    actions: Vec<String>,
}

/// The submenu's own texts, already translated by the frontend.
#[derive(serde::Deserialize)]
struct TrayLabels {
    approve: String,
    deny: String,
    open: String,
    more: String,
    empty: String,
    show: String,
    quit: String,
}

/// A click in the submenu, sent to the frontend as `tray-action`.
#[derive(Clone, serde::Serialize)]
struct TrayAction {
    key: String,
    action: String,
}

/// Menu ids of the submenu's actions: `act:<action>:<key>` (the key may hold colons too).
const ACTION_PREFIX: &str = "act:";

/// Windows menus read `&` as a mnemonic marker; a command like `a && b` must show as typed.
fn menu_text(text: &str) -> String {
    if cfg!(windows) {
        text.replace('&', "&&")
    } else {
        text.to_string()
    }
}

/// The submenu's only line while nothing waits; at start-up it has no translation yet.
fn nothing_waiting(app: &tauri::AppHandle, text: &str) -> tauri::Result<MenuItem<Wry>> {
    MenuItem::new(app, menu_text(text), false, None::<&str>)
}

/// Rebuilds the submenu: one entry per request with its actions, then "e mais N…".
#[tauri::command]
fn tray_set_menu(
    app: tauri::AppHandle,
    state: State<TrayState>,
    items: Vec<TrayEntry>,
    more: u32,
    labels: TrayLabels,
) -> Result<(), String> {
    let err = |e: tauri::Error| e.to_string();
    state.show.set_text(menu_text(&labels.show)).map_err(err)?;
    state.quit.set_text(menu_text(&labels.quit)).map_err(err)?;
    let needs_you = &state.needs_you;
    while needs_you.remove_at(0).map_err(err)?.is_some() {}
    if items.is_empty() && more == 0 {
        let empty = nothing_waiting(&app, &labels.empty).map_err(err)?;
        needs_you.append(&empty).map_err(err)?;
    }
    let actions = [
        ("approve", &labels.approve),
        ("deny", &labels.deny),
        ("open", &labels.open),
    ];
    for item in &items {
        let entry = Submenu::new(&app, menu_text(&item.label), true).map_err(err)?;
        for (action, label) in actions {
            if item.actions.iter().any(|a| a == action) {
                let id = format!("{ACTION_PREFIX}{action}:{}", item.key);
                let button = MenuItem::with_id(&app, id, menu_text(label), true, None::<&str>)
                    .map_err(err)?;
                entry.append(&button).map_err(err)?;
            }
        }
        needs_you.append(&entry).map_err(err)?;
    }
    if more > 0 {
        let id = format!("{ACTION_PREFIX}open:more");
        let rest = MenuItem::with_id(&app, id, menu_text(&labels.more), true, None::<&str>)
            .map_err(err)?;
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

/// Updates the tray tooltip and the "Precisa de você (N)" entry (both translated by the frontend).
#[tauri::command]
fn tray_set_status(
    app: tauri::AppHandle,
    state: State<TrayState>,
    label: String,
    tooltip: String,
) -> Result<(), String> {
    state
        .needs_you
        .set_text(menu_text(&label))
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
    needs_you.append(&nothing_waiting(app.handle(), "Nada esperando você")?)?;
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
        show: open,
        needs_you,
        quit,
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
            .plugin(tauri_plugin_global_shortcut::Builder::new().build())
            // Phase 9: the app updates itself from the signed latest.json of each release.
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_process::init());
    }

    builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        // Only the Rust side opens the dialog (a key file for the vault, a folder for a session); the
        // webview has no `dialog:*` permission.
        .plugin(tauri_plugin_dialog::init())
        .manage(PickedFile::default())
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
            vault_get,
            vault_set,
            vault_delete,
            vault_generate_key,
            vault_pick_file,
            pick_folder,
            vault_remove_file,
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
