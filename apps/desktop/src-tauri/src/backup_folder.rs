//! A folder of backups (issue #1264): the app writes a scheduled backup into a folder the person
//! picked, lists the backups there and removes the old ones. The folder path comes from the
//! webview, so what these functions may touch is narrow: only a regular file whose name is exactly
//! `flightdeck-backup-YYYYMMDD-HHMMSS.fdbackup`, in a folder that already exists. Plain `std`, so the
//! checks run without the Tauri runtime.

use std::path::{Path, PathBuf};

const PREFIX: &str = "flightdeck-backup-";
const SUFFIX: &str = ".fdbackup";
/// A backup is a few KiB to a few MiB (the app refuses one over 1 MiB); a bigger text is not one.
pub const MAX_BACKUP_BYTES: usize = 8 * 1024 * 1024;

/// Whether `name` is exactly a backup's file name: no folder part, no other text.
pub fn is_backup_name(name: &str) -> bool {
    let Some(stamp) = name
        .strip_prefix(PREFIX)
        .and_then(|rest| rest.strip_suffix(SUFFIX))
    else {
        return false;
    };
    // YYYYMMDD-HHMMSS, ASCII digits only: a separator or a dot cannot hide in it.
    let bytes = stamp.as_bytes();
    bytes.len() == 15
        && bytes
            .iter()
            .enumerate()
            .all(|(i, b)| if i == 8 { *b == b'-' } else { b.is_ascii_digit() })
}

/// An absolute folder that exists. Nothing is created.
fn checked_dir(dir: &str) -> Result<PathBuf, String> {
    let path = Path::new(dir);
    if !path.is_absolute() {
        return Err("the backup folder must be an absolute path".to_string());
    }
    if path.components().any(|part| matches!(part, std::path::Component::ParentDir)) {
        return Err("the backup folder cannot contain ..".to_string());
    }
    if !std::fs::metadata(path).map(|m| m.is_dir()).unwrap_or(false) {
        return Err("the backup folder does not exist".to_string());
    }
    Ok(path.to_path_buf())
}

fn checked_name(name: &str) -> Result<(), String> {
    if is_backup_name(name) {
        Ok(())
    } else {
        Err("that is not the name of a backup".to_string())
    }
}

/// Writes `text` as the backup `name` in `dir`; an existing file is never replaced. The text goes
/// to a temporary file first and is renamed, so a crash leaves no half-written backup.
pub fn write_backup(dir: &str, name: &str, text: &str) -> Result<(), String> {
    use std::io::Write;
    checked_name(name)?;
    if text.len() > MAX_BACKUP_BYTES {
        return Err("the backup is too big".to_string());
    }
    let dir = checked_dir(dir)?;
    let target = dir.join(name);
    // symlink_metadata does not follow a link: a link named like a backup counts as taken.
    if std::fs::symlink_metadata(&target).is_ok() {
        return Err("a backup with that name already exists".to_string());
    }
    let part = dir.join(format!("{name}.part"));
    let written = (|| {
        // create_new fails on anything already there, a link included.
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&part)?; // NOSONAR: runs on the blocking pool, on a name this module built
        file.write_all(text.as_bytes())?;
        file.sync_all()?;
        std::fs::rename(&part, &target)
    })();
    if let Err(error) = written {
        let _ = std::fs::remove_file(&part);
        return Err(error.to_string());
    }
    Ok(())
}

/// The backups in `dir`, by name, oldest first; anything else in the folder is not listed.
pub fn list_backups(dir: &str) -> Result<Vec<String>, String> {
    let dir = checked_dir(dir)?;
    let mut names = Vec::new();
    for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let Some(name) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        // DirEntry::file_type does not follow a link, so a link or a folder is skipped.
        let is_file = entry.file_type().map(|t| t.is_file()).unwrap_or(false);
        if is_file && is_backup_name(&name) {
            names.push(name);
        }
    }
    names.sort();
    Ok(names)
}

/// Removes the backup `name` from `dir`: a regular file named like a backup, and nothing else.
pub fn remove_backup(dir: &str, name: &str) -> Result<(), String> {
    checked_name(name)?;
    let target = checked_dir(dir)?.join(name);
    let is_file = std::fs::symlink_metadata(&target)
        .map(|m| m.file_type().is_file())
        .unwrap_or(false);
    if !is_file {
        return Err("only a backup file can be removed".to_string());
    }
    std::fs::remove_file(&target).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const A: &str = "flightdeck-backup-20261108-120000.fdbackup";
    const B: &str = "flightdeck-backup-20261109-120000.fdbackup";

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("fd-backups-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn s(path: &Path) -> &str {
        path.to_str().unwrap()
    }

    #[test]
    fn only_the_exact_backup_name_passes() {
        assert!(is_backup_name(A));
        for bad in [
            "",
            "notes.txt",
            "flightdeck-backup-20261108-120000.fdbackup.part",
            "flightdeck-backup-2026110-120000.fdbackup",
            "flightdeck-backup-20261108-12000a.fdbackup",
            "../flightdeck-backup-20261108-120000.fdbackup",
            "sub/flightdeck-backup-20261108-120000.fdbackup",
            "sub\\flightdeck-backup-20261108-120000.fdbackup",
            "xflightdeck-backup-20261108-120000.fdbackup",
        ] {
            assert!(!is_backup_name(bad), "{bad} must not pass");
        }
    }

    #[test]
    fn a_backup_is_written_once_and_never_replaced() {
        let dir = scratch("write");
        write_backup(s(&dir), A, "first").unwrap();
        assert_eq!(std::fs::read_to_string(dir.join(A)).unwrap(), "first");
        assert!(write_backup(s(&dir), A, "second").is_err());
        assert_eq!(std::fs::read_to_string(dir.join(A)).unwrap(), "first");
        let leftovers: Vec<_> = std::fs::read_dir(&dir).unwrap().collect();
        assert_eq!(leftovers.len(), 1, "no temporary file stays behind");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_write_with_another_name_a_missing_folder_or_a_relative_one_is_refused() {
        let dir = scratch("refuse");
        assert!(write_backup(s(&dir), "notes.txt", "x").is_err());
        assert!(write_backup(s(&dir), "../flightdeck-backup-20261108-120000.fdbackup", "x").is_err());
        let missing = dir.join("not-there");
        assert!(write_backup(s(&missing), A, "x").is_err());
        assert!(!missing.exists(), "a folder is never created");
        assert!(write_backup("relative/dir", A, "x").is_err());
        assert!(write_backup("", A, "x").is_err());
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 0);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_text_over_the_cap_is_refused() {
        let dir = scratch("cap");
        let big = "x".repeat(MAX_BACKUP_BYTES + 1);
        assert!(write_backup(s(&dir), A, &big).is_err());
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 0);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_list_has_only_backups_oldest_first() {
        let dir = scratch("list");
        write_backup(s(&dir), B, "b").unwrap();
        write_backup(s(&dir), A, "a").unwrap();
        std::fs::write(dir.join("notes.txt"), "keep me").unwrap();
        std::fs::create_dir(dir.join("flightdeck-backup-20261110-120000.fdbackup")).unwrap();
        assert_eq!(list_backups(s(&dir)).unwrap(), vec![A.to_string(), B.to_string()]);
        assert!(list_backups(s(&dir.join("not-there"))).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_removal_takes_a_backup_and_nothing_else() {
        let dir = scratch("remove");
        write_backup(s(&dir), A, "a").unwrap();
        std::fs::write(dir.join("notes.txt"), "keep me").unwrap();
        std::fs::create_dir(dir.join(B)).unwrap();
        assert!(remove_backup(s(&dir), "notes.txt").is_err());
        assert!(remove_backup(s(&dir), B).is_err(), "a folder named like a backup stays");
        remove_backup(s(&dir), A).unwrap();
        assert!(!dir.join(A).exists());
        assert!(dir.join("notes.txt").exists());
        assert!(dir.join(B).is_dir());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn a_link_named_like_a_backup_is_neither_listed_nor_followed_nor_removed() {
        let dir = scratch("link");
        let target = dir.join("precious.txt");
        std::fs::write(&target, "precious").unwrap();
        std::os::unix::fs::symlink(&target, dir.join(A)).unwrap();
        assert_eq!(list_backups(s(&dir)).unwrap(), Vec::<String>::new());
        assert!(remove_backup(s(&dir), A).is_err());
        assert!(write_backup(s(&dir), A, "overwrite through the link").is_err());
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "precious");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
