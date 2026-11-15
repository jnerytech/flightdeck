//! The app's own log file: the frontend appends its lines here and reads the tail back (#255).
//! The files rotate, only the owner can read them, and a link where a log should be is never
//! followed.

use tauri::Manager;

use crate::spawn_blocking_result;

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
pub async fn append_log(app: tauri::AppHandle, lines: Vec<String>) -> Result<(), String> {
    let dir = app_logs(&app)?;
    spawn_blocking_result(move || {
        append_lines(&dir, &lines, LOG_MAX_BYTES, LOG_FILES).map_err(|e| e.to_string())
    })
    .await
}

/// The last lines of the app's log, for "Copy diagnostics".
#[tauri::command]
pub async fn read_log_tail(app: tauri::AppHandle, lines: usize) -> Result<Vec<String>, String> {
    let dir = app_logs(&app)?;
    spawn_blocking_result(move || Ok(tail_lines(&dir, lines, LOG_FILES))).await
}

/// Opens the app's log folder in the system's file manager.
#[tauri::command]
pub async fn open_logs_dir(app: tauri::AppHandle) -> Result<(), String> {
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
