//! The host name index the app writes for the CLI: `<config dir>/hosts.json`, `{hosts: [{id, name}]}`.

use std::fs;
use std::io::{self, Write};
use std::path::Path;

use crate::read::{is_host_id, url_account, Store};

/// What the app knows of a host, for the index and the address entry.
pub struct HostRef {
    pub id: String,
    pub name: String,
    pub url: String,
}

/// The index text: the ids and names of the hosts whose id is a UUID, nothing else.
pub fn render(hosts: &[HostRef]) -> String {
    let listed: Vec<serde_json::Value> = hosts
        .iter()
        .filter(|host| is_host_id(&host.id))
        .map(|host| serde_json::json!({ "id": host.id, "name": host.name }))
        .collect();
    serde_json::json!({ "hosts": listed }).to_string()
}

/// Writes `hosts.json` into `dir` (created 0700), as a file of mode 0600 made whole by a rename.
pub fn write(dir: &Path, hosts: &[HostRef]) -> io::Result<()> {
    let mut folder = fs::DirBuilder::new();
    folder.recursive(true);
    #[cfg(unix)]
    std::os::unix::fs::DirBuilderExt::mode(&mut folder, 0o700);
    folder.create(dir)?;
    // A name of its own, made new: a link left at that name is removed, never written through.
    let temp = dir.join(format!("hosts.json.{}.tmp", std::process::id()));
    let _ = fs::remove_file(&temp);
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    let written = options.open(&temp).and_then(|mut file| {
        file.write_all(render(hosts).as_bytes())?;
        file.sync_all()
    });
    // The rename replaces whatever is at the target, a link included, and a reader sees the old file or the new one.
    let done = written.and_then(|()| fs::rename(&temp, dir.join("hosts.json")));
    if done.is_err() {
        let _ = fs::remove_file(&temp);
    }
    done
}

/// Keeps each host's address in the store beside its token (account `<id>:url`).
pub fn write_addresses(store: &dyn Store, hosts: &[HostRef]) -> Result<(), String> {
    let mut first_error = None;
    for host in hosts.iter().filter(|host| is_host_id(&host.id) && !host.url.is_empty()) {
        // One host that cannot be written does not keep the others from it.
        if let Err(error) = store.write(&url_account(&host.id), &host.url) {
            first_error.get_or_insert(error);
        }
    }
    first_error.map_or(Ok(()), Err)
}

/// Runs `work` while no other call of this process is in the store or in the index folder.
pub fn exclusive<T>(work: impl FnOnce() -> T) -> T {
    work()
}

/// What the app does each time its host list changes: the addresses into the store first, then the
/// index, so a name is never listed without its address. The first error, after trying both.
pub fn sync(dir: &Path, store: &dyn Store, hosts: &[HostRef]) -> Result<(), String> {
    let addresses = write_addresses(store, hosts);
    let index = write(dir, hosts).map_err(|error| error.to_string());
    addresses.and(index)
}
