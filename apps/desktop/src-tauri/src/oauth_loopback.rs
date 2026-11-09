//! The redirect listener of a desktop OAuth sign-in (issue #1462). The webview opens Google's
//! consent page in the browser; Google redirects to `http://127.0.0.1:<port>/?code=..&state=..`; this
//! listener answers that one request and gives back the code. Plain `std`, so the checks run without
//! the Tauri runtime.
//!
//! What it holds to: it binds 127.0.0.1 only, on a port the system picks; it takes a request only
//! with the `Host` header `127.0.0.1:<port>` (a page that rebinds a name to 127.0.0.1 sends another);
//! it takes only `GET /`; a request whose `state` is not the one of this sign-in is answered and
//! ignored, so a stray local request cannot end the wait; the first good request closes the
//! listener (one use); it gives up at the limit or when cancelled. The code is never printed, and
//! `Outcome`'s `Debug` leaves it out.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

/// A state is base64url text the app made; anything else is not one of ours.
const MAX_STATE: usize = 256;
/// Shorter states can be guessed by a local process; the app sends 128 bits or more.
const MIN_STATE: usize = 16;
/// Everything the reply may spend reading what a client still sends, in total.
const DRAIN_LIMIT: Duration = Duration::from_millis(200);
/// The request line and headers of a browser's redirect fit well inside this.
const MAX_REQUEST: usize = 8 * 1024;
/// Google's codes are well under 512 characters.
const MAX_CODE: usize = 2048;
/// A connection that has not sent its request in this time is dropped, so one silent client cannot
/// hold the listener (the connections are served one at a time).
const CONNECTION_LIMIT: Duration = Duration::from_secs(2);
const POLL: Duration = Duration::from_millis(25);

const PAGE: &str = "<!doctype html><meta charset=utf-8><title>Flightdeck</title>\
<p>Done. You can close this window and go back to Flightdeck.</p>";
const DENIED_PAGE: &str = "<!doctype html><meta charset=utf-8><title>Flightdeck</title>\
<p>The sign-in was cancelled. You can close this window.</p>";
const REFUSED_PAGE: &str = "<!doctype html><meta charset=utf-8><title>Flightdeck</title>\
<p>This request was not accepted.</p>";

/// What a sign-in's wait ended with.
#[derive(PartialEq, Eq)]
pub enum Outcome {
    /// Google redirected back with a code.
    Code(String),
    /// The person refused the consent (`error=access_denied`).
    Denied,
    Timeout,
    Cancelled,
}

impl std::fmt::Debug for Outcome {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Outcome::Code(_) => "Code(..)",
            Outcome::Denied => "Denied",
            Outcome::Timeout => "Timeout",
            Outcome::Cancelled => "Cancelled",
        })
    }
}

/// A bound listener for one sign-in.
pub struct Listener {
    inner: TcpListener,
    port: u16,
    state: String,
}

/// Binds 127.0.0.1 on a free port for the sign-in whose `state` is given.
pub fn bind(state: &str) -> Result<Listener, String> {
    let well_formed = state.len() >= MIN_STATE
        && state.len() <= MAX_STATE
        && state.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
    if !well_formed {
        return Err("the state is not valid".to_string());
    }
    let inner = TcpListener::bind(("127.0.0.1", 0)).map_err(|e| e.to_string())?;
    inner.set_nonblocking(true).map_err(|e| e.to_string())?;
    let port = inner.local_addr().map_err(|e| e.to_string())?.port();
    Ok(Listener { inner, port, state: state.to_string() })
}

impl Listener {
    pub fn port(&self) -> u16 {
        self.port
    }

    /// Waits for the redirect. Consumes the listener: the port closes when this returns.
    pub fn wait(self, timeout: Duration, cancel: &AtomicBool) -> Outcome {
        let deadline = Instant::now() + timeout;
        loop {
            if cancel.load(Ordering::SeqCst) {
                return Outcome::Cancelled;
            }
            if Instant::now() >= deadline {
                return Outcome::Timeout;
            }
            match self.inner.accept() {
                Ok((stream, _)) => {
                    if let Some(outcome) = self.serve(stream) {
                        return outcome;
                    }
                }
                // Nothing yet, or a connection that failed before it was accepted: look again.
                Err(_) => std::thread::sleep(POLL),
            }
        }
    }

    /// Answers one connection; `Some` only for the request that ends the sign-in.
    fn serve(&self, mut stream: TcpStream) -> Option<Outcome> {
        // A stream accepted from a non-blocking listener may inherit that mode on some systems.
        stream.set_nonblocking(false).ok()?;
        stream.set_write_timeout(Some(CONNECTION_LIMIT)).ok()?;
        let head = match read_head(&mut stream) {
            Head::Complete(text) => text,
            Head::TooLarge => {
                respond(&mut stream, "431 Request Header Fields Too Large", REFUSED_PAGE);
                return None;
            }
            Head::Gone => return None,
        };
        let outcome = self.judge(&head);
        match &outcome {
            Verdict::Answer(Outcome::Denied) => respond(&mut stream, "200 OK", DENIED_PAGE),
            Verdict::Answer(_) => respond(&mut stream, "200 OK", PAGE),
            Verdict::Refuse(status) => respond(&mut stream, status, REFUSED_PAGE),
        }
        match outcome {
            Verdict::Answer(done) => Some(done),
            Verdict::Refuse(_) => None,
        }
    }

    fn judge(&self, head: &str) -> Verdict {
        let mut lines = head.split("\r\n");
        let mut request = lines.next().unwrap_or("").split(' ');
        let (Some(method), Some(target), Some(version), None) =
            (request.next(), request.next(), request.next(), request.next())
        else {
            return Verdict::Refuse("400 Bad Request");
        };
        if !version.starts_with("HTTP/1.") {
            return Verdict::Refuse("400 Bad Request");
        }
        // The address the browser used must be the loopback address and this port: a page that
        // rebinds a name to 127.0.0.1 sends its own name as the host.
        let host = lines
            .filter_map(|line| line.split_once(':'))
            .find(|(name, _)| name.eq_ignore_ascii_case("host"))
            .map(|(_, value)| value.trim());
        if host != Some(format!("127.0.0.1:{}", self.port).as_str()) {
            return Verdict::Refuse("421 Misdirected Request");
        }
        if method != "GET" {
            return Verdict::Refuse("405 Method Not Allowed");
        }
        let (path, query) = target.split_once('?').unwrap_or((target, ""));
        if path != "/" {
            return Verdict::Refuse("404 Not Found");
        }
        let Some(pairs) = parse_query(query) else {
            return Verdict::Refuse("400 Bad Request");
        };
        let first = |name: &str| pairs.iter().find(|(key, _)| key == name).map(|(_, v)| v.as_str());
        // The state comes first: a request that is not the answer to this sign-in changes nothing.
        match first("state") {
            Some(state) if same(state, &self.state) => {}
            _ => return Verdict::Refuse("400 Bad Request"),
        }
        if first("error").is_some() {
            return Verdict::Answer(Outcome::Denied);
        }
        match first("code") {
            Some(code) if !code.is_empty() && code.len() <= MAX_CODE => {
                Verdict::Answer(Outcome::Code(code.to_string()))
            }
            _ => Verdict::Refuse("400 Bad Request"),
        }
    }
}

enum Verdict {
    Answer(Outcome),
    Refuse(&'static str),
}

enum Head {
    Complete(String),
    TooLarge,
    Gone,
}

/// Reads up to the blank line that ends the headers, within the size and time limits.
fn read_head(stream: &mut TcpStream) -> Head {
    let started = Instant::now();
    let mut buffer = Vec::with_capacity(1024);
    let mut chunk = [0u8; 1024];
    loop {
        if let Some(end) = buffer.windows(4).position(|w| w == b"\r\n\r\n") {
            return match String::from_utf8(buffer[..end].to_vec()) {
                Ok(text) => Head::Complete(text),
                Err(_) => Head::Gone,
            };
        }
        if buffer.len() > MAX_REQUEST {
            return Head::TooLarge;
        }
        let left = CONNECTION_LIMIT.saturating_sub(started.elapsed());
        if left.is_zero() || stream.set_read_timeout(Some(left)).is_err() {
            return Head::Gone;
        }
        match stream.read(&mut chunk) {
            Ok(0) | Err(_) => return Head::Gone,
            Ok(n) => buffer.extend_from_slice(&chunk[..n]),
        }
    }
}

fn respond(stream: &mut TcpStream, status: &str, body: &str) {
    let reply = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\n\
Cache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nX-Content-Type-Options: nosniff\r\n\
Content-Security-Policy: default-src 'none'\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(reply.as_bytes());
    let _ = stream.flush();
    let _ = stream.shutdown(std::net::Shutdown::Write);
    // What the client still sends is read and dropped for a moment: closing with unread input resets
    // the connection and can lose the reply.
    let started = Instant::now();
    let mut sink = [0u8; 4096];
    let mut left = 64 * 1024usize;
    while left > 0 {
        // One deadline for the whole drain, so a client that trickles bytes cannot hold the wait.
        let time = DRAIN_LIMIT.saturating_sub(started.elapsed());
        if time.is_zero() || stream.set_read_timeout(Some(time)).is_err() {
            break;
        }
        match stream.read(&mut sink) {
            Ok(0) | Err(_) => break,
            Ok(n) => left = left.saturating_sub(n),
        }
    }
}

/// Equal text, compared without stopping at the first difference.
fn same(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// `a=b&c=d` as decoded pairs; `None` when a percent sign is not followed by two hex digits or the
/// decoded text is not UTF-8.
fn parse_query(query: &str) -> Option<Vec<(String, String)>> {
    query
        .split('&')
        .filter(|part| !part.is_empty())
        .map(|part| {
            let (key, value) = part.split_once('=').unwrap_or((part, ""));
            Some((decode(key)?, decode(value)?))
        })
        .collect()
}

fn decode(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' => {
                let pair = text.get(i + 1..i + 3)?;
                if !pair.bytes().all(|b| b.is_ascii_hexdigit()) {
                    return None;
                }
                out.push(u8::from_str_radix(pair, 16).ok()?);
                i += 3;
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            other => {
                out.push(other);
                i += 1;
            }
        }
    }
    String::from_utf8(out).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpStream;
    use std::sync::atomic::Ordering;
    use std::sync::Arc;
    use std::time::Instant;

    const STATE: &str = "stateABC_123-xyz";
    const LONG: Duration = Duration::from_secs(10);

    /// Sends `request` to the port and returns the whole reply ("" when nothing could be sent).
    fn send(port: u16, request: &str) -> String {
        let Ok(mut stream) = TcpStream::connect(("127.0.0.1", port)) else {
            return String::new();
        };
        let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
        let _ = stream.write_all(request.as_bytes());
        let mut reply = String::new();
        let _ = stream.read_to_string(&mut reply);
        reply
    }

    fn get(port: u16, target: &str) -> String {
        send(port, &format!("GET {target} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"))
    }

    /// Starts the wait on a thread; returns the port, the cancel flag and the handle.
    fn waiting(timeout: Duration) -> (u16, Arc<AtomicBool>, std::thread::JoinHandle<Outcome>) {
        let listener = bind(STATE).unwrap();
        let port = listener.port();
        let cancel = Arc::new(AtomicBool::new(false));
        let flag = cancel.clone();
        let handle = std::thread::spawn(move || listener.wait(timeout, &flag));
        (port, cancel, handle)
    }

    fn status(reply: &str) -> &str {
        reply.lines().next().unwrap_or("")
    }

    #[test]
    fn binds_loopback_on_a_free_port_and_refuses_a_bad_state() {
        let listener = bind(STATE).unwrap();
        assert_ne!(listener.port(), 0);
        assert!(listener.inner.local_addr().unwrap().ip().is_loopback());
        assert!(bind("").is_err());
        assert!(bind("has space").is_err());
        assert!(bind("a&b=c").is_err());
        assert!(bind(&"a".repeat(257)).is_err());
    }

    #[test]
    fn a_request_with_the_state_gives_the_code_and_a_page_that_echoes_nothing() {
        let (port, _cancel, handle) = waiting(LONG);
        let reply = get(port, &format!("/?code=the-code&state={STATE}&scope=x"));
        assert_eq!(handle.join().unwrap(), Outcome::Code("the-code".to_string()));
        assert!(status(&reply).contains("200"), "{}", status(&reply));
        assert!(reply.contains("close this window"));
        assert!(reply.contains("Cache-Control: no-store"));
        assert!(!reply.contains("the-code"));
    }

    #[test]
    fn the_code_is_percent_decoded() {
        let (port, _cancel, handle) = waiting(LONG);
        get(port, &format!("/?state={STATE}&code=4%2F0Aab-c_d"));
        assert_eq!(handle.join().unwrap(), Outcome::Code("4/0Aab-c_d".to_string()));
    }

    #[test]
    fn a_foreign_or_missing_state_is_answered_and_the_wait_goes_on() {
        let (port, _cancel, handle) = waiting(LONG);
        let forged = get(port, "/?code=evil&state=other");
        let missing = get(port, "/?code=evil");
        assert!(status(&forged).contains("400"), "{}", status(&forged));
        assert!(status(&missing).contains("400"), "{}", status(&missing));
        get(port, &format!("/?code=real&state={STATE}"));
        assert_eq!(handle.join().unwrap(), Outcome::Code("real".to_string()));
    }

    #[test]
    fn a_host_header_that_is_not_the_loopback_address_is_refused() {
        let (port, _cancel, handle) = waiting(LONG);
        for host in ["evil.example", "localhost", "127.0.0.1", "127.0.0.1:1"] {
            let reply = send(
                port,
                &format!("GET /?code=evil&state={STATE} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n"),
            );
            assert!(status(&reply).contains("421"), "{host}: {}", status(&reply));
        }
        let none = send(port, &format!("GET /?code=evil&state={STATE} HTTP/1.1\r\n\r\n"));
        assert!(status(&none).contains("421"), "{}", status(&none));
        get(port, &format!("/?code=real&state={STATE}"));
        assert_eq!(handle.join().unwrap(), Outcome::Code("real".to_string()));
    }

    #[test]
    fn only_get_of_the_root_counts() {
        let (port, _cancel, handle) = waiting(LONG);
        let post = send(
            port,
            &format!("POST /?code=evil&state={STATE} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Length: 0\r\n\r\n"),
        );
        let icon = get(port, "/favicon.ico");
        let other = get(port, &format!("/other?code=evil&state={STATE}"));
        assert!(status(&post).contains("405"), "{}", status(&post));
        assert!(status(&icon).contains("404"), "{}", status(&icon));
        assert!(status(&other).contains("404"), "{}", status(&other));
        get(port, &format!("/?code=real&state={STATE}"));
        assert_eq!(handle.join().unwrap(), Outcome::Code("real".to_string()));
    }

    #[test]
    fn a_refusal_of_the_consent_ends_the_wait_but_only_with_the_state() {
        let (port, _cancel, handle) = waiting(LONG);
        let stray = get(port, "/?error=access_denied&state=other");
        assert!(status(&stray).contains("400"), "{}", status(&stray));
        let reply = get(port, &format!("/?error=access_denied&state={STATE}"));
        assert_eq!(handle.join().unwrap(), Outcome::Denied);
        assert!(status(&reply).contains("200"), "{}", status(&reply));
    }

    #[test]
    fn an_oversized_request_or_code_is_refused_and_the_wait_goes_on() {
        let (port, _cancel, handle) = waiting(LONG);
        let big = get(port, &format!("/?code={}&state={STATE}", "a".repeat(3000)));
        let header = send(
            port,
            &format!("GET / HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nX-Pad: {}\r\n\r\n", "a".repeat(20_000)),
        );
        assert!(status(&big).contains("400"), "{}", status(&big));
        assert!(status(&header).contains("431"), "{}", status(&header));
        get(port, &format!("/?code=real&state={STATE}"));
        assert_eq!(handle.join().unwrap(), Outcome::Code("real".to_string()));
    }

    #[test]
    fn a_silent_connection_does_not_hold_the_listener_for_long() {
        let (port, _cancel, handle) = waiting(LONG);
        let _idle = TcpStream::connect(("127.0.0.1", port)).unwrap();
        let started = Instant::now();
        get(port, &format!("/?code=real&state={STATE}"));
        assert_eq!(handle.join().unwrap(), Outcome::Code("real".to_string()));
        assert!(started.elapsed() < Duration::from_secs(4));
    }

    #[test]
    fn it_gives_up_at_the_limit_and_when_cancelled() {
        let started = Instant::now();
        let (_port, _cancel, handle) = waiting(Duration::from_millis(200));
        assert_eq!(handle.join().unwrap(), Outcome::Timeout);
        assert!(started.elapsed() >= Duration::from_millis(200));
        assert!(started.elapsed() < Duration::from_secs(3));

        let (_port, cancel, handle) = waiting(LONG);
        std::thread::sleep(Duration::from_millis(100));
        cancel.store(true, Ordering::SeqCst);
        let began = Instant::now();
        assert_eq!(handle.join().unwrap(), Outcome::Cancelled);
        assert!(began.elapsed() < Duration::from_secs(2));
    }

    #[test]
    fn it_serves_once_then_the_port_is_closed() {
        let (port, _cancel, handle) = waiting(LONG);
        get(port, &format!("/?code=real&state={STATE}"));
        assert_eq!(handle.join().unwrap(), Outcome::Code("real".to_string()));
        assert!(TcpStream::connect(("127.0.0.1", port)).is_err());
    }

    #[test]
    fn the_debug_of_an_outcome_leaves_the_code_out() {
        let shown = format!("{:?}", Outcome::Code("secret-code".to_string()));
        assert!(!shown.contains("secret-code"));
        assert_eq!(format!("{:?}", Outcome::Denied), "Denied");
    }

    #[test]
    fn the_state_must_be_long_enough_to_be_unguessable() {
        assert!(bind("short").is_err());
        assert!(bind(&"a".repeat(15)).is_err());
        assert!(bind(&"a".repeat(16)).is_ok());
    }

    #[test]
    fn a_hex_escape_with_a_sign_is_not_an_escape() {
        let (port, cancel, handle) = waiting(LONG);
        let reply = get(port, &format!("/?code=x&state={STATE}&scope=%+f"));
        assert!(status(&reply).contains("400"), "{}", status(&reply));
        cancel.store(true, Ordering::SeqCst);
        assert_eq!(handle.join().unwrap(), Outcome::Cancelled);
    }

    #[test]
    fn a_client_that_trickles_bytes_after_a_refused_request_cannot_outlast_the_limit() {
        let (port, _cancel, handle) = waiting(Duration::from_secs(1));
        let started = Instant::now();
        let trickle = std::thread::spawn(move || {
            let Ok(mut stream) = TcpStream::connect(("127.0.0.1", port)) else {
                return;
            };
            if stream.write_all(b"POST / HTTP/1.1\r\nHost: x\r\n\r\n").is_err() {
                return;
            }
            for _ in 0..50 {
                std::thread::sleep(Duration::from_millis(100));
                if stream.write_all(b"x").is_err() {
                    return;
                }
            }
        });
        assert_eq!(handle.join().unwrap(), Outcome::Timeout);
        assert!(started.elapsed() < Duration::from_millis(2500), "{:?}", started.elapsed());
        let _ = trickle.join();
    }
}
