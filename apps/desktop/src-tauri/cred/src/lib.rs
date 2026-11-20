//! What `flightdeckd --host` reads, and what the app writes for it (issue #3429,
//! `docs/decisions/2026-11-20-cli-host-credentials.md`): one host's token or address from the OS
//! credential store, and the index of host names. No Tauri here, so it builds and tests alone.

pub mod index;
pub mod read;

pub use read::{is_host_id, run, url_account, KeyringStore, Outcome, Store, SERVICE};
