//! The vault's commands (#1589): the secrets in the OS credential store, the `ssh-keygen` pair,
//! and the key file the person picked. The webview names a secret id and a value, never a path:
//! the only file it can delete is the one the dialog gave last.

use crate::spawn_blocking_result;
use tauri::State;

/// Phase 16: the vault's values live in the OS credential store under their own service, one
/// entry per secret id. The list and metadata stay in the app's storage and never hold a value.
const VAULT_SERVICE: &str = "flightdeck-vault";

/// The Windows credential store keeps at most 2560 bytes per entry, and `keyring` writes UTF-16.
const WINDOWS_CREDENTIAL_MAX_BYTES: usize = 2560;

pub(crate) fn vault_entry(id: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(VAULT_SERVICE, id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vault_get(id: String) -> Result<Option<String>, String> {
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
pub async fn vault_set(id: String, value: String) -> Result<(), String> {
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
pub async fn vault_delete(id: String) -> Result<(), String> {
    spawn_blocking_result(move || match vault_entry(&id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    })
    .await
}

/// A key pair `ssh-keygen` made: the private key goes to the vault, the public one to the screen.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedKey {
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
pub async fn vault_generate_key(comment: String) -> Result<GeneratedKey, String> {
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
pub struct PickedFile(std::sync::Mutex<Option<std::path::PathBuf>>);

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
pub struct PickedFileInfo {
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
pub async fn vault_pick_file(
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

/// Deletes the file `vault_pick_file` returned last, and nothing else.
#[tauri::command]
pub async fn vault_remove_file(path: String, state: State<'_, PickedFile>) -> Result<(), String> {
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
        // The folder goes away even when an assertion below fails.
        struct Cleanup(PathBuf);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }
        let _cleanup = Cleanup(dir.clone());
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
}
