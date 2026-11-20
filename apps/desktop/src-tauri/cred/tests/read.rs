//! The helper's answers, through its public entry, against a fake store.

use flightdeck_cred::{is_host_id, run, url_account, Store};
use std::cell::RefCell;
use std::collections::HashMap;

const ID: &str = "0b6a3f6e-5f0e-4a39-9c43-5d1d1c2b7a11";
const TOKEN: &str = "tok-SECRET-0123456789";

#[derive(Default)]
struct Fake {
    entries: RefCell<HashMap<String, String>>,
    asked: RefCell<Vec<String>>,
    broken: bool,
}

impl Store for Fake {
    fn read(&self, account: &str) -> Result<Option<String>, String> {
        self.asked.borrow_mut().push(account.to_string());
        if self.broken {
            return Err("the store is locked".to_string());
        }
        Ok(self.entries.borrow().get(account).cloned())
    }
    fn write(&self, account: &str, value: &str) -> Result<(), String> {
        self.entries.borrow_mut().insert(account.to_string(), value.to_string());
        Ok(())
    }
}

fn paired() -> Fake {
    let store = Fake::default();
    store.write(ID, TOKEN).unwrap();
    store.write(&url_account(ID), "wss://pi.example.ts.net/v1/ws").unwrap();
    store
}

fn args(words: &[&str]) -> Vec<String> {
    words.iter().map(|w| w.to_string()).collect()
}

fn refused() -> (i32, String) {
    (1, String::new())
}

fn answer(words: &[&str], store: &Fake, terminal: bool) -> (i32, String) {
    let out = run(&args(words), store, terminal);
    (out.code, out.stdout)
}

#[test]
fn get_prints_the_token_and_one_line_break() {
    assert_eq!(answer(&["get", "--", ID], &paired(), false), (0, format!("{TOKEN}\n")));
}

#[test]
fn url_prints_the_address_kept_beside_the_token() {
    assert_eq!(
        answer(&["url", "--", ID], &paired(), false),
        (0, "wss://pi.example.ts.net/v1/ws\n".to_string())
    );
}

#[test]
fn the_address_account_is_the_id_and_url() {
    assert_eq!(url_account(ID), format!("{ID}:url"));
}

#[test]
fn a_host_id_is_a_lower_case_uuid_and_nothing_else() {
    let good = [ID, "00000000-0000-0000-0000-000000000000"];
    let bad = [
        "",
        "0B6A3F6E-5F0E-4A39-9C43-5D1D1C2B7A11",
        "0b6a3f6e-5f0e-4a39-9c43-5d1d1c2b7a1",
        "0b6a3f6e-5f0e-4a39-9c43-5d1d1c2b7a111",
        "0b6a3f6e5f0e4a399c435d1d1c2b7a11",
        "0b6a3f6e-5f0e-4a39-9c43-5d1d1c2b7a1g",
        "0b6a3f6e-5f0e-4a39-9c43-5d1d1c2b7a11:url",
        "0b6a3f6e-5f0e-4a39-9c43-5d1d1c2b7a11\n",
        "é6a3f6e-5f0e-4a39-9c43-5d1d1c2b7a11",
    ];
    let wrong: Vec<(&str, bool)> = good
        .iter()
        .map(|id| (*id, true))
        .chain(bad.iter().map(|id| (*id, false)))
        .filter(|(id, want)| is_host_id(id) != *want)
        .collect();
    assert_eq!(wrong, Vec::<(&str, bool)>::new());
}

#[test]
fn an_id_that_is_not_a_uuid_never_reaches_the_store() {
    let store = paired();
    let bad = format!("{ID}:url");
    assert_eq!(answer(&["get", "--", &bad], &store, false), refused());
    assert_eq!(answer(&["url", "--", "../x"], &store, false), refused());
    assert_eq!(store.asked.borrow().len(), 0);
}

#[test]
fn any_other_command_line_is_refused() {
    let store = paired();
    let lines: Vec<Vec<&str>> = vec![
        vec![],
        vec!["get"],
        vec!["get", ID],
        vec!["get", "--"],
        vec!["get", "-x", ID],
        vec!["get", "--", ID, "extra"],
        vec!["list", "--", ID],
        vec!["GET", "--", ID],
        vec!["--", "get", ID],
    ];
    let wrong: Vec<Vec<&str>> =
        lines.into_iter().filter(|line| answer(line, &store, false) != refused()).collect();
    assert_eq!(wrong, Vec::<Vec<&str>>::new());
    assert_eq!(store.asked.borrow().len(), 0);
}

#[test]
fn a_terminal_on_stdout_gets_nothing_and_the_store_is_not_asked() {
    let store = paired();
    assert_eq!(answer(&["get", "--", ID], &store, true), refused());
    assert_eq!(store.asked.borrow().len(), 0);
}

#[test]
fn an_account_nobody_wrote_is_refused() {
    assert_eq!(answer(&["get", "--", ID], &Fake::default(), false), refused());
    let only_token = Fake::default();
    only_token.write(ID, TOKEN).unwrap();
    assert_eq!(answer(&["url", "--", ID], &only_token, false), refused());
}

#[test]
fn a_store_that_fails_is_refused_with_no_output() {
    let store = Fake { broken: true, ..Fake::default() };
    assert_eq!(answer(&["get", "--", ID], &store, false), refused());
}

#[test]
fn a_value_with_a_line_break_or_nothing_is_not_printed() {
    let store = Fake::default();
    store.write(ID, "two\nlines").unwrap();
    assert_eq!(answer(&["get", "--", ID], &store, false), refused());
    store.write(ID, "").unwrap();
    assert_eq!(answer(&["get", "--", ID], &store, false), refused());
}
