//! Phase 40 (ADR 40-3): the AI assistant's Rust logic, without Tauri, so it builds and is tested on
//! any host: the provider keys in the OS credential store, the Anthropic and OpenRouter calls, and
//! the guards a compromised webview cannot lift. The app's `#[tauri::command]`s only wrap it.

pub mod keys;
pub mod guard;
pub mod anthropic;
pub mod openrouter;

#[cfg(test)]
mod test_server;

use keys::Secret;
use serde::Serialize;

/// What a call asks for: the prompts the app built (`buildRequest`) and the output cap.
pub struct Call<'a> {
    pub system: &'a str,
    pub user: &'a str,
    pub model: &'a str,
    pub max_tokens: u32,
}

/// The protocol's `AssistantUsage`.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_write_tokens: u64,
}

/// The protocol's `AssistantResult`.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Answer {
    pub text: String,
    pub model: String,
    pub provider: &'static str,
    pub usage: Usage,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cost_usd: Option<f64>,
    pub stop_reason: String,
    pub notices: Vec<String>,
}

/// The protocol's `ModelOption`.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelOption {
    pub id: String,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt_per_m_tok: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completion_per_m_tok: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub supports_effort: Option<bool>,
}

/// What Settings' "Test" shows; never OpenRouter's key label.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit_remaining: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_free_tier: Option<bool>,
}

/// A provider's text with the key, wherever it appears, as `<key>`; so is any word that starts
/// with `sk-` (any case), the shape of both providers' keys, so a prefix, a masked or a
/// case-changed key goes too.
pub fn scrub(text: &str, key: &Secret) -> String {
    let text = if key.expose().is_empty() { text.to_string() } else { text.replace(key.expose(), "<key>") };
    let word = |c: char| c.is_ascii_alphanumeric() || "_-.…*".contains(c);
    let mut out = String::with_capacity(text.len());
    let mut rest = text.as_str();
    let mut previous: Option<char> = None;
    while let Some(c) = rest.chars().next() {
        let starts = rest.get(..3).is_some_and(|head| head.eq_ignore_ascii_case("sk-")) && !previous.is_some_and(word);
        let taken = if starts {
            out.push_str("<key>");
            rest.char_indices().find(|(_, c)| !word(*c)).map_or(rest.len(), |(at, _)| at)
        } else {
            out.push(c);
            c.len_utf8()
        };
        previous = rest[..taken].chars().last();
        rest = &rest[taken..];
    }
    out
}

/// A provider's error text for the app: scrubbed, at most `guard::MAX_DETAIL_CHARS` characters.
pub fn detail(text: &str, key: &Secret) -> String {
    scrub(text, key).chars().take(guard::MAX_DETAIL_CHARS).collect()
}

/// A request id or a `retry-after` value as it may reach the app: 1 to 200 characters of
/// `[A-Za-z0-9._:-]`, or nothing.
pub fn token(value: &str) -> Option<String> {
    let fits = (1..=200).contains(&value.len())
        && value.chars().all(|c| c.is_ascii_alphanumeric() || "._:-".contains(c));
    fits.then(|| value.to_string())
}
