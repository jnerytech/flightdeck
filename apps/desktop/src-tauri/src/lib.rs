//! Thin Tauri shell: everything else lives in the React frontend and the daemon.
//! The only native pieces are the OS credential store for host tokens and notifications.

const KEYRING_SERVICE: &str = "dev.flightdeck.app";

fn entry(host_id: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, host_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn token_get(host_id: String) -> Result<Option<String>, String> {
    match entry(&host_id)?.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn token_set(host_id: String, token: String) -> Result<(), String> {
    entry(&host_id)?.set_password(&token).map_err(|e| e.to_string())
}

#[tauri::command]
fn token_delete(host_id: String) -> Result<(), String> {
    match entry(&host_id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![token_get, token_set, token_delete])
        .run(tauri::generate_context!())
        .expect("error while running Flightdeck");
}
