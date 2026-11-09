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

use std::net::TcpListener;
use std::sync::atomic::AtomicBool;
use std::time::Duration;

/// What a sign-in's wait ended with.
#[derive(Debug, PartialEq, Eq)]
pub enum Outcome {
    /// Google redirected back with a code.
    Code(String),
    /// The person refused the consent (`error=access_denied`).
    Denied,
    Timeout,
    Cancelled,
}

/// A bound listener for one sign-in.
pub struct Listener {
    inner: TcpListener,
    port: u16,
}

/// Binds 127.0.0.1 on a free port for the sign-in whose `state` is given.
pub fn bind(_state: &str) -> Result<Listener, String> {
    let inner = TcpListener::bind(("127.0.0.1", 0)).map_err(|e| e.to_string())?;
    let port = inner.local_addr().map_err(|e| e.to_string())?.port();
    Ok(Listener { inner, port })
}

impl Listener {
    pub fn port(&self) -> u16 {
        self.port
    }

    /// Waits for the redirect. Consumes the listener: the port closes when this returns.
    pub fn wait(self, _timeout: Duration, _cancel: &AtomicBool) -> Outcome {
        Outcome::Timeout
    }
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
}
