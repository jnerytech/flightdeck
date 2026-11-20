use std::io::{IsTerminal, Write};

fn main() {
    // An argument that is not text is no panic: it fails to match like any other wrong one.
    let args: Vec<String> = std::env::args_os()
        .skip(1)
        .map(|arg| arg.into_string().unwrap_or_default())
        .collect();
    let out = flightdeck_cred::run(&args, &flightdeck_cred::KeyringStore, std::io::stdout().is_terminal());
    if out.code == 0 {
        let _ = std::io::stdout().write_all(out.stdout.as_bytes());
    }
    std::process::exit(out.code);
}
