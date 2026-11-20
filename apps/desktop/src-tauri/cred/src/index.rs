//! The host name index the app writes for the CLI: `<config dir>/hosts.json`, `{hosts: [{id, name}]}`.

use std::io;
use std::path::Path;

use crate::read::Store;

/// What the app knows of a host, for the index and the address entry.
pub struct HostRef {
    pub id: String,
    pub name: String,
    pub url: String,
}

/// The index text: the ids and names of the hosts whose id is a UUID, nothing else.
pub fn render(hosts: &[HostRef]) -> String {
    let _ = hosts;
    String::new()
}

/// Writes `hosts.json` into `dir` (created 0700), as a file of mode 0600 made whole by a rename.
pub fn write(dir: &Path, hosts: &[HostRef]) -> io::Result<()> {
    let _ = (dir, hosts);
    Ok(())
}

/// Keeps each host's address in the store beside its token (account `<id>:url`).
pub fn write_addresses(store: &dyn Store, hosts: &[HostRef]) -> Result<(), String> {
    let _ = (store, hosts);
    Ok(())
}
