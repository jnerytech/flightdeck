//! The built helper, on the command lines that never reach the store: what the CLI relies on is
//! that a refusal is exit 1 with nothing on stdout or stderr.

use std::process::{Command, Stdio};

fn helper(args: &[&str]) -> (Option<i32>, Vec<u8>, Vec<u8>) {
    let out = Command::new(env!("CARGO_BIN_EXE_flightdeck-cred"))
        .args(args)
        .stdin(Stdio::null())
        .output()
        .unwrap();
    (out.status.code(), out.stdout, out.stderr)
}

#[test]
fn a_command_line_it_does_not_know_exits_1_and_says_nothing() {
    for args in [vec![], vec!["get"], vec!["list", "--", "x"], vec!["get", "--", "not-an-id"]] {
        let (code, stdout, stderr) = helper(&args);
        let seen = (code, stdout, stderr);
        assert_eq!((seen, &args), ((Some(1), vec![], vec![]), &args));
    }
}

#[cfg(unix)]
#[test]
fn an_argument_that_is_not_utf8_is_a_refusal_like_any_other() {
    use std::os::unix::ffi::OsStrExt;
    let out = Command::new(env!("CARGO_BIN_EXE_flightdeck-cred"))
        .arg(std::ffi::OsStr::from_bytes(&[0xff, 0xfe]))
        .stdin(Stdio::null())
        .output()
        .unwrap();
    assert_eq!((out.status.code(), out.stdout, out.stderr), (Some(1), vec![], vec![]));
}
