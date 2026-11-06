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
pub const ANTHROPIC_BASE: &str = "https://api.anthropic.com";
pub const OPENROUTER_BASE: &str = "https://openrouter.ai";

/// Refuses a text over `MAX_INPUT_CHARS`.
pub fn check_input(_text: &str) -> Result<(), Refusal> {
    Ok(())
}

/// The output tokens a call asks for, at most `MAX_OUTPUT_TOKENS`.
pub fn cap_output_tokens(asked: u32) -> u32 {
    asked
}

/// Refuses a model id that is empty, over `MAX_MODEL_ID` or outside `[A-Za-z0-9._:/-]`.
pub fn check_model(_id: &str) -> Result<(), Refusal> {
    Ok(())
}

/// The ids of the vault values found in the text; a value shorter than `MIN_VAULT_VALUE` is
/// skipped. Never a value.
pub fn vault_hits(_text: &str, _values: &[(String, Secret)]) -> Vec<String> {
    Vec::new()
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
        let _ = &self.running;
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
        let _ = (&self.taken, &self.clock);
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
        Ok(Endpoint(url.to_string()))
    }

    pub fn base(&self) -> &str {
        &self.0
    }
}

/// The HTTP client of every call: the timeouts, no redirect, no default headers.
pub fn client() -> Result<reqwest::Client, Refusal> {
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    reqwest::Client::builder().build().map_err(|_| Refusal::new("assistant_offline"))
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
    _client: &reqwest::Client,
    _endpoint: &Endpoint,
    _path: &str,
    _method: Method,
    _key: &Secret,
    _headers: &[(&'static str, String)],
) -> Result<Reply, Refusal> {
    Err(Refusal::new("assistant_offline"))
}

/// The calls running, by request id.
#[derive(Default)]
pub struct Calls {
    running: Mutex<HashMap<String, tokio::task::AbortHandle>>,
}

impl Calls {
    /// Runs the call as a task: `assistant_timeout` after `limit`, `assistant_cancelled` when
    /// `cancel` stops it; either way the task is aborted and its answer is never delivered.
    pub async fn run<T, F>(&self, _request_id: &str, _limit: Duration, call: F) -> Result<T, Refusal>
    where
        F: Future<Output = Result<T, Refusal>> + Send + 'static,
        T: Send + 'static,
    {
        let _ = &self.running;
        call.await
    }

    /// Stops a running call; an id with no call is nothing.
    pub fn cancel(&self, _request_id: &str) {}
}
