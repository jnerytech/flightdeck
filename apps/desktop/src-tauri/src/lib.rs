//! Thin Tauri shell: everything else lives in the React frontend and the daemon.
//! Native pieces: the OS credential store for host tokens, single instance with deep-link
//! forwarding, the terminal of "Abrir no terminal", and the official plugins (notifications,
//! deep links, opener).

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::menu::{Menu, MenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager, State, WindowEvent, Wry};

const KEYRING_SERVICE: &str = "dev.flightdeck.app";

/// Runs blocking work (the credential store, a PATH walk, a process spawn) on the blocking pool:
/// a plain `async fn` still holds one of the runtime's few workers while it waits.
async fn spawn_blocking_result<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| e.to_string())?
}

fn entry(host_id: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, host_id).map_err(|e| e.to_string())
}

#[tauri::command]
async fn token_get(host_id: String) -> Result<Option<String>, String> {
    spawn_blocking_result(move || match entry(&host_id)?.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    })
    .await
}

#[tauri::command]
async fn token_set(host_id: String, token: String) -> Result<(), String> {
    spawn_blocking_result(move || {
        entry(&host_id)?
            .set_password(&token)
            .map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
async fn token_delete(host_id: String) -> Result<(), String> {
    spawn_blocking_result(move || match entry(&host_id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    })
    .await
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
async fn vault_get(id: String) -> Result<Option<String>, String> {
    spawn_blocking_result(move || match vault_entry(&id)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    })
    .await
}

#[tauri::command]
async fn vault_set(id: String, value: String) -> Result<(), String> {
    if cfg!(windows) && value.encode_utf16().count() * 2 > WINDOWS_CREDENTIAL_MAX_BYTES {
        return Err(format!(
            "the value is over {WINDOWS_CREDENTIAL_MAX_BYTES} bytes, the limit of the Windows credential store"
        ));
    }
    spawn_blocking_result(move || {
        vault_entry(&id)?
            .set_password(&value)
            .map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
async fn vault_delete(id: String) -> Result<(), String> {
    spawn_blocking_result(move || match vault_entry(&id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    })
    .await
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
/// The dialog wait and the read both run on the blocking pool.
#[tauri::command]
async fn vault_pick_file(
    app: tauri::AppHandle,
    state: State<'_, PickedFile>,
) -> Result<Option<PickedFileInfo>, String> {
    use std::io::Read;
    use tauri_plugin_dialog::DialogExt;
    // A new pick forgets the last one, even when this one fails or is cancelled.
    *state.0.lock().map_err(|e| e.to_string())? = None;
    let picked = spawn_blocking_result(move || {
        let Some(picked) = app.dialog().file().blocking_pick_file() else {
            return Ok(None);
        };
        let path = picked.into_path().map_err(|e| e.to_string())?;
        // Bounded while reading, so a file that grows (or a device) cannot get past the cap.
        let mut text = String::new();
        std::fs::File::open(&path) // NOSONAR: runs inside spawn_blocking_result, on the blocking pool
            .map_err(|e| e.to_string())?
            .take(PICKED_FILE_MAX_BYTES + 1)
            .read_to_string(&mut text)
            .map_err(|e| e.to_string())?;
        if text.len() as u64 > PICKED_FILE_MAX_BYTES {
            return Err("the file is too big to be a key".to_string());
        }
        Ok(Some((path, text)))
    })
    .await?;
    let Some((path, text)) = picked else {
        return Ok(None);
    };
    *state.0.lock().map_err(|e| e.to_string())? = Some(path.clone());
    Ok(Some(PickedFileInfo {
        path: path.to_string_lossy().into_owned(),
        text,
    }))
}

/// What a task's result may be when the app opens it: documents and pictures, never anything that
/// runs (no programs, scripts, shortcuts, macro documents or pages). Office files stay: they are
/// active content (no Protected View for files this machine wrote), a risk recorded in
/// DECISIONS. `svg` (script in a browser) and `json` (some systems open it in one) are out.
const OPENABLE: &[&str] = &[
    "pdf", "txt", "md", "csv", "png", "jpg", "jpeg", "gif", "webp", "docx", "xlsx", "pptx", "odt",
    "ods", "odp",
];

/// Whether a path ends in one of the extensions a result may have, whatever the case.
fn has_openable_extension(path: &std::path::Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| OPENABLE.contains(&ext.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

/// The checks that need no disk, done before the disk is touched: a full path on a local drive (on
/// Windows) or under the root (elsewhere), with no network share, device path or alternate data
/// stream, no `..` and no trailing dot or space.
fn check_path_text(path: &str) -> Result<(), String> {
    if path.is_empty() || path.contains('\0') {
        return Err("not a path".to_string());
    }
    let bytes = path.as_bytes();
    let sep = |b: u8| b == b'/' || b == b'\\';
    // Any two leading separators are a network or device path on Windows (`\\`, `/\`, `\\?\`,
    // `\\.\`), and touching one hands the user's credentials to a server.
    if bytes.len() >= 2 && sep(bytes[0]) && sep(bytes[1]) {
        return Err("network and device paths are not opened".to_string());
    }
    if cfg!(windows) {
        let drive = bytes.len() >= 3 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':';
        if !drive || !sep(bytes[2]) {
            return Err("a path starts at the root of a drive".to_string());
        }
        // A colon after the drive letter names an alternate data stream.
        if path[2..].contains(':') {
            return Err("streams are not opened".to_string());
        }
    } else if bytes[0] != b'/' {
        return Err("a path starts at the root".to_string());
    }
    // Windows drops a trailing dot or space, so the name would be another one on disk.
    if path.ends_with('.') || path.ends_with(' ') {
        return Err("a name does not end in a dot or a space".to_string());
    }
    if path.split(['/', '\\']).any(|part| part == "..") {
        return Err("no .. in a path".to_string());
    }
    Ok(())
}

/// The text checks of a file to open: those of a path, and a document's extension.
fn check_result_text(path: &str) -> Result<(), String> {
    check_path_text(path)?;
    if !has_openable_extension(std::path::Path::new(path)) {
        return Err("this kind of file is not opened".to_string());
    }
    Ok(())
}

/// Whether two spellings of a path are the same place (case blind on Windows, `\\?\` ignored).
fn same_path(real: &std::path::Path, given: &std::path::Path) -> bool {
    let norm = |path: &std::path::Path| {
        let text = path.to_string_lossy().replace('\\', "/");
        let text = text.strip_prefix("//?/").unwrap_or(&text).to_string();
        let text = if cfg!(windows) { text.to_lowercase() } else { text };
        text.trim_end_matches('/').to_string()
    };
    norm(real) == norm(given)
}

/// The file a result path names, once it is known to be a plain document of this machine: the text
/// checks, a regular file that is not a link, and a real path that is the one given (a link or a
/// junction anywhere on the way would make them differ).
fn checked_result(path: &str, reveal: bool) -> Result<std::path::PathBuf, String> {
    // Showing a file in its folder skips the list of extensions (a folder is fine), never the rest.
    if reveal {
        check_path_text(path)?;
    } else {
        check_result_text(path)?;
    }
    let given = std::path::Path::new(path);
    let meta = std::fs::symlink_metadata(given).map_err(|e| e.to_string())?;
    if meta.file_type().is_symlink() || !(meta.is_file() || (reveal && meta.is_dir())) {
        return Err("only a plain file is opened".to_string());
    }
    let real = std::fs::canonicalize(given).map_err(|e| e.to_string())?;
    if !same_path(&real, given) || (!reveal && !has_openable_extension(&real)) {
        return Err("a link on the way to the file".to_string());
    }
    Ok(real)
}

/// Opens a file a task made with the system's default app, or shows it in the file manager. The
/// webview cannot ask the opener plugin for a path itself: only this command, which refuses
/// anything that is not a plain document (see `checked_result`).
#[tauri::command]
async fn open_result(app: tauri::AppHandle, path: String, reveal: bool) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    spawn_blocking_result(move || {
        let file = checked_result(&path, reveal)?;
        // canonicalize gives the `\\?\C:\...` form on Windows, which explorer.exe cannot open.
        let plain = dunce::simplified(&file);
        if reveal {
            app.opener().reveal_item_in_dir(plain).map_err(|e| e.to_string())
        } else {
            app.opener()
                .open_path(plain.to_string_lossy().to_string(), None::<String>)
                .map_err(|e| e.to_string())
        }
    })
    .await
}

#[cfg(test)]
mod open_result_tests {
    use super::*;

    #[test]
    fn a_document_on_a_drive_or_under_the_root_passes_the_text_checks() {
        if cfg!(windows) {
            assert!(check_result_text("C:\\Users\\ana\\Reports\\Q3.DOCX").is_ok());
            assert!(check_result_text("D:/work/a.pdf").is_ok());
        } else {
            assert!(check_result_text("/home/ana/Reports/a.md").is_ok());
        }
    }

    #[test]
    fn network_paths_streams_relative_paths_and_dotdot_are_refused() {
        for path in [
            "\\\\server\\share\\a.pdf",
            "//server/share/a.pdf",
            "\\\\?\\UNC\\server\\share\\a.pdf",
            "/\\server\\share\\a.pdf",
            "/\\attacker\\share\\a.pdf",
            "/\\.\\pipe\\x.pdf",
            "/\\.\\C:\\a.pdf",
            "\\\\.\\C:\\a.pdf",
            "\\\\?\\C:\\a.pdf",
            "C:\\x\\report.pdf.",
            "C:\\x\\report.pdf ",
            "C:\\work\\a.pdf:evil.exe",
            "C:work\\a.pdf",
            "relative/a.pdf",
            "a.pdf",
            "/home/ana/../root/a.pdf",
            "C:\\work\\..\\a.pdf",
            "",
        ] {
            assert!(check_result_text(path).is_err(), "{path} should be refused");
        }
    }

    #[test]
    fn a_folder_may_be_shown_but_not_opened() {
        // Reveal skips the list of extensions, never the other checks.
        let root = if cfg!(windows) { "C:\\work\\folder" } else { "/work/folder" };
        assert!(check_path_text(root).is_ok());
        assert!(check_result_text(root).is_err());
        assert!(check_path_text("/\\server\\share\\folder").is_err());
    }

    #[test]
    fn programs_scripts_shortcuts_pages_and_macro_documents_are_refused() {
        for kind in [
            "exe", "bat", "cmd", "lnk", "url", "sh", "ps1", "html", "htm", "js", "vbs", "docm",
            "xlsm", "scr", "msi", "jar", "app", "desktop", "reg", "dll", "svg", "json",
        ] {
            let path = format!("/home/ana/Reports/report.{kind}");
            // The extension is the only check that can fail here, whatever the platform.
            assert!(check_result_text(&path).is_err(), "{kind} should be refused");
        }
        assert!(check_result_text("/home/ana/Reports/noextension").is_err());
    }

    #[test]
    fn the_same_place_is_the_same_whatever_the_spelling() {
        use std::path::Path;
        assert!(same_path(Path::new("/a/b/c.pdf"), Path::new("/a/b/c.pdf/")));
        assert!(same_path(Path::new("\\\\?\\C:\\a\\c.pdf"), Path::new("C:\\a\\c.pdf")) || !cfg!(windows));
        assert!(!same_path(Path::new("/a/b/c.pdf"), Path::new("/a/x/c.pdf")));
    }

    #[cfg(unix)]
    #[test]
    fn a_link_and_a_directory_are_refused_on_disk_and_a_plain_document_is_not() {
        let dir = std::env::temp_dir().join(format!("fd-open-result-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let dir = std::fs::canonicalize(&dir).unwrap();
        let file = dir.join("a.pdf");
        std::fs::write(&file, b"x").unwrap();
        let link = dir.join("link.pdf");
        std::os::unix::fs::symlink(&file, &link).unwrap();
        let folder = dir.join("folder.pdf");
        std::fs::create_dir_all(&folder).unwrap();
        assert!(checked_result(file.to_str().unwrap(), false).is_ok());
        assert!(checked_result(link.to_str().unwrap(), false).is_err());
        assert!(checked_result(folder.to_str().unwrap(), false).is_err());
        // A link in the folders on the way is refused too.
        let way = std::env::temp_dir().join(format!("fd-open-result-way-{}", std::process::id()));
        let _ = std::fs::remove_file(&way);
        std::os::unix::fs::symlink(&dir, &way).unwrap();
        assert!(checked_result(way.join("a.pdf").to_str().unwrap(), false).is_err());
        let _ = std::fs::remove_file(&way);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(windows)]
    #[test]
    fn on_windows_a_directory_a_short_name_and_a_junction_are_refused_on_disk() {
        use std::process::Command;
        let base = std::env::temp_dir().join(format!("fd-open-result-{}", std::process::id()));
        std::fs::create_dir_all(&base).unwrap();
        // The runner's temp path is an 8.3 one: spell it out in full first.
        let dir = dunce::canonicalize(&base).unwrap();
        let file = dir.join("a-long-document-name.pdf");
        std::fs::write(&file, b"x").unwrap();
        assert!(checked_result(file.to_str().unwrap(), false).is_ok());
        let folder = dir.join("x.pdf");
        std::fs::create_dir_all(&folder).unwrap();
        assert!(checked_result(folder.to_str().unwrap(), false).is_err());
        // The 8.3 spelling of the file is another spelling of the same place: refused.
        let short = Command::new("cmd")
            .args(["/C", &format!("for %I in (\"{}\") do @echo %~sI", file.display())])
            .output()
            .unwrap();
        let short = String::from_utf8_lossy(&short.stdout).trim().to_string();
        if !short.is_empty() && !same_path(std::path::Path::new(&short), &file) {
            assert!(checked_result(&short, false).is_err(), "{short} should be refused");
        }
        // A junction on the way is refused too.
        let junction = dir.join("junction");
        let made = Command::new("cmd")
            .args(["/C", "mklink", "/J", junction.to_str().unwrap(), dir.to_str().unwrap()])
            .output()
            .unwrap();
        assert!(made.status.success(), "mklink /J failed");
        let through = junction.join("a-long-document-name.pdf");
        assert!(checked_result(through.to_str().unwrap(), false).is_err());
        let _ = Command::new("cmd").args(["/C", "rmdir", junction.to_str().unwrap()]).output();
        let _ = std::fs::remove_dir_all(&dir);
    }
}

/// Opens the system folder dialog; `None` when it is cancelled. The folder is only a suggestion:
/// the daemon checks it against its allowed roots before anything uses it.
#[tauri::command]
async fn pick_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    spawn_blocking_result(move || {
        let Some(picked) = app.dialog().file().blocking_pick_folder() else {
            return Ok(None);
        };
        let path = picked.into_path().map_err(|e| e.to_string())?;
        // A path that is not valid UTF-8 would reach the daemon changed: refuse it here instead.
        let text = path
            .to_str()
            .ok_or_else(|| "the folder's name is not valid text".to_string())?;
        Ok(Some(text.to_string()))
    })
    .await
}

/// Deletes the file `vault_pick_file` returned last, and nothing else.
#[tauri::command]
async fn vault_remove_file(path: String, state: State<'_, PickedFile>) -> Result<(), String> {
    // The lock is released before the deletion waits on the blocking pool.
    let stored = {
        let mut picked = state.0.lock().map_err(|e| e.to_string())?;
        if picked.as_deref() != Some(std::path::Path::new(&path)) {
            return Err("only the file picked last can be deleted".to_string());
        }
        // Delete the path the dialog gave, not the string the frontend sent.
        picked.take()
    };
    if let Some(stored) = stored {
        spawn_blocking_result(move || {
            std::fs::remove_file(&stored) // NOSONAR: inside spawn_blocking_result, on the blocking pool
                .map_err(|e| e.to_string())
        })
        .await?;
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
async fn terminal_probe() -> TerminalEnv {
    tauri::async_runtime::spawn_blocking(|| TerminalEnv {
        windows: cfg!(windows),
        wt: cfg!(windows) && on_path("wt.exe"),
    })
    .await
    // A probe that did not finish reads as "no Windows Terminal": the app falls back to cmd.
    .unwrap_or(TerminalEnv {
        windows: cfg!(windows),
        wt: false,
    })
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
async fn terminal_open(program: String, args: Vec<String>) -> Result<(), String> {
    if !TERMINAL_PROGRAMS
        .iter()
        .any(|p| p.eq_ignore_ascii_case(&program))
    {
        return Err(format!("programa não permitido: {program}"));
    }
    spawn_blocking_result(move || {
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
    })
    .await
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
            open_result,
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
