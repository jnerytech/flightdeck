use std::io::{IsTerminal, Write};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let out = flightdeck_cred::run(&args, &flightdeck_cred::KeyringStore, std::io::stdout().is_terminal());
    if out.code == 0 {
        let _ = std::io::stdout().write_all(out.stdout.as_bytes());
    }
    std::process::exit(out.code);
}
