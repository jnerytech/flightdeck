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
pub fn is_backup_name(_name: &str) -> bool {
    false
}

/// An absolute folder that exists. Nothing is created.
fn checked_dir(_dir: &str) -> Result<PathBuf, String> {
    Err("not implemented".to_string())
}

/// Writes `text` as the backup `name` in `dir`; an existing file is never replaced.
pub fn write_backup(_dir: &str, _name: &str, _text: &str) -> Result<(), String> {
    Ok(())
}

/// The backups in `dir`, by name, oldest first; anything else in the folder is not listed.
pub fn list_backups(_dir: &str) -> Result<Vec<String>, String> {
    Ok(vec!["x".to_string()])
}

/// Removes the backup `name` from `dir`: a regular file named like a backup, and nothing else.
pub fn remove_backup(_dir: &str, _name: &str) -> Result<(), String> {
    Ok(())
}

#[allow(dead_code)]
fn unused(_: &Path) {}

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
