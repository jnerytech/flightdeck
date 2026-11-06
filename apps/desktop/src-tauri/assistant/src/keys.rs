//! The provider keys, in the OS credential store (service `flightdeck-assistant`, one entry per
//! provider). A key goes in through `set_key` and never comes back out to the app: the commands
//! answer its last four characters at most. A key travels as a `Secret`, which prints as
//! `<redacted>`, and no refusal or store error carries it.

use serde::Serialize;
use std::collections::{BTreeMap, HashMap};
use std::fmt;
use std::sync::Mutex;

/// The credential store's service name for the assistant's keys.
pub const SERVICE: &str = "flightdeck-assistant";
/// The longest key accepted, in characters.
pub const KEY_MAX_CHARS: usize = 512;
/// The shortest key accepted: no provider's key is this short, and `last4` of a shorter one
/// would show too much of it.
pub const KEY_MIN_CHARS: usize = 20;
/// The Windows credential store keeps at most 2560 bytes per entry, and `keyring` writes UTF-16.
pub const STORE_MAX_UTF16: usize = 1280;

/// A provider the app calls itself.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Provider {
    Anthropic,
    OpenRouter,
}

impl Provider {
    /// The provider by its protocol name; anything else is refused.
    pub fn parse(name: &str) -> Result<Self, Refusal> {
        match name {
            "anthropic" => Ok(Provider::Anthropic),
            "openrouter" => Ok(Provider::OpenRouter),
            _ => Err(invalid("provider")),
        }
    }

    /// The store entry's account name.
    pub fn account(self) -> &'static str {
        match self {
            Provider::Anthropic => "anthropic",
            Provider::OpenRouter => "openrouter",
        }
    }
}

/// A key in memory. It prints as `<redacted>`; only `expose` gives the text, for the request.
pub struct Secret(String);

impl Secret {
    /// A value read from a store (a vault value, for `vault_hits`); a key goes through `check_key`.
    pub fn new(value: String) -> Self {
        Secret(value)
    }

    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("<redacted>")
    }
}

impl fmt::Display for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("<redacted>")
    }
}

/// What a command rejects with: a reason of the protocol's `ASSISTANT_REASONS` and its params.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Refusal {
    pub reason: &'static str,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub params: BTreeMap<&'static str, String>,
}

impl Refusal {
    pub fn new(reason: &'static str) -> Self {
        Refusal { reason, params: BTreeMap::new() }
    }

    pub fn with(mut self, name: &'static str, value: impl Into<String>) -> Self {
        self.params.insert(name, value.into());
        self
    }
}

fn invalid(why: &str) -> Refusal {
    Refusal::new("assistant_key_invalid").with("why", why)
}

fn store_failed(_: StoreError) -> Refusal {
    Refusal::new("assistant_key_store")
}

/// The store failed; it carries nothing, so nothing the store says can reach the app or a log.
#[derive(Debug, PartialEq, Eq)]
pub struct StoreError;

/// Where keys are kept: the OS credential store in the app, a map in the tests.
pub trait SecretStore: Send + Sync {
    fn get(&self, account: &str) -> Result<Option<Secret>, StoreError>;
    fn set(&self, account: &str, secret: &Secret) -> Result<(), StoreError>;
    fn delete(&self, account: &str) -> Result<(), StoreError>;
}

/// The tests' store; `failing` makes every call fail, as a locked keychain does.
#[derive(Default)]
pub struct MemoryStore {
    entries: Mutex<HashMap<String, String>>,
    pub failing: bool,
}

impl MemoryStore {
    fn entries(&self) -> Result<std::sync::MutexGuard<'_, HashMap<String, String>>, StoreError> {
        if self.failing {
            return Err(StoreError);
        }
        self.entries.lock().map_err(|_| StoreError)
    }
}

impl SecretStore for MemoryStore {
    fn get(&self, account: &str) -> Result<Option<Secret>, StoreError> {
        Ok(self.entries()?.get(account).map(|key| Secret(key.clone())))
    }

    fn set(&self, account: &str, secret: &Secret) -> Result<(), StoreError> {
        self.entries()?.insert(account.to_string(), secret.0.clone());
        Ok(())
    }

    fn delete(&self, account: &str) -> Result<(), StoreError> {
        self.entries()?.remove(account);
        Ok(())
    }
}

/// The OS credential store: Windows Credential Manager, macOS Keychain, and on Linux the kernel
/// keyutils store, which a reboot empties (the documented limit of `linux-native`).
pub struct KeyringStore;

fn entry(account: &str) -> Result<keyring::Entry, StoreError> {
    keyring::Entry::new(SERVICE, account).map_err(|_| StoreError)
}

impl SecretStore for KeyringStore {
    fn get(&self, account: &str) -> Result<Option<Secret>, StoreError> {
        match entry(account)?.get_password() {
            Ok(key) => Ok(Some(Secret(key))),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err(StoreError),
        }
    }

    fn set(&self, account: &str, secret: &Secret) -> Result<(), StoreError> {
        entry(account)?.set_password(&secret.0).map_err(|_| StoreError)
    }

    fn delete(&self, account: &str) -> Result<(), StoreError> {
        match entry(account)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(StoreError),
        }
    }
}

#[derive(Debug, PartialEq, Eq, Serialize)]
pub struct Saved {
    pub last4: String,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
pub struct KeyStatus {
    pub saved: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last4: Option<String>,
}

/// Whether a key fits one Windows credential entry.
pub fn fits_store(key: &str) -> bool {
    key.encode_utf16().count() <= STORE_MAX_UTF16
}

/// The key as stored: trimmed, then refused when empty, with a control character or inner
/// whitespace, or out of the length limits.
pub fn check_key(raw: &str) -> Result<Secret, Refusal> {
    let key = raw.trim();
    let chars = key.chars().count();
    if key.is_empty() {
        Err(invalid("empty"))
    } else if key.chars().any(char::is_control) {
        Err(invalid("control"))
    } else if key.chars().any(char::is_whitespace) {
        Err(invalid("whitespace"))
    } else if !(KEY_MIN_CHARS..=KEY_MAX_CHARS).contains(&chars) || !fits_store(key) {
        Err(invalid("length"))
    } else {
        Ok(Secret(key.to_string()))
    }
}

/// The key's last four characters, what Settings shows of a saved key.
pub fn last4(secret: &Secret) -> String {
    let chars: Vec<char> = secret.0.chars().collect();
    chars[chars.len().saturating_sub(4)..].iter().collect()
}

pub fn set_key(store: &dyn SecretStore, provider: &str, key: &str) -> Result<Saved, Refusal> {
    let provider = Provider::parse(provider)?;
    let secret = check_key(key)?;
    store.set(provider.account(), &secret).map_err(store_failed)?;
    Ok(Saved { last4: last4(&secret) })
}

pub fn key_status(store: &dyn SecretStore, provider: &str) -> Result<KeyStatus, Refusal> {
    let provider = Provider::parse(provider)?;
    let saved = store.get(provider.account()).map_err(store_failed)?;
    Ok(KeyStatus { saved: saved.is_some(), last4: saved.as_ref().map(last4) })
}

/// Deletes the provider's key; a key that is not there is fine.
pub fn delete_key(store: &dyn SecretStore, provider: &str) -> Result<(), Refusal> {
    let provider = Provider::parse(provider)?;
    store.delete(provider.account()).map_err(store_failed)
}

/// The provider's key, for a call; `assistant_not_configured` when there is none.
pub fn read_key(store: &dyn SecretStore, provider: Provider) -> Result<Secret, Refusal> {
    store
        .get(provider.account())
        .map_err(store_failed)?
        .ok_or_else(|| Refusal::new("assistant_not_configured"))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A recognisable fake key: no output on any path may contain it.
    const FAKE: &str = "sk-ant-FAKEKEY-0123456789abcdefWXYZ";
    const MARK: &str = "FAKEKEY";

    fn invalid(why: &str) -> Refusal {
        Refusal::new("assistant_key_invalid").with("why", why)
    }

    fn failing() -> MemoryStore {
        MemoryStore { failing: true, ..MemoryStore::default() }
    }

    #[test]
    fn only_the_two_providers_are_accepted_each_with_its_own_entry() {
        assert_eq!(SERVICE, "flightdeck-assistant");
        assert_eq!(Provider::parse("anthropic"), Ok(Provider::Anthropic));
        assert_eq!(Provider::parse("openrouter"), Ok(Provider::OpenRouter));
        for other in ["openai", "Anthropic", "", "host", "anthropic "] {
            assert_eq!(Provider::parse(other), Err(invalid("provider")), "{other:?}");
        }
        assert_eq!(Provider::Anthropic.account(), "anthropic");
        assert_eq!(Provider::OpenRouter.account(), "openrouter");
    }

    #[test]
    fn a_key_is_set_read_as_its_last_four_and_deleted() {
        let store = MemoryStore::default();
        assert_eq!(set_key(&store, "anthropic", FAKE), Ok(Saved { last4: "WXYZ".into() }));
        assert_eq!(
            key_status(&store, "anthropic"),
            Ok(KeyStatus { saved: true, last4: Some("WXYZ".into()) })
        );
        assert_eq!(key_status(&store, "openrouter"), Ok(KeyStatus { saved: false, last4: None }));
        assert_eq!(read_key(&store, Provider::Anthropic).map(|s| s.expose().to_string()), Ok(FAKE.into()));
        assert_eq!(
            read_key(&store, Provider::OpenRouter).map(|s| s.expose().to_string()),
            Err(Refusal::new("assistant_not_configured"))
        );
        assert_eq!(delete_key(&store, "anthropic"), Ok(()));
        assert_eq!(key_status(&store, "anthropic"), Ok(KeyStatus { saved: false, last4: None }));
        assert_eq!(delete_key(&store, "anthropic"), Ok(()), "absent is fine");
        assert_eq!(set_key(&store, "openai", FAKE), Err(invalid("provider")));
        assert_eq!(key_status(&store, "openai"), Err(invalid("provider")));
        assert_eq!(delete_key(&store, "openai"), Err(invalid("provider")));
    }

    #[test]
    fn the_key_is_trimmed_and_its_last_four_are_characters() {
        let store = MemoryStore::default();
        let key = "  sk-or-v1-0123456789abcdefção9  ";
        assert_eq!(set_key(&store, "openrouter", key), Ok(Saved { last4: "ção9".into() }));
        assert_eq!(
            read_key(&store, Provider::OpenRouter).map(|s| s.expose().to_string()),
            Ok(key.trim().to_string())
        );
    }

    #[test]
    fn an_empty_key_one_with_a_control_character_inner_whitespace_or_a_bad_length_is_refused() {
        let long = "k".repeat(KEY_MAX_CHARS + 1);
        let short = "k".repeat(KEY_MIN_CHARS - 1);
        let cases: [(&str, &str); 7] = [
            ("   ", "empty"),
            ("sk-ant-0123456789abcdef\u{7}x", "control"),
            ("sk-ant-0123456789\tabcdefgh", "control"),
            ("sk-ant-0123456789 abcdefgh", "whitespace"),
            ("sk-ant-0123456789\u{a0}abcdefgh", "whitespace"),
            (long.as_str(), "length"),
            (short.as_str(), "length"),
        ];
        for (key, why) in cases {
            assert_eq!(check_key(key).map(|s| s.expose().to_string()), Err(invalid(why)), "{key:?}");
        }
        let longest = "k".repeat(KEY_MAX_CHARS);
        assert_eq!(check_key(&longest).map(|s| s.expose().len()), Ok(KEY_MAX_CHARS));
        let store = MemoryStore::default();
        assert_eq!(set_key(&store, "anthropic", "   "), Err(invalid("empty")));
        assert_eq!(key_status(&store, "anthropic"), Ok(KeyStatus { saved: false, last4: None }));
    }

    #[test]
    fn the_windows_size_rule_holds_for_every_accepted_key() {
        assert_eq!(STORE_MAX_UTF16, 1280);
        assert!(fits_store(&"a".repeat(STORE_MAX_UTF16)));
        assert!(!fits_store(&"a".repeat(STORE_MAX_UTF16 + 1)));
        // The longest key of characters outside the BMP (two UTF-16 units each) still fits.
        let wide = "𝒦".repeat(KEY_MAX_CHARS);
        assert!(fits_store(&wide));
        assert!(check_key(&wide).is_ok());
    }

    #[test]
    fn a_secret_prints_as_redacted() {
        let secret = check_key(FAKE).map_err(|r| r.reason);
        assert_eq!(secret.as_ref().map(|s| format!("{s:?}")), Ok("<redacted>".to_string()));
        assert_eq!(secret.as_ref().map(|s| format!("{s}")), Ok("<redacted>".to_string()));
        assert_eq!(secret.as_ref().map(|s| format!("{:?}", Some(s))), Ok("Some(<redacted>)".to_string()));
    }

    #[test]
    fn a_failing_store_is_one_reason_with_nothing_of_the_store_or_the_key() {
        let store = failing();
        let refused = Refusal::new("assistant_key_store");
        assert_eq!(set_key(&store, "anthropic", FAKE), Err(refused.clone()));
        assert_eq!(key_status(&store, "anthropic"), Err(refused.clone()));
        assert_eq!(delete_key(&store, "anthropic"), Err(refused.clone()));
        assert_eq!(read_key(&store, Provider::Anthropic).map(|_| ()), Err(refused));
    }

    #[test]
    fn no_output_or_error_on_any_path_contains_the_key() {
        let store = MemoryStore::default();
        let broken = failing();
        let mut outputs: Vec<String> = Vec::new();
        let mut keep = |text: String| outputs.push(text);
        let saved = set_key(&store, "anthropic", FAKE);
        keep(format!("{saved:?}"));
        keep(serde_json::to_string(&saved.as_ref().map_err(|r| r.clone()).ok()).unwrap_or_default());
        let status = key_status(&store, "anthropic");
        keep(format!("{status:?}"));
        keep(serde_json::to_string(&status.as_ref().ok()).unwrap_or_default());
        keep(format!("{:?}", read_key(&store, Provider::Anthropic)));
        let bad = [
            format!("{FAKE} tail"),
            format!("{FAKE}\u{7}"),
            format!("{FAKE}{}", "x".repeat(KEY_MAX_CHARS)),
        ];
        for key in &bad {
            let refused = set_key(&store, "anthropic", key);
            keep(format!("{refused:?}"));
            keep(serde_json::to_string(&refused.err()).unwrap_or_default());
            keep(format!("{:?}", check_key(key)));
        }
        keep(format!("{:?}", set_key(&store, "openai", FAKE)));
        for result in [
            set_key(&broken, "anthropic", FAKE).map(|_| ()),
            key_status(&broken, "anthropic").map(|_| ()),
            delete_key(&broken, "anthropic"),
            read_key(&broken, Provider::Anthropic).map(|_| ()),
        ] {
            keep(format!("{result:?}"));
            keep(serde_json::to_string(&result.err()).unwrap_or_default());
        }
        assert_eq!(outputs.len(), 23);
        let leaks: Vec<&String> = outputs.iter().filter(|o| o.contains(MARK)).collect();
        assert!(leaks.is_empty(), "{leaks:?}");
    }
}
