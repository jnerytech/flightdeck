//! The guards, through the crate's public items, against a loopback server: what a compromised
//! webview cannot lift, and how a call reaches (and does not reach) a provider.

use flightdeck_assistant::guard::*;
use flightdeck_assistant::keys::{Refusal, Secret};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

const FAKE_KEY: &str = "sk-ant-FAKEKEY-guard-0123456789";

fn runtime() -> tokio::runtime::Runtime {
    match tokio::runtime::Builder::new_current_thread().enable_all().build() {
        Ok(rt) => rt,
        Err(error) => panic!("no runtime: {error}"),
    }
}

/// A loopback server that answers each connection with the next canned reply and records every
/// raw request it reads.
struct Server {
    base: String,
    requests: Arc<Mutex<Vec<String>>>,
}

fn serve(replies: Vec<&'static str>) -> Server {
    let listener = match TcpListener::bind("127.0.0.1:0") {
        Ok(listener) => listener,
        Err(error) => panic!("no loopback: {error}"),
    };
    let base = format!("http://{}", listener.local_addr().map(|a| a.to_string()).unwrap_or_default());
    let requests = Arc::new(Mutex::new(Vec::new()));
    let seen = requests.clone();
    thread::spawn(move || {
        for reply in replies {
            let Ok((mut stream, _)) = listener.accept() else { return };
            let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
            let mut raw = Vec::new();
            let mut buf = [0u8; 4096];
            while let Ok(n) = stream.read(&mut buf) {
                if n == 0 {
                    break;
                }
                raw.extend_from_slice(&buf[..n]);
                let text = String::from_utf8_lossy(&raw).to_string();
                if let Some(end) = text.find("\r\n\r\n") {
                    let length = text[..end]
                        .lines()
                        .find_map(|l| l.to_ascii_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse::<usize>().unwrap_or(0)))
                        .unwrap_or(0);
                    if raw.len() >= end + 4 + length {
                        break;
                    }
                }
            }
            if let Ok(mut list) = seen.lock() {
                list.push(String::from_utf8_lossy(&raw).to_string());
            }
            let _ = stream.write_all(reply.as_bytes());
        }
    });
    Server { base, requests }
}

impl Server {
    fn requests(&self) -> Vec<String> {
        self.requests.lock().map(|r| r.clone()).unwrap_or_default()
    }
}

fn reason<T>(result: Result<T, Refusal>) -> Option<&'static str> {
    result.err().map(|r| r.reason)
}

#[test]
fn every_limit_is_a_pinned_constant() {
    assert_eq!(
        (MAX_INPUT_CHARS, MAX_OUTPUT_TOKENS, MAX_MODEL_ID, MAX_IN_FLIGHT, BUCKET_CALLS),
        (100_000, 4096, 100, 2, 20)
    );
    assert_eq!(
        (BUCKET_WINDOW, CONNECT_TIMEOUT, TOTAL_TIMEOUT, MIN_VAULT_VALUE),
        (Duration::from_secs(300), Duration::from_secs(10), Duration::from_secs(60), 6)
    );
    assert_eq!((ANTHROPIC_BASE, OPENROUTER_BASE), ("https://api.anthropic.com", "https://openrouter.ai"));
}

#[test]
fn the_input_output_and_model_caps_hold() {
    assert_eq!(check_input(&"a".repeat(MAX_INPUT_CHARS)), Ok(()));
    assert_eq!(
        check_input(&"é".repeat(MAX_INPUT_CHARS + 1)),
        Err(Refusal::new("assistant_too_long").with("max", "100000"))
    );
    assert_eq!((cap_output_tokens(500), cap_output_tokens(10_000)), (500, 4096));
    for id in ["claude-haiku-5-5", "anthropic/claude-sonnet-5-5", "meta/llama-4:free", "a.b_c"] {
        assert_eq!(check_model(id), Ok(()), "{id}");
    }
    let long = "m".repeat(MAX_MODEL_ID + 1);
    for id in ["", long.as_str(), "a b", "x;rm", "modèle", "a\nb", "a?b=c"] {
        assert_eq!(reason(check_model(id)), Some("assistant_model_unavailable"), "{id:?}");
    }
}

#[test]
fn two_calls_run_at_once_and_the_bucket_holds_twenty_per_window() {
    let now = Arc::new(Mutex::new(Instant::now()));
    let clock = now.clone();
    let limits = Limits::with_clock(Arc::new(move || clock.lock().map(|t| *t).unwrap_or_else(|_| Instant::now())));
    let first = limits.admit();
    let second = limits.admit();
    assert_eq!((first.is_ok(), second.is_ok()), (true, true));
    assert_eq!(reason(limits.admit()), Some("assistant_rate_limited"), "a third at once");
    drop(first);
    let third = limits.admit();
    assert!(third.is_ok(), "a place freed");
    drop((second, third));
    // 3 taken so far; 17 more fill the window.
    for _ in 0..17 {
        assert!(limits.admit().is_ok());
    }
    assert_eq!(reason(limits.admit()), Some("assistant_rate_limited"), "the 21st in the window");
    if let Ok(mut t) = now.lock() {
        *t += BUCKET_WINDOW;
    }
    assert!(limits.admit().is_ok(), "the window moved on");
}

#[test]
fn a_call_reaches_only_the_two_providers_or_loopback() {
    assert_eq!(Endpoint::anthropic().base(), ANTHROPIC_BASE);
    assert_eq!(Endpoint::openrouter().base(), OPENROUTER_BASE);
    for url in [ANTHROPIC_BASE, OPENROUTER_BASE, "http://127.0.0.1:4100", "http://localhost:9", "http://[::1]:8080"] {
        assert!(Endpoint::with_base(url).is_ok(), "{url}");
    }
    for url in [
        "https://evil.example",
        "https://api.anthropic.com.evil.example",
        "http://api.anthropic.com",
        "https://openrouter.ai/",
        "http://127.0.0.1.evil.example:80",
        "http://10.0.0.1:80",
        "file:///etc/passwd",
        "",
    ] {
        assert!(Endpoint::with_base(url).is_err(), "{url}");
    }
}

#[test]
fn vault_hits_are_ids_and_skip_short_values() {
    let values = vec![
        ("v1".to_string(), Secret::new("hunter22".to_string())),
        ("v2".to_string(), Secret::new("abc".to_string())),
        ("v3".to_string(), Secret::new("not-in-text".to_string())),
        ("v4".to_string(), Secret::new("dbpass-xyz".to_string())),
    ];
    let hits = vault_hits("login hunter22 then abc and dbpass-xyz", &values);
    assert_eq!(hits, vec!["v1".to_string(), "v4".to_string()]);
}

#[test]
fn a_request_carries_the_key_as_a_bearer_and_no_origin_and_is_sent_once() {
    let server = serve(vec![
        "HTTP/1.1 500 Internal Server Error\r\ncontent-length: 2\r\nrequest-id: req_1\r\nconnection: close\r\n\r\n{}",
        "HTTP/1.1 200 OK\r\ncontent-length: 2\r\nconnection: close\r\n\r\n{}",
    ]);
    let key = Secret::new(FAKE_KEY.to_string());
    let endpoint = Endpoint::with_base(&server.base).map_err(|r| r.reason);
    let reply = runtime().block_on(async {
        let client = client().map_err(|r| r.reason)?;
        let endpoint = endpoint?;
        send(&client, &endpoint, "/v1/messages", Method::Post(serde_json::json!({"a": 1})), &key, &[("anthropic-version", "2026-10-21".to_string())])
            .await
            .map_err(|r| r.reason)
    });
    let reply = reply.map(|r| (r.status, r.header("request-id").map(str::to_string), r.body));
    assert_eq!(reply, Ok((500, Some("req_1".to_string()), "{}".to_string())));
    let requests = server.requests();
    assert_eq!(requests.len(), 1, "no retry");
    let raw = requests[0].to_ascii_lowercase();
    assert!(raw.starts_with("post /v1/messages "), "{raw}");
    assert!(raw.contains(&format!("authorization: bearer {}", FAKE_KEY.to_ascii_lowercase())));
    assert!(raw.contains("anthropic-version: 2026-10-21"));
    assert!(!raw.contains("origin:"), "{raw}");
}

#[test]
fn a_redirect_is_not_followed_and_a_server_that_is_not_there_is_offline() {
    let server = serve(vec![
        "HTTP/1.1 302 Found\r\nlocation: http://127.0.0.1:1/elsewhere\r\ncontent-length: 0\r\nconnection: close\r\n\r\n",
    ]);
    let key = Secret::new(FAKE_KEY.to_string());
    let status = runtime().block_on(async {
        let client = client().map_err(|r| r.reason)?;
        let endpoint = Endpoint::with_base(&server.base).map_err(|r| r.reason)?;
        send(&client, &endpoint, "/v1/models", Method::Get, &key, &[]).await.map(|r| r.status).map_err(|r| r.reason)
    });
    assert_eq!(status, Ok(302));
    assert_eq!(server.requests().len(), 1);
    let port = TcpListener::bind("127.0.0.1:0").and_then(|l| l.local_addr()).map(|a| a.port()).unwrap_or(1);
    let outcome = runtime().block_on(async {
        let client = client()?;
        let endpoint = Endpoint::with_base(&format!("http://127.0.0.1:{port}"))?;
        send(&client, &endpoint, "/v1/models", Method::Get, &key, &[]).await.map(|r| r.status)
    });
    assert_eq!(reason(outcome), Some("assistant_offline"));
}

#[test]
fn a_call_past_its_limit_times_out_and_a_cancelled_one_answers_cancelled_and_never_late() {
    let calls = Arc::new(Calls::default());
    let rt = runtime();
    let slow = rt.block_on(calls.run("slow", Duration::from_millis(50), async {
        tokio::time::sleep(Duration::from_secs(5)).await;
        Ok::<_, Refusal>("late")
    }));
    assert_eq!(reason(slow), Some("assistant_timeout"));

    let delivered = Arc::new(AtomicBool::new(false));
    let flag = delivered.clone();
    let runner = calls.clone();
    let canceller = calls.clone();
    let cancelled = rt.block_on(async move {
        let call = tokio::spawn(async move {
            runner
                .run("r1", Duration::from_secs(5), async move {
                    tokio::time::sleep(Duration::from_millis(200)).await;
                    flag.store(true, Ordering::SeqCst);
                    Ok::<_, Refusal>("answer")
                })
                .await
        });
        tokio::time::sleep(Duration::from_millis(20)).await;
        canceller.cancel("r1");
        canceller.cancel("unknown");
        let outcome = call.await.map_err(|_| Refusal::new("join"));
        tokio::time::sleep(Duration::from_millis(400)).await;
        outcome
    });
    assert_eq!(cancelled.map(reason), Ok(Some("assistant_cancelled")));
    assert!(!delivered.load(Ordering::SeqCst), "the late answer never ran to the end");
    let fast = rt.block_on(calls.run("fast", Duration::from_secs(1), async { Ok::<_, Refusal>(7) }));
    assert_eq!(fast, Ok(7));
}
