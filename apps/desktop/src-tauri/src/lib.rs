//! Thin Tauri shell: everything else lives in the React frontend and the daemon.
//! Native pieces: the OS credential store for host tokens, single instance with deep-link
//! forwarding, the terminal of "Abrir no terminal", and the official plugins (notifications,
//! deep links, opener).

mod assistant;
mod backup_folder;

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
    if comment.chars().any(char::is_control) {
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
        .and_then(std::ffi::OsStr::to_str)
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

// -- the app's own log file (issue #255) -------------------------------------------------------

/// A log file rotates past this size.
const LOG_MAX_BYTES: u64 = 5 * 1024 * 1024;
/// How many files the log keeps, the live one included.
const LOG_FILES: usize = 5;
/// A line is cut here, in bytes of text. The webview has already cut it and removed its secrets.
const LOG_MAX_LINE: usize = 4000;
/// The most lines `read_log_tail` hands back.
const LOG_MAX_TAIL: usize = 500;
/// `read_log_tail` reads this much of the end of each file at most.
const LOG_TAIL_BYTES: u64 = 256 * 1024;
const LOG_NAME: &str = "flightdeck.log";
/// If a rotation keeps failing (a viewer holds the file open on Windows), the live file may grow to
/// this many times its limit before a line is refused: logging is not lost at the first hiccup,
/// and stays bounded.
const LOG_HARD_LIMIT_FACTOR: u64 = 2;
/// The most lines one `append_log` call takes (issue #259). The webview batches what arrives while
/// a write is in flight and holds at most 500 waiting; past this the call is refused whole. Tauri
/// has already built the list by then: this bounds the disk work and the time under the lock, not
/// the memory of the call.
const LOG_MAX_BATCH: usize = 1000;
/// One writer at a time: `append_log` runs on the blocking pool, and two appends at the rotation
/// boundary would each rotate and push history out.
static LOG_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// File `n` of the log: 0 is the live one, 1 the one before it, and so on.
fn log_path(dir: &std::path::Path, n: usize) -> std::path::PathBuf {
    if n == 0 {
        dir.join(LOG_NAME)
    } else {
        dir.join(format!("{LOG_NAME}.{n}"))
    }
}

/// Shifts the files one place up: the live one becomes `.1`, the oldest is dropped.
fn rotate_logs(dir: &std::path::Path, files: usize) -> std::io::Result<()> {
    rotate_logs_with(dir, files, |from, to| std::fs::rename(from, to))
}

/// `rotate_logs` with the rename given, so a test can make one fail. Only the files below the first
/// free slot move, and the oldest is dropped only when there is no free slot (issue #259): a
/// rotation whose last rename fails (a viewer holds the live file on Windows) leaves `.1` free, so
/// trying again, line after line, drops nothing.
fn rotate_logs_with(
    dir: &std::path::Path,
    files: usize,
    rename: impl Fn(&std::path::Path, &std::path::Path) -> std::io::Result<()>,
) -> std::io::Result<()> {
    let files = files.max(1);
    let top = match (1..files).find(|&n| !log_path(dir, n).exists()) {
        Some(free) => free,
        None => {
            std::fs::remove_file(log_path(dir, files - 1))?;
            files - 1
        }
    };
    for n in (0..top).rev() {
        let from = log_path(dir, n);
        if from.exists() {
            rename(&from, &log_path(dir, n + 1))?;
        }
    }
    Ok(())
}

/// Makes the log folder, private to the user where the system has such a thing.
fn make_log_dir(dir: &std::path::Path) -> std::io::Result<()> {
    let mut builder = std::fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(dir)
}

/// Whether `path` is a regular file, not a link and not a pipe or a device (the link itself is
/// looked at, never what it points to). A missing path is not one.
fn is_regular_file(path: &std::path::Path) -> bool {
    std::fs::symlink_metadata(path)
        .map(|m| m.file_type().is_file())
        .unwrap_or(false)
}

/// Opens the live file for appending, owner-only on creation, and never through a link: a link
/// planted where the log goes would make the log write somewhere else. Something that is there
/// and is not a regular file (a link, a pipe that would block the open) is refused.
fn open_live_log(path: &std::path::Path) -> std::io::Result<std::fs::File> {
    let exists_but_not_regular = std::fs::symlink_metadata(path).is_ok() && !is_regular_file(path);
    if exists_but_not_regular {
        return Err(std::io::Error::other("the log file is not a regular file"));
    }
    open_append(path)
}

/// The open itself: append, owner-only on creation. On Unix it refuses a link at the last part of
/// the path (`O_NOFOLLOW`), so a link planted between the look above and this open is not followed
/// either (issue #259). Windows has no such flag; the look above is what refuses a link there.
fn open_append(path: &std::path::Path) -> std::io::Result<std::fs::File> {
    let mut options = std::fs::OpenOptions::new();
    options.create(true).append(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
    }
    options.open(path)
}

/// Appends one line, flattened and cut, rotating first when the live file would pass the limit.
#[cfg(test)]
fn append_line(
    dir: &std::path::Path,
    line: &str,
    max_bytes: u64,
    files: usize,
) -> std::io::Result<()> {
    append_lines(dir, &[line.to_string()], max_bytes, files)
}

/// Appends the lines in order under one lock, each as `append_one` does (issue #259). A batch of
/// more than `LOG_MAX_BATCH` lines is refused whole: the list comes from the webview.
fn append_lines(
    dir: &std::path::Path,
    lines: &[String],
    max_bytes: u64,
    files: usize,
) -> std::io::Result<()> {
    if lines.len() > LOG_MAX_BATCH {
        return Err(std::io::Error::other("too many log lines in one call"));
    }
    let _one_writer = LOG_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    make_log_dir(dir)?;
    for line in lines {
        append_one(dir, line, max_bytes, files)?;
    }
    Ok(())
}

/// One line, flattened and cut, rotating first when the live file would pass the limit. The
/// caller holds `LOG_LOCK` and has made the folder.
fn append_one(
    dir: &std::path::Path,
    line: &str,
    max_bytes: u64,
    files: usize,
) -> std::io::Result<()> {
    use std::io::Write;
    // Cut first, on a character boundary, so a flood is never copied whole.
    let mut cut = line;
    if cut.len() > LOG_MAX_LINE {
        let mut end = LOG_MAX_LINE;
        while !cut.is_char_boundary(end) {
            end -= 1;
        }
        cut = &cut[..end];
    }
    let mut text = cut.replace(['\r', '\n'], " ");
    text.push('\n');
    let live = log_path(dir, 0);
    let size = std::fs::metadata(&live).map(|m| m.len()).unwrap_or(0);
    if size > 0 && size + text.len() as u64 > max_bytes {
        // A failed rotation still lets the line in, until the hard limit.
        let hard_limit = max_bytes.saturating_mul(LOG_HARD_LIMIT_FACTOR);
        if rotate_logs(dir, files).is_err() && size + text.len() as u64 > hard_limit {
            return Err(std::io::Error::other("the log is full and cannot rotate"));
        }
    }
    let mut file = open_live_log(&live)?;
    file.write_all(text.as_bytes())
}

/// The end of a regular file (at most `LOG_TAIL_BYTES`), from the start of a whole line. A file
/// that is missing, a link or not a regular file reads as nothing.
fn read_log_end(path: &std::path::Path) -> Option<String> {
    use std::io::{Read, Seek, SeekFrom};
    if !is_regular_file(path) {
        return None;
    }
    let mut file = std::fs::File::open(path).ok()?;
    let meta = file.metadata().ok()?;
    if !meta.is_file() {
        return None;
    }
    let start = meta.len().saturating_sub(LOG_TAIL_BYTES);
    file.seek(SeekFrom::Start(start)).ok()?;
    let mut bytes = Vec::new();
    file.take(LOG_TAIL_BYTES).read_to_end(&mut bytes).ok()?;
    // Lossy: a file with a broken character (a crash mid-write) is still read.
    let text = String::from_utf8_lossy(&bytes).into_owned();
    if start == 0 {
        return Some(text);
    }
    // The window starts in the middle of a line: the piece is not handed out.
    Some(match text.find('\n') {
        Some(at) => text[at + 1..].to_string(),
        None => String::new(),
    })
}

/// The last `wanted` lines (at most `LOG_MAX_TAIL`) across the files, oldest first.
fn tail_lines(dir: &std::path::Path, wanted: usize, files: usize) -> Vec<String> {
    let wanted = wanted.min(LOG_MAX_TAIL);
    let mut out: Vec<String> = Vec::new();
    for n in 0..files {
        if out.len() >= wanted {
            break;
        }
        let Some(text) = read_log_end(&log_path(dir, n)) else {
            continue;
        };
        let lines: Vec<&str> = text.lines().filter(|l| !l.is_empty()).collect();
        let take = (wanted - out.len()).min(lines.len());
        let mut chunk: Vec<String> = lines[lines.len() - take..]
            .iter()
            .map(ToString::to_string)
            .collect();
        chunk.append(&mut out);
        out = chunk;
    }
    out
}

/// The folder of the app's logs, the OS's own for this app (no path comes from the webview).
fn app_logs(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app.path().app_log_dir().map_err(|e| e.to_string())
}

/// Appends lines of the app's log, in order (issue #259: the webview batches what arrives while a
/// write is in flight). The webview redacts each with the protocol's scanner first.
#[tauri::command]
async fn append_log(app: tauri::AppHandle, lines: Vec<String>) -> Result<(), String> {
    let dir = app_logs(&app)?;
    spawn_blocking_result(move || {
        append_lines(&dir, &lines, LOG_MAX_BYTES, LOG_FILES).map_err(|e| e.to_string())
    })
    .await
}

/// The last lines of the app's log, for "Copy diagnostics".
#[tauri::command]
async fn read_log_tail(app: tauri::AppHandle, lines: usize) -> Result<Vec<String>, String> {
    let dir = app_logs(&app)?;
    spawn_blocking_result(move || Ok(tail_lines(&dir, lines, LOG_FILES))).await
}

/// Opens the app's log folder in the system's file manager.
#[tauri::command]
async fn open_logs_dir(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let dir = app_logs(&app)?;
    spawn_blocking_result(move || {
        make_log_dir(&dir).map_err(|e| e.to_string())?;
        let plain = dunce::simplified(&dir);
        app.opener()
            .open_path(plain.to_string_lossy().to_string(), None::<String>)
            .map_err(|e| e.to_string())
    })
    .await
}

#[cfg(test)]
mod log_tests {
    use super::*;

    fn scratch(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("fd-log-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn a_line_is_appended_as_one_line() {
        let dir = scratch("one");
        append_line(&dir, "first\nsecond\r\nthird", 1024, 3).unwrap();
        append_line(&dir, "next", 1024, 3).unwrap();
        let text = std::fs::read_to_string(log_path(&dir, 0)).unwrap();
        assert_eq!(text, "first second  third\nnext\n");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_long_line_is_cut_on_a_character_boundary() {
        let dir = scratch("long");
        // Three bytes each, and 4000 is not a multiple of 3: the cut has to step back.
        let line = "€".repeat(LOG_MAX_LINE);
        append_line(&dir, &line, 1 << 20, 3).unwrap();
        let text = std::fs::read_to_string(log_path(&dir, 0)).unwrap();
        assert!(text.trim_end().len() <= LOG_MAX_LINE);
        assert!(text.ends_with('\n'));
        assert!(text.trim_end().chars().all(|c| c == '€'));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_files_rotate_and_the_oldest_is_dropped() {
        let dir = scratch("rotate");
        for i in 0..40 {
            append_line(&dir, &format!("message number {i} with some padding"), 200, 3).unwrap();
        }
        assert!(log_path(&dir, 0).exists());
        assert!(log_path(&dir, 1).exists());
        assert!(log_path(&dir, 2).exists());
        assert!(!log_path(&dir, 3).exists());
        let live = std::fs::read_to_string(log_path(&dir, 0)).unwrap();
        assert!(live.contains("message number 39"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn one_file_just_starts_over() {
        let dir = scratch("single");
        for _ in 0..10 {
            append_line(&dir, "only", 10, 1).unwrap();
        }
        assert!(log_path(&dir, 0).exists());
        assert!(!log_path(&dir, 1).exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_tail_crosses_the_files_in_order() {
        let dir = scratch("tail");
        for i in 0..30 {
            append_line(&dir, &format!("n{i}"), 40, 4).unwrap();
        }
        // The live file holds fewer than 14 lines, so the answer comes from older files too.
        let last = tail_lines(&dir, 14, 4);
        assert_eq!(last.len(), 14);
        assert_eq!(last.first().map(String::as_str), Some("n16"));
        assert_eq!(last.last().map(String::as_str), Some("n29"));
        assert_eq!(tail_lines(&dir, 0, 4).len(), 0);
        assert!(tail_lines(&scratch("missing"), 5, 4).is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_tail_is_capped() {
        let dir = scratch("cap");
        for i in 0..(LOG_MAX_TAIL + 100) {
            append_line(&dir, &format!("n{i}"), 1 << 20, 2).unwrap();
        }
        assert_eq!(tail_lines(&dir, 100_000, 2).len(), LOG_MAX_TAIL);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn the_folder_is_private_and_the_files_are_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let dir = scratch("modes").join("logs");
        for i in 0..8 {
            append_line(&dir, &format!("message number {i} with some padding"), 100, 3).unwrap();
        }
        let mode = |p: &std::path::Path| std::fs::metadata(p).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode(&dir), 0o700);
        assert_eq!(mode(&log_path(&dir, 0)), 0o600);
        assert_eq!(mode(&log_path(&dir, 1)), 0o600);
        let _ = std::fs::remove_dir_all(dir.parent().unwrap());
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_where_the_log_is_never_written_through_or_read() {
        let dir = scratch("link");
        std::fs::create_dir_all(&dir).unwrap();
        let victim = dir.join("victim.txt");
        std::fs::write(&victim, "do not touch\n").unwrap();
        std::os::unix::fs::symlink(&victim, log_path(&dir, 0)).unwrap();
        assert!(append_line(&dir, "must not land in the victim", 1024, 3).is_err());
        assert_eq!(std::fs::read_to_string(&victim).unwrap(), "do not touch\n");
        assert!(tail_lines(&dir, 5, 3).is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_tail_reads_only_the_last_window_of_a_file() {
        let dir = scratch("window");
        std::fs::create_dir_all(&dir).unwrap();
        let filler = "x".repeat(1000);
        let body: String = (0..2000).map(|i| format!("{i:06} {filler}\n")).collect();
        std::fs::write(log_path(&dir, 0), body).unwrap();
        let lines = tail_lines(&dir, LOG_MAX_TAIL, 1);
        // 256 KiB of 1 KB lines is about 256 lines, not the 500 asked for, and none is cut.
        assert!(lines.len() > 200 && lines.len() < 300);
        assert!(lines.last().unwrap().starts_with("001999"));
        assert!(lines.iter().all(|l| l.len() == 1007));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_file_with_a_broken_character_is_still_read() {
        let dir = scratch("lossy");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(log_path(&dir, 0), b"good line\nbroken \xff here\n").unwrap();
        let lines = tail_lines(&dir, 5, 2);
        assert_eq!(lines.len(), 2);
        assert!(lines[1].contains("broken"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    // -- issue #259: batches, the hard limit, the raw open, rotation on Windows ----------------

    fn owned(lines: &[&str]) -> Vec<String> {
        lines.iter().map(|line| line.to_string()).collect()
    }

    #[test]
    fn a_batch_is_appended_in_order_each_line_flattened() {
        let dir = scratch("batch");
        append_lines(&dir, &owned(&["first", "second\nhalf", "third"]), 1024, 3).unwrap();
        let text = std::fs::read_to_string(log_path(&dir, 0)).unwrap_or_default();
        assert_eq!(text, "first\nsecond half\nthird\n");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_batch_rotates_between_its_lines() {
        let dir = scratch("batch-rotate");
        let lines: Vec<String> = (0..40).map(|i| format!("message number {i} with padding")).collect();
        append_lines(&dir, &lines, 200, 3).unwrap();
        assert!(log_path(&dir, 1).exists());
        let live = std::fs::read_to_string(log_path(&dir, 0)).unwrap();
        assert!(live.len() <= 200);
        assert!(live.ends_with("message number 39 with padding\n"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_batch_over_the_cap_is_refused_whole() {
        let dir = scratch("batch-cap");
        let lines = vec!["x".to_string(); LOG_MAX_BATCH + 1];
        assert!(append_lines(&dir, &lines, 1 << 20, 3).is_err());
        assert!(!log_path(&dir, 0).exists());
        // The cap itself is allowed.
        assert!(append_lines(&dir, &lines[1..], 1 << 20, 3).is_ok());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_failed_rotation_lets_lines_in_up_to_twice_the_limit_then_refuses() {
        let dir = scratch("stuck");
        // A folder where the oldest file goes: removing it fails, so every rotation fails.
        std::fs::create_dir_all(log_path(&dir, 1).join("held")).unwrap();
        let line = "x".repeat(29); // 30 bytes with its newline
        let written: Vec<bool> = (0..8)
            .map(|_| append_line(&dir, &line, 100, 2).is_ok())
            .collect();
        assert_eq!(written, [true, true, true, true, true, true, false, false]);
        assert_eq!(std::fs::metadata(log_path(&dir, 0)).unwrap().len(), 180);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_rotation_whose_last_rename_fails_drops_no_history_however_often_it_is_tried() {
        let dir = scratch("keep-history");
        std::fs::create_dir_all(&dir).unwrap();
        for (n, text) in [(0, "live"), (1, "one"), (2, "two"), (3, "three")] {
            std::fs::write(log_path(&dir, n), text).unwrap();
        }
        // A viewer holds the live file on Windows: only its rename fails.
        let live = log_path(&dir, 0);
        let held = |from: &std::path::Path, to: &std::path::Path| {
            if from == live {
                Err(std::io::Error::other("held open"))
            } else {
                std::fs::rename(from, to)
            }
        };
        for _ in 0..3 {
            assert!(rotate_logs_with(&dir, 5, &held).is_err());
        }
        let slots = |dir: &std::path::Path| -> Vec<Option<String>> {
            (0..5).map(|n| std::fs::read_to_string(log_path(dir, n)).ok()).collect()
        };
        let text = |t: &str| Some(t.to_string());
        assert_eq!(slots(&dir), [text("live"), None, text("one"), text("two"), text("three")]);
        // Once the viewer lets go, the rotation fills the free slot and still drops nothing.
        rotate_logs(&dir, 5).unwrap();
        assert_eq!(slots(&dir), [None, text("live"), text("one"), text("two"), text("three")]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn the_raw_open_never_follows_a_link() {
        // `open_live_log` looks first; this is the open itself, for a link planted after the look.
        let dir = scratch("nofollow");
        std::fs::create_dir_all(&dir).unwrap();
        let victim = dir.join("victim.txt");
        std::fs::write(&victim, "do not touch\n").unwrap();
        let link = log_path(&dir, 0);
        std::os::unix::fs::symlink(&victim, &link).unwrap();
        assert!(open_append(&link).is_err());
        assert_eq!(std::fs::read_to_string(&victim).unwrap(), "do not touch\n");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(windows)]
    #[test]
    fn on_windows_the_files_rotate_while_a_reader_that_shares_delete_holds_the_live_one() {
        // `File::open` shares read, write and delete: a reader like this one does not stop the
        // rename. One that shares no delete makes it fail; that case is the test above.
        let dir = scratch("held-open");
        append_line(&dir, "before the rotation", 100, 3).unwrap();
        let _reader = std::fs::File::open(log_path(&dir, 0)).unwrap();
        for i in 0..10 {
            append_line(&dir, &format!("message number {i} with padding"), 100, 3).unwrap();
        }
        let rotated = std::fs::read_to_string(log_path(&dir, 1)).unwrap();
        let live = std::fs::read_to_string(log_path(&dir, 0)).unwrap();
        assert!(live.contains("message number 9"));
        assert!(!rotated.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
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
            open_result,
            append_log,
            read_log_tail,
            open_logs_dir,
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
