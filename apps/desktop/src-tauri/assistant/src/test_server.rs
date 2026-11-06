//! The tests' loopback provider: one canned answer, and the raw request it read.

use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::{Arc, Mutex};

/// One loopback answer; returns the raw request it read.
pub fn serve_once(body: &'static str) -> (String, Arc<Mutex<String>>) {
    let answer = format!(
        "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
        body.len()
    );
    let listener = TcpListener::bind("127.0.0.1:0").ok();
    let base = listener
        .as_ref()
        .and_then(|l| l.local_addr().ok())
        .map(|a| format!("http://{a}"))
        .unwrap_or_default();
    let seen = Arc::new(Mutex::new(String::new()));
    let raw = seen.clone();
    std::thread::spawn(move || {
        let Some(listener) = listener else { return };
        let Ok((mut stream, _)) = listener.accept() else { return };
        let _ = stream.set_read_timeout(Some(std::time::Duration::from_millis(500)));
        let mut buf = [0u8; 8192];
        let mut got = Vec::new();
        while let Ok(n) = stream.read(&mut buf) {
            if n == 0 {
                break;
            }
            got.extend_from_slice(&buf[..n]);
            let text = String::from_utf8_lossy(&got).to_string();
            if text.contains("\r\n\r\n") && text.contains("\"messages\"") && text.ends_with('}') {
                break;
            }
        }
        if let Ok(mut r) = raw.lock() {
            *r = String::from_utf8_lossy(&got).to_string();
        }
        let _ = stream.write_all(answer.as_bytes());
    });
    (base, seen)
}
