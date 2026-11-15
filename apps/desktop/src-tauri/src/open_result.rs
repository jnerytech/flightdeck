//! What the app opens or shows for a task's result: the checks that keep a result a plain
//! document, and the command the webview asks (#1589). The webview cannot ask the opener plugin
//! for a path itself.

use crate::spawn_blocking_result;

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
pub async fn open_result(app: tauri::AppHandle, path: String, reveal: bool) -> Result<(), String> {
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
