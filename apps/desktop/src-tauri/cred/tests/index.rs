//! The host name index and the address entries the app writes for the CLI.

use flightdeck_cred::index::{render, sync, write, write_addresses, HostRef};
use flightdeck_cred::{url_account, Store};
use std::cell::RefCell;
use std::collections::HashMap;
use std::path::PathBuf;

const ID: &str = "0b6a3f6e-5f0e-4a39-9c43-5d1d1c2b7a11";
const OTHER: &str = "5c1d9a0e-1b2c-4d3e-8f40-aabbccddeeff";

fn host(id: &str, name: &str, url: &str) -> HostRef {
    HostRef { id: id.to_string(), name: name.to_string(), url: url.to_string() }
}

/// A folder of its own under the system's temporary one, removed with the value.
struct Scratch(PathBuf);

impl Scratch {
    fn new(tag: &str) -> Scratch {
        let dir = std::env::temp_dir().join(format!("fd-cred-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        Scratch(dir)
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[test]
fn the_index_holds_ids_and_names_and_never_an_address() {
    let text = render(&[host(ID, "Pi — café 🛩", "wss://secret.example/v1/ws")]);
    let parsed: serde_json::Value = serde_json::from_str(&text).unwrap_or(serde_json::Value::Null);
    assert_eq!(parsed, serde_json::json!({ "hosts": [{ "id": ID, "name": "Pi — café 🛩" }] }));
    assert_eq!(text.contains("secret.example"), false);
}

#[test]
fn a_host_whose_id_is_not_a_uuid_is_left_out() {
    let text = render(&[host("../etc", "x", ""), host(ID, "Pi", ""), host(&format!("{ID}:url"), "y", "")]);
    let parsed: serde_json::Value = serde_json::from_str(&text).unwrap_or(serde_json::Value::Null);
    assert_eq!(parsed, serde_json::json!({ "hosts": [{ "id": ID, "name": "Pi" }] }));
}

#[test]
fn no_hosts_is_an_empty_list() {
    assert_eq!(render(&[]).replace(char::is_whitespace, ""), r#"{"hosts":[]}"#);
}

#[test]
fn write_makes_the_folder_and_the_file_and_replaces_the_old_list() {
    let scratch = Scratch::new("write");
    let dir = scratch.0.join("dev.flightdeck.app");
    write(&dir, &[host(ID, "Pi", "")]).unwrap();
    write(&dir, &[host(OTHER, "Desk", "")]).unwrap();
    let text = std::fs::read_to_string(dir.join("hosts.json")).unwrap_or_default();
    let parsed: serde_json::Value = serde_json::from_str(&text).unwrap_or(serde_json::Value::Null);
    assert_eq!(parsed, serde_json::json!({ "hosts": [{ "id": OTHER, "name": "Desk" }] }));
    let left: Vec<String> = std::fs::read_dir(&dir)
        .map(|entries| {
            entries.flatten().map(|entry| entry.file_name().to_string_lossy().to_string()).collect()
        })
        .unwrap_or_default();
    assert_eq!(left, vec!["hosts.json".to_string()]);
}

#[cfg(unix)]
#[test]
fn the_file_is_private_to_the_user_and_so_is_a_folder_made_for_it() {
    use std::os::unix::fs::PermissionsExt;
    let scratch = Scratch::new("mode");
    let dir = scratch.0.join("made");
    write(&dir, &[host(ID, "Pi", "")]).unwrap();
    let mode = |path: std::path::PathBuf| {
        std::fs::metadata(path).map(|info| info.permissions().mode() & 0o777).unwrap_or(0)
    };
    let (file, folder) = (mode(dir.join("hosts.json")), mode(dir.clone()));
    assert_eq!((file, folder), (0o600, 0o700));
}

#[cfg(unix)]
#[test]
fn a_link_in_the_place_of_the_file_is_replaced_not_followed() {
    let scratch = Scratch::new("link");
    let dir = scratch.0.join("d");
    std::fs::create_dir_all(&dir).unwrap();
    let target = scratch.0.join("elsewhere.txt");
    std::fs::write(&target, "keep").unwrap();
    std::os::unix::fs::symlink(&target, dir.join("hosts.json")).unwrap();
    write(&dir, &[host(ID, "Pi", "")]).unwrap();
    assert_eq!(std::fs::read_to_string(&target).unwrap(), "keep");
    assert!(std::fs::read_to_string(dir.join("hosts.json")).unwrap_or_default().contains("Pi"));
}

#[derive(Default)]
struct Fake(RefCell<HashMap<String, String>>);

impl Store for Fake {
    fn read(&self, account: &str) -> Result<Option<String>, String> {
        Ok(self.0.borrow().get(account).cloned())
    }
    fn write(&self, account: &str, value: &str) -> Result<(), String> {
        self.0.borrow_mut().insert(account.to_string(), value.to_string());
        Ok(())
    }
}

#[test]
fn each_host_gets_its_address_in_the_store_and_a_bad_id_gets_none() {
    let store = Fake::default();
    write_addresses(
        &store,
        &[host(ID, "Pi", "wss://pi/v1/ws"), host("../x", "Bad", "wss://bad/v1/ws"), host(OTHER, "Desk", "ws://10.0.0.2:7878/v1/ws")],
    )
    .unwrap();
    let mut kept: Vec<(String, String)> = store.0.borrow().clone().into_iter().collect();
    kept.sort();
    let mut want = vec![
        (url_account(ID), "wss://pi/v1/ws".to_string()),
        (url_account(OTHER), "ws://10.0.0.2:7878/v1/ws".to_string()),
    ];
    want.sort();
    assert_eq!(kept, want);
}

#[test]
fn sync_writes_the_addresses_and_the_index_together() {
    let scratch = Scratch::new("sync");
    let store = Fake::default();
    sync(&scratch.0, &store, &[host(ID, "Pi", "wss://pi/v1/ws")]).unwrap();
    let text = std::fs::read_to_string(scratch.0.join("hosts.json")).unwrap_or_default();
    let listed: serde_json::Value = serde_json::from_str(&text).unwrap_or(serde_json::Value::Null);
    let address = store.0.borrow().get(&url_account(ID)).cloned();
    assert_eq!(
        (listed, address),
        (serde_json::json!({ "hosts": [{ "id": ID, "name": "Pi" }] }), Some("wss://pi/v1/ws".to_string()))
    );
}

struct Refusing;

impl Store for Refusing {
    fn read(&self, _account: &str) -> Result<Option<String>, String> {
        Ok(None)
    }
    fn write(&self, _account: &str, _value: &str) -> Result<(), String> {
        Err("the store is locked".to_string())
    }
}

#[test]
fn sync_still_writes_the_index_when_the_store_refuses_and_says_so() {
    let scratch = Scratch::new("sync-locked");
    let result = sync(&scratch.0, &Refusing, &[host(ID, "Pi", "wss://pi/v1/ws")]);
    let text = std::fs::read_to_string(scratch.0.join("hosts.json")).unwrap_or_default();
    assert_eq!((result, text.contains("Pi")), (Err("the store is locked".to_string()), true));
}
