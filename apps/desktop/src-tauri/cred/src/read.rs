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
        match entry(account)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(error.to_string()),
        }
    }

    fn write(&self, account: &str, value: &str) -> Result<(), String> {
        entry(account)?.set_password(value).map_err(|error| error.to_string())
    }
}

fn entry(account: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, account).map_err(|error| error.to_string())
}

/// The app's host ids are `crypto.randomUUID()`: lower-case, 8-4-4-4-12.
pub fn is_host_id(id: &str) -> bool {
    id.len() == 36
        && id.bytes().enumerate().all(|(at, byte)| match at {
            8 | 13 | 18 | 23 => byte == b'-',
            _ => byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte),
        })
}

/// The account that holds a host's address: the id and `:url`.
pub fn url_account(id: &str) -> String {
    format!("{id}:url")
}

/// Answers `get -- <id>` or `url -- <id>`; any other command line, a store that fails, an account
/// nobody wrote, or a terminal on stdout gives exit 1 and no output.
pub fn run(args: &[String], store: &dyn Store, stdout_is_terminal: bool) -> Outcome {
    let refused = Outcome { code: 1, stdout: String::new() };
    // The check only guards against an accidental echo: any process can pipe the output.
    if stdout_is_terminal {
        return refused;
    }
    let [word, dashes, id] = args else { return refused };
    // The id is one argument after `--`, and only a UUID: `<id>:url` or a path reads no other account.
    if dashes != "--" || !is_host_id(id) {
        return refused;
    }
    let account = match word.as_str() {
        "get" => id.clone(),
        "url" => url_account(id),
        _ => return refused,
    };
    match store.read(&account) {
        // One plain line: a value with a line break or a control character is not what the app wrote.
        Ok(Some(value)) if !value.is_empty() && !value.chars().any(char::is_control) => {
            Outcome { code: 0, stdout: format!("{value}\n") }
        }
        _ => refused,
    }
}
