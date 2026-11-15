//! Thin Tauri shell: everything else lives in the React frontend and the daemon.
//! Native pieces: the OS credential store for host tokens, single instance with deep-link
//! forwarding, the terminal of "Abrir no terminal", and the official plugins (notifications,
//! deep links, opener).

mod assistant;
mod backup_folder;
mod log;
mod oauth_loopback;
mod open_result;

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::menu::{Menu, MenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager, State, WindowEvent, Wry};

const KEYRING_SERVICE: &str = "dev.flightdeck.app";

/// Runs blocking work (the credential store, a PATH walk, a process spawn) on the blocking pool:
/// a plain `async fn` still holds one of the runtime's few workers while it waits.
pub(crate) async fn spawn_blocking_result<T: Send + 'static>(
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

pub(crate) fn vault_entry(id: &str) -> Result<keyring::Entry, String> {
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

/// Whether `value` is more than the Windows credential store keeps per entry (UTF-16 bytes).
fn over_credential_limit(value: &str) -> bool {
    value.encode_utf16().count() * 2 > WINDOWS_CREDENTIAL_MAX_BYTES
}

#[tauri::command]
async fn vault_set(id: String, value: String) -> Result<(), String> {
    if cfg!(windows) && over_credential_limit(&value) {
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

/// The `ssh-keygen` arguments for one `ed25519` pair with no passphrase, written to `key`.
fn keygen_args(comment: &str, key: &std::path::Path) -> Vec<std::ffi::OsString> {
    let mut args: Vec<std::ffi::OsString> = ["-q", "-t", "ed25519", "-N", "", "-C"]
        .into_iter()
        .map(Into::into)
        .collect();
    args.push(comment.into());
    args.push("-f".into());
    args.push(key.into());
    args
}

/// Runs `ssh-keygen` inside `dir` (a folder only this user can read) and reads both files back.
fn run_keygen(dir: &std::path::Path, comment: &str) -> Result<GeneratedKey, String> {
    let key = dir.join("key");
    let mut command = std::process::Command::new("ssh-keygen");
    command.args(keygen_args(comment, &key));
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
    if comment.chars().any(char::is_control) {
        return Err("the key comment has control characters".to_string());
    }
    // A missing or slow `ssh-keygen` must not freeze the window.
    tauri::async_runtime::spawn_blocking(move || generate_key(&comment))
        .await
        .map_err(|e| e.to_string())?
}

/// Makes `dir` (it must not exist yet) readable by this user only, where the platform allows it.
fn make_private_dir(dir: &std::path::Path) -> Result<(), String> {
    let mut builder = std::fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(dir).map_err(|e| e.to_string())
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
    make_private_dir(&dir)?;
    let result = run_keygen(&dir, comment);
    let _ = std::fs::remove_dir_all(&dir);
    result
}

/// The key file the person picked last. Only that file may be removed afterwards, so the frontend
/// cannot delete an arbitrary path.
#[derive(Default)]
struct PickedFile(std::sync::Mutex<Option<std::path::PathBuf>>);

/// Takes the file picked last out of `picked` when `path` names it; any other path is refused.
fn take_picked(
    picked: &std::sync::Mutex<Option<std::path::PathBuf>>,
    path: &str,
) -> Result<Option<std::path::PathBuf>, String> {
    let mut picked = picked.lock().map_err(|e| e.to_string())?;
    if picked.as_deref() != Some(std::path::Path::new(path)) {
        return Err("only the file picked last can be deleted".to_string());
    }
    // Delete the path the dialog gave, not the string the frontend sent.
    Ok(picked.take())
}

#[derive(serde::Serialize)]
struct PickedFileInfo {
    path: String,
    text: String,
}

/// A key file is a few KiB; anything bigger is not one.
const PICKED_FILE_MAX_BYTES: u64 = 1024 * 1024;

/// Reads `reader` as text, no further than the cap, so a file that grows (or a device) cannot get
/// past it.
fn read_picked(reader: impl std::io::Read) -> Result<String, String> {
    use std::io::Read;
    let mut text = String::new();
    reader
        .take(PICKED_FILE_MAX_BYTES + 1)
        .read_to_string(&mut text)
        .map_err(|e| e.to_string())?;
    if text.len() as u64 > PICKED_FILE_MAX_BYTES {
        return Err("the file is too big to be a key".to_string());
    }
    Ok(text)
}

/// Opens the system file dialog and reads the chosen file as text; `None` when it is cancelled.
/// The dialog wait and the read both run on the blocking pool.
#[tauri::command]
async fn vault_pick_file(
    app: tauri::AppHandle,
    state: State<'_, PickedFile>,
) -> Result<Option<PickedFileInfo>, String> {
    use tauri_plugin_dialog::DialogExt;
    // A new pick forgets the last one, even when this one fails or is cancelled.
    *state.0.lock().map_err(|e| e.to_string())? = None;
    let picked = spawn_blocking_result(move || {
        let Some(picked) = app.dialog().file().blocking_pick_file() else {
            return Ok(None);
        };
        let path = picked.into_path().map_err(|e| e.to_string())?;
        let text = read_picked(
            std::fs::File::open(&path) // NOSONAR: runs inside spawn_blocking_result, on the blocking pool
                .map_err(|e| e.to_string())?,
        )?;
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

#[cfg(test)]
mod vault_tests {
    use super::*;
    use std::ffi::OsString;
    use std::io::Cursor;
    use std::path::{Path, PathBuf};
    use std::sync::{Mutex, Once};

    /// Every vault test runs against the keyring's in-memory mock, never the machine's store.
    fn mock_keyring() {
        static ONCE: Once = Once::new();
        ONCE.call_once(|| {
            keyring::set_default_credential_builder(keyring::mock::default_credential_builder());
        });
    }

    #[test]
    fn the_credential_limit_counts_utf16_bytes_and_a_value_at_it_still_fits() {
        assert!(!over_credential_limit(""));
        assert!(!over_credential_limit(&"a".repeat(1280)));
        assert!(over_credential_limit(&"a".repeat(1281)));
        // An emoji is two UTF-16 units, so 640 of them are exactly the limit.
        assert!(!over_credential_limit(&"😀".repeat(640)));
        assert!(over_credential_limit(&"😀".repeat(641)));
    }

    #[test]
    fn a_value_over_the_windows_limit_is_refused_only_on_windows() {
        mock_keyring();
        let result = tauri::async_runtime::block_on(vault_set("limit".into(), "a".repeat(1281)));
        assert_eq!(result.is_err(), cfg!(windows));
        if let Err(message) = result {
            assert!(message.contains("2560"));
        }
        let at_the_limit =
            tauri::async_runtime::block_on(vault_set("limit".into(), "a".repeat(1280)));
        assert_eq!(at_the_limit, Ok(()));
    }

    #[test]
    fn a_key_comment_with_control_characters_is_refused_before_anything_runs() {
        for comment in ["a\nb", "a\u{7}b", "a\0b", "a\tb"] {
            let result = tauri::async_runtime::block_on(vault_generate_key(comment.to_string()));
            assert_eq!(
                result.err().as_deref(),
                Some("the key comment has control characters")
            );
        }
    }

    #[test]
    fn an_unknown_secret_reads_as_none_and_deletes_as_ok() {
        mock_keyring();
        let read = tauri::async_runtime::block_on(vault_get("never-stored".into()));
        assert_eq!(read, Ok(None));
        let deleted = tauri::async_runtime::block_on(vault_delete("never-stored".into()));
        assert_eq!(deleted, Ok(()));
    }

    #[test]
    fn the_keygen_arguments_are_one_ed25519_pair_without_a_passphrase() {
        let args = keygen_args("deploy key", Path::new("/t/key"));
        let expected: Vec<OsString> = [
            "-q",
            "-t",
            "ed25519",
            "-N",
            "",
            "-C",
            "deploy key",
            "-f",
            "/t/key",
        ]
        .into_iter()
        .map(OsString::from)
        .collect();
        assert_eq!(args, expected);
        // A comment that looks like an option is still one argument, after `-C`.
        let odd = keygen_args("-oProxyCommand=x", Path::new("/t/key"));
        assert_eq!(odd[5], OsString::from("-C"));
        assert_eq!(odd[6], OsString::from("-oProxyCommand=x"));
        assert_eq!(odd.len(), 9);
    }

    #[test]
    fn the_keygen_folder_is_private_and_never_reused() {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!(
            "flightdeck-vault-test-{}-{nanos}",
            std::process::id()
        ));
        assert_eq!(make_private_dir(&dir), Ok(()));
        assert!(dir.is_dir());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&dir).unwrap().permissions().mode();
            assert_eq!(mode & 0o077, 0, "group and others get nothing: {mode:o}");
        }
        // A folder that is already there is an error, never reused with someone else's content.
        assert!(make_private_dir(&dir).is_err());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_picked_file_is_read_up_to_the_cap_and_no_further() {
        let cap = PICKED_FILE_MAX_BYTES as usize;
        let at_the_cap = read_picked(Cursor::new("a".repeat(cap))).unwrap();
        assert_eq!(at_the_cap.len(), cap);
        let over = read_picked(Cursor::new("a".repeat(cap + 1)));
        assert_eq!(over, Err("the file is too big to be a key".to_string()));
        // A source that never ends (a device) stops at the cap instead of filling the memory.
        let endless = read_picked(std::io::repeat(b'a'));
        assert_eq!(endless, Err("the file is too big to be a key".to_string()));
        // A file that is not text is an error, not a lossy copy.
        assert!(read_picked(Cursor::new(vec![0xff, 0xfe])).is_err());
    }

    #[test]
    fn only_the_file_picked_last_can_be_taken() {
        let picked = Mutex::new(Some(PathBuf::from("/a/key")));
        let refused = take_picked(&picked, "/a/other");
        assert_eq!(
            refused,
            Err("only the file picked last can be deleted".to_string())
        );
        // The same name in another folder is another file.
        assert!(take_picked(&picked, "/b/key").is_err());
        // A refusal leaves the pick in place.
        assert_eq!(picked.lock().unwrap().as_deref(), Some(Path::new("/a/key")));
        assert_eq!(
            take_picked(&picked, "/a/key"),
            Ok(Some(PathBuf::from("/a/key")))
        );
        // It can be taken once.
        assert!(take_picked(&picked, "/a/key").is_err());
    }

    #[test]
    fn the_deleted_path_is_the_one_the_dialog_gave() {
        let picked = Mutex::new(Some(PathBuf::from("/a/./key")));
        let taken = take_picked(&picked, "/a/key").unwrap().unwrap();
        assert_eq!(taken.as_os_str(), "/a/./key");
    }

    #[test]
    fn a_new_pick_state_starts_empty() {
        let state = PickedFile::default();
        assert!(state.0.lock().unwrap().is_none());
        assert!(take_picked(&state.0, "/a/key").is_err());
    }
}

#[cfg(test)]
mod badge_tests {
    use super::*;

    #[test]
    fn the_badge_is_nothing_or_exactly_32_by_32_rgba() {
        assert!(badge_image_ok(0));
        assert!(badge_image_ok(32 * 32 * 4));
        assert!(!badge_image_ok(1));
        assert!(!badge_image_ok(32 * 32 * 3));
        assert!(!badge_image_ok(32 * 32 * 4 + 1));
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

/// Where the backup folder's pick is kept: the app's own config folder (no path comes from the webview).
fn backup_config(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app.path().app_config_dir().map_err(|e| e.to_string())
}

/// The folder every backup command works in: the one the person picked, never one the webview names.
fn backup_dir(app: &tauri::AppHandle) -> Result<String, String> {
    backup_folder::load_folder(&backup_config(app)?)
        .ok_or_else(|| "no backup folder is chosen".to_string())
}

/// Opens the system folder dialog for the scheduled backups (issue #1264) and keeps the pick; `None`
/// when it is cancelled. The other backup commands use only this folder.
#[tauri::command]
async fn backup_folder_pick(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    spawn_blocking_result(move || {
        let Some(picked) = app.dialog().file().blocking_pick_folder() else {
            return Ok(None);
        };
        let path = picked.into_path().map_err(|e| e.to_string())?;
        let text = path
            .to_str()
            .ok_or_else(|| "the folder's name is not valid text".to_string())?;
        backup_folder::save_folder(&backup_config(&app)?, text)?;
        Ok(Some(text.to_string()))
    })
    .await
}

/// The folder picked last, if it is still there.
#[tauri::command]
async fn backup_folder_current(app: tauri::AppHandle) -> Result<Option<String>, String> {
    spawn_blocking_result(move || Ok(backup_folder::load_folder(&backup_config(&app)?))).await
}

/// Writes a scheduled backup into the picked folder; the module checks the name.
#[tauri::command]
async fn backup_folder_write(
    app: tauri::AppHandle,
    name: String,
    text: String,
) -> Result<(), String> {
    spawn_blocking_result(move || backup_folder::write_backup(&backup_dir(&app)?, &name, &text))
        .await
}

/// The backups in the picked folder, oldest first.
#[tauri::command]
async fn backup_folder_list(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    spawn_blocking_result(move || backup_folder::list_backups(&backup_dir(&app)?)).await
}

/// Removes one old backup from the picked folder; nothing named otherwise.
#[tauri::command]
async fn backup_folder_remove(app: tauri::AppHandle, name: String) -> Result<(), String> {
    spawn_blocking_result(move || backup_folder::remove_backup(&backup_dir(&app)?, &name)).await
}

/// The sign-in listeners of the Google Drive backup (#1462), by id. One at a time: a new sign-in
/// cancels the one before.
#[derive(Default)]
struct OauthLoopbacks {
    next: std::sync::atomic::AtomicU64,
    sessions: std::sync::Mutex<std::collections::HashMap<u64, OauthSession>>,
}

struct OauthSession {
    /// Taken by the wait: the listener serves once.
    listener: Option<oauth_loopback::Listener>,
    cancel: std::sync::Arc<AtomicBool>,
}

#[derive(serde::Serialize)]
struct OauthListening {
    id: u64,
    port: u16,
}

/// How long the person has to finish Google's consent page.
const OAUTH_WAIT: std::time::Duration = std::time::Duration::from_secs(5 * 60);

/// Opens a listener on 127.0.0.1 for the sign-in whose `state` is given. Nothing here is logged.
#[tauri::command]
async fn oauth_loopback_listen(
    app: tauri::AppHandle,
    state: String,
) -> Result<OauthListening, String> {
    spawn_blocking_result(move || {
        let loopbacks = app.state::<OauthLoopbacks>();
        let listener = oauth_loopback::bind(&state)?;
        let port = listener.port();
        let id = loopbacks.next.fetch_add(1, Ordering::SeqCst) + 1;
        let mut sessions = loopbacks.sessions.lock().map_err(|e| e.to_string())?;
        for (_, old) in sessions.drain() {
            old.cancel.store(true, Ordering::SeqCst);
        }
        sessions.insert(
            id,
            OauthSession {
                listener: Some(listener),
                cancel: std::sync::Arc::new(AtomicBool::new(false)),
            },
        );
        Ok(OauthListening { id, port })
    })
    .await
}

/// Waits for the redirect: the code, or `None` when the person refused, it timed out or it was
/// cancelled. The session is over when this returns.
#[tauri::command]
async fn oauth_loopback_wait(app: tauri::AppHandle, id: u64) -> Result<Option<String>, String> {
    spawn_blocking_result(move || {
        let loopbacks = app.state::<OauthLoopbacks>();
        let (listener, cancel) = {
            let mut sessions = loopbacks.sessions.lock().map_err(|e| e.to_string())?;
            let session = sessions
                .get_mut(&id)
                .ok_or_else(|| "no sign-in is waiting".to_string())?;
            let listener = session
                .listener
                .take()
                .ok_or_else(|| "the sign-in is already waiting".to_string())?;
            (listener, session.cancel.clone())
        };
        let outcome = listener.wait(OAUTH_WAIT, &cancel);
        if let Ok(mut sessions) = loopbacks.sessions.lock() {
            sessions.remove(&id);
        }
        Ok(match outcome {
            oauth_loopback::Outcome::Code(code) => Some(code),
            _ => None,
        })
    })
    .await
}

/// Ends a sign-in: a wait in progress returns, and the port closes.
#[tauri::command]
async fn oauth_loopback_cancel(app: tauri::AppHandle, id: u64) -> Result<(), String> {
    spawn_blocking_result(move || {
        let loopbacks = app.state::<OauthLoopbacks>();
        let mut sessions = loopbacks.sessions.lock().map_err(|e| e.to_string())?;
        if let Some(session) = sessions.remove(&id) {
            session.cancel.store(true, Ordering::SeqCst);
        }
        Ok(())
    })
    .await
}

/// Deletes the file `vault_pick_file` returned last, and nothing else.
#[tauri::command]
async fn vault_remove_file(path: String, state: State<'_, PickedFile>) -> Result<(), String> {
    // The lock is released before the deletion waits on the blocking pool.
    let stored = take_picked(&state.0, &path)?;
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

/// One open request of the submenu, built by the frontend (apps/desktop/src/features/tray/domain/tray.ts).
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

/// Issue #402: how long Quit waits for the app (it may be installing a downloaded update) before
/// the shell exits anyway. An emit succeeds even with no page listening (before the app has started,
/// or after it crashed), so this wait is also what such a Quit costs: kept short.
const QUIT_GRACE: std::time::Duration = std::time::Duration::from_secs(10);

/// The tray's Quit: the app is asked first and calls `quit_now` when it is done; if the event cannot
/// be sent at all the shell exits at once, and otherwise after `QUIT_GRACE` at the latest.
fn request_quit(app: &tauri::AppHandle) {
    if app.emit("quit-requested", ()).is_err() {
        app.exit(0);
        return;
    }
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(QUIT_GRACE);
        handle.exit(0);
    });
}

/// Issue #402: the app finished what Quit asked of it (an update installed, or nothing to do).
#[tauri::command]
fn quit_now(app: tauri::AppHandle) {
    app.exit(0);
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

/// The overlay the app draws on its taskbar button: 32 x 32 pixels of RGBA.
const BADGE_BYTES: usize = 32 * 32 * 4;

/// Whether `len` bytes are a picture the overlay can show: none (clear it) or exactly 32 x 32 RGBA.
fn badge_image_ok(len: usize) -> bool {
    len == 0 || len == BADGE_BYTES
}

/// Shows the unread count on the taskbar button of the main window (Windows). The webview draws the
/// picture; this only checks its size and hands it over, so the webview has no window permission of
/// its own for the overlay. An empty picture clears the badge. Other systems have no such badge.
#[tauri::command]
fn set_unread_badge(app: tauri::AppHandle, rgba: Vec<u8>) -> Result<(), String> {
    if !badge_image_ok(rgba.len()) {
        return Err("the badge must be 32 x 32 RGBA".into());
    }
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "no main window".to_string())?;
    #[cfg(windows)]
    {
        let icon = if rgba.is_empty() {
            None
        } else {
            Some(tauri::image::Image::new_owned(rgba, 32, 32))
        };
        window.set_overlay_icon(icon).map_err(|e| e.to_string())?;
    }
    #[cfg(not(windows))]
    {
        let _ = (window, rgba);
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

/// The only programs the frontend may start: the command is built there (apps/desktop/src/features/terminal/domain/terminal.ts).
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
            "quit" => request_quit(app),
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
        .manage(OauthLoopbacks::default())
        .manage(assistant::Assistant::default())
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
            backup_folder_pick,
            backup_folder_current,
            backup_folder_write,
            backup_folder_list,
            backup_folder_remove,
            oauth_loopback_listen,
            oauth_loopback_wait,
            oauth_loopback_cancel,
            open_result::open_result,
            log::append_log,
            log::read_log_tail,
            log::open_logs_dir,
            vault_remove_file,
            tray_set_status,
            tray_set_menu,
            set_unread_badge,
            set_close_to_tray,
            focus_main,
            terminal_probe,
            terminal_open,
            quit_now,
            assistant::assistant_key_set,
            assistant::assistant_key_status,
            assistant::assistant_key_delete,
            assistant::assistant_test,
            assistant::assistant_models,
            assistant::assistant_run,
            assistant::assistant_cancel,
            assistant::vault_hits
        ])
        .run(tauri::generate_context!())
        .expect("error while running Flightdeck");
}
