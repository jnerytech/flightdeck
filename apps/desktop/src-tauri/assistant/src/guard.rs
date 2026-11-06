//! The limits a compromised webview cannot lift, and the one way out to a provider. Every number
//! is a constant with a test: the input and output caps, the model id's shape, two calls in
//! flight, a bucket of calls per window, the hosts a call may reach, the timeouts, no redirect, no
//! retry, no `Origin`. A call runs as a task of its own, so a cancel or a timeout aborts it and a
//! late answer is never delivered.

use crate::keys::{Refusal, Secret};
use std::collections::{HashMap, VecDeque};
use std::future::Future;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// The longest text a call takes, in characters.
pub const MAX_INPUT_CHARS: usize = 100_000;
/// The most output tokens a call asks for.
pub const MAX_OUTPUT_TOKENS: u32 = 4096;
/// The longest model id.
pub const MAX_MODEL_ID: usize = 100;
/// Calls running at once.
pub const MAX_IN_FLIGHT: usize = 2;
/// Calls a window allows.
pub const BUCKET_CALLS: usize = 20;
pub const BUCKET_WINDOW: Duration = Duration::from_secs(5 * 60);
pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
pub const TOTAL_TIMEOUT: Duration = Duration::from_secs(60);
/// A vault value shorter than this is not told apart from ordinary text.
pub const MIN_VAULT_VALUE: usize = 6;
/// The most characters of a provider's error text that reach the app.
pub const MAX_DETAIL_CHARS: usize = 300;
pub const ANTHROPIC_BASE: &str = "https://api.anthropic.com";
pub const OPENROUTER_BASE: &str = "https://openrouter.ai";

/// Refuses a text over `MAX_INPUT_CHARS`.
pub fn check_input(text: &str) -> Result<(), Refusal> {
    if text.chars().count() > MAX_INPUT_CHARS {
        return Err(Refusal::new("assistant_too_long").with("max", MAX_INPUT_CHARS.to_string()));
    }
    Ok(())
}

/// The output tokens a call asks for, at most `MAX_OUTPUT_TOKENS`.
pub fn cap_output_tokens(asked: u32) -> u32 {
    asked.min(MAX_OUTPUT_TOKENS)
}

/// Refuses a model id that is empty, over `MAX_MODEL_ID` or outside `[A-Za-z0-9._:/-]`.
pub fn check_model(id: &str) -> Result<(), Refusal> {
    let shaped = !id.is_empty()
        && id.len() <= MAX_MODEL_ID
        && id.chars().all(|c| c.is_ascii_alphanumeric() || "._:/-".contains(c));
    if shaped {
        Ok(())
    } else {
        Err(Refusal::new("assistant_model_unavailable"))
    }
}

/// The ids of the vault values found in the text; a value shorter than `MIN_VAULT_VALUE` is
/// skipped. Never a value.
pub fn vault_hits(text: &str, values: &[(String, Secret)]) -> Vec<String> {
    values
        .iter()
        .filter(|(_, value)| {
            value.expose().chars().count() >= MIN_VAULT_VALUE && text.contains(value.expose())
        })
        .map(|(id, _)| id.clone())
        .collect()
}

type Clock = Arc<dyn Fn() -> Instant + Send + Sync>;

/// The in-flight limit and the bucket, shared by every call of the app.
pub struct Limits {
    running: Arc<Mutex<usize>>,
    taken: Mutex<VecDeque<Instant>>,
    clock: Clock,
}

/// One admitted call; dropping it frees its in-flight place.
pub struct Permit {
    running: Arc<Mutex<usize>>,
}

impl Drop for Permit {
    fn drop(&mut self) {
        if let Ok(mut running) = self.running.lock() {
            *running = running.saturating_sub(1);
        }
    }
}

impl Default for Limits {
    fn default() -> Self {
        Limits::with_clock(Arc::new(Instant::now))
    }
}

impl Limits {
    pub fn with_clock(clock: Clock) -> Self {
        Limits { running: Arc::new(Mutex::new(0)), taken: Mutex::new(VecDeque::new()), clock }
    }

    /// A place for one more call, or `assistant_rate_limited`.
    pub fn admit(&self) -> Result<Permit, Refusal> {
        let limited = || Refusal::new("assistant_rate_limited");
        let mut running = self.running.lock().map_err(|_| limited())?;
        if *running >= MAX_IN_FLIGHT {
            return Err(limited());
        }
        let mut taken = self.taken.lock().map_err(|_| limited())?;
        let now = (self.clock)();
        while taken.front().is_some_and(|at| now.saturating_duration_since(*at) >= BUCKET_WINDOW) {
            taken.pop_front();
        }
        if taken.len() >= BUCKET_CALLS {
            return Err(limited());
        }
        taken.push_back(now);
        *running += 1;
        Ok(Permit { running: self.running.clone() })
    }
}

/// Where a call goes: one of the two providers, or a loopback server in the tests.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Endpoint(String);

impl Endpoint {
    pub fn anthropic() -> Self {
        Endpoint(ANTHROPIC_BASE.to_string())
    }

    pub fn openrouter() -> Self {
        Endpoint(OPENROUTER_BASE.to_string())
    }

    /// A base URL: exactly one of the two providers', or `http://` on a loopback address.
    pub fn with_base(url: &str) -> Result<Self, Refusal> {
        if url == ANTHROPIC_BASE || url == OPENROUTER_BASE || loopback(url) {
            Ok(Endpoint(url.to_string()))
        } else {
            Err(Refusal::new("assistant_not_configured"))
        }
    }

    pub fn base(&self) -> &str {
        &self.0
    }
}

/// `http://` on 127.0.0.1, localhost or [::1] with a port, and nothing after it.
fn loopback(url: &str) -> bool {
    let Some(authority) = url.strip_prefix("http://") else { return false };
    ["127.0.0.1:", "localhost:", "[::1]:"].iter().any(|host| {
        authority
            .strip_prefix(host)
            .is_some_and(|port| !port.is_empty() && port.chars().all(|c| c.is_ascii_digit()))
    })
}

/// The HTTP client of every call: the timeouts, no redirect, no default headers.
pub fn client() -> Result<reqwest::Client, Refusal> {
    // As the updater does: the ring provider, installed once for the process.
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(TOTAL_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| Refusal::new("assistant_offline"))
}

fn transport(error: reqwest::Error) -> Refusal {
    Refusal::new(if error.is_timeout() { "assistant_timeout" } else { "assistant_offline" })
}

pub enum Method {
    Get,
    Post(serde_json::Value),
}

/// A provider's answer, as it came.
#[derive(Debug)]
pub struct Reply {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: String,
}

impl Reply {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    }
}

/// One request with the key as a bearer token; once, whatever the answer. A connection failure
/// is `assistant_offline`, a timeout `assistant_timeout`; no error text goes on.
pub async fn send(
    client: &reqwest::Client,
    endpoint: &Endpoint,
    path: &str,
    method: Method,
    key: &Secret,
    headers: &[(&'static str, String)],
) -> Result<Reply, Refusal> {
    let url = format!("{}{}", endpoint.0, path);
    let mut request = match method {
        Method::Get => client.get(url),
        Method::Post(body) => client.post(url).json(&body),
    };
    request = request.bearer_auth(key.expose());
    for (name, value) in headers {
        request = request.header(*name, value);
    }
    let response = request.send().await.map_err(transport)?;
    let status = response.status().as_u16();
    let headers = response
        .headers()
        .iter()
        .filter_map(|(name, value)| Some((name.to_string(), value.to_str().ok()?.to_string())))
        .collect();
    let body = response.text().await.map_err(transport)?;
    Ok(Reply { status, headers, body })
}

/// The calls running, by request id.
#[derive(Default)]
pub struct Calls {
    running: Mutex<HashMap<String, tokio::task::AbortHandle>>,
}

impl Calls {
    /// Runs the call as a task: `assistant_timeout` after `limit`, `assistant_cancelled` when
    /// `cancel` stops it; either way the task is aborted and its answer is never delivered.
    pub async fn run<T, F>(&self, request_id: &str, limit: Duration, call: F) -> Result<T, Refusal>
    where
        F: Future<Output = Result<T, Refusal>> + Send + 'static,
        T: Send + 'static,
    {
        let task = tokio::spawn(call);
        let handle = task.abort_handle();
        if let Ok(mut running) = self.running.lock() {
            running.insert(request_id.to_string(), handle.clone());
        }
        let outcome = tokio::time::timeout(limit, task).await;
        if let Ok(mut running) = self.running.lock() {
            running.remove(request_id);
        }
        match outcome {
            Err(_) => {
                handle.abort();
                Err(Refusal::new("assistant_timeout"))
            }
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err(Refusal::new("assistant_cancelled")),
        }
    }

    /// Stops a running call; an id with no call is nothing.
    pub fn cancel(&self, request_id: &str) {
        if let Ok(running) = self.running.lock() {
            if let Some(handle) = running.get(request_id) {
                handle.abort();
            }
        }
    }
}
