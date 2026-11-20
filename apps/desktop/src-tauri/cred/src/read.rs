//! The helper's one job: print one host's token (`get -- <id>`) or address (`url -- <id>`).

/// The credential store's service name: the app's identifier, as `lib.rs` writes it.
pub const SERVICE: &str = "dev.flightdeck.app";

/// What the helper prints and exits with.
#[derive(Debug, PartialEq, Eq)]
pub struct Outcome {
    pub code: i32,
    pub stdout: String,
}

/// One account of the credential store. `Ok(None)` is an account nobody wrote.
pub trait Store {
    fn read(&self, account: &str) -> Result<Option<String>, String>;
    fn write(&self, account: &str, value: &str) -> Result<(), String>;
}

/// The OS credential store, through the `keyring` crate the app uses.
pub struct KeyringStore;

impl Store for KeyringStore {
    fn read(&self, account: &str) -> Result<Option<String>, String> {
        let _ = account;
        Ok(None)
    }

    fn write(&self, account: &str, value: &str) -> Result<(), String> {
        let _ = (account, value);
        Ok(())
    }
}

/// The app's host ids are `crypto.randomUUID()`: lower-case, 8-4-4-4-12.
pub fn is_host_id(id: &str) -> bool {
    let _ = id;
    false
}

/// The account that holds a host's address: the id and `:url`.
pub fn url_account(id: &str) -> String {
    let _ = id;
    String::new()
}

/// Answers `get -- <id>` or `url -- <id>`; any other command line, a store that fails, an account
/// nobody wrote, or a terminal on stdout gives exit 1 and no output.
pub fn run(args: &[String], store: &dyn Store, stdout_is_terminal: bool) -> Outcome {
    let _ = (args, store, stdout_is_terminal);
    Outcome { code: 0, stdout: String::new() }
}
