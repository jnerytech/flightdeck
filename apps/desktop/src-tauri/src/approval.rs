//! The device key of a host's approvals (#3439): one P-256 key per host in the OS credential store,
//! which the webview can use but never read. Signing asks the person through a system dialog the
//! webview cannot click, and the dialog's words are built here from the text being signed, so a
//! script in the webview cannot make the key sign something the person did not see. This is a
//! reduction, not a proof: a script that can call this command can only ever get the person's yes,
//! and the dialog names what the allow also saves, never the tool or its command.

use crate::spawn_blocking_result;
use flightdeck_approval as key;
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

const APPROVAL_SERVICE: &str = "flightdeck-approval";

/// One confirmation at a time: a script cannot stack dialogs to wear the person down.
static ASKING: AtomicBool = AtomicBool::new(false);

struct Asking;

impl Asking {
    fn begin() -> Result<Self, String> {
        if ASKING.swap(true, Ordering::AcqRel) {
            return Err("busy".into());
        }
        Ok(Self)
    }
}

impl Drop for Asking {
    fn drop(&mut self) {
        ASKING.store(false, Ordering::Release);
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceKey {
    public_key: String,
    key_id: String,
}

impl From<key::PublicInfo> for DeviceKey {
    fn from(info: key::PublicInfo) -> Self {
        Self { public_key: info.public_key, key_id: info.key_id }
    }
}

fn entry(daemon_id: &str) -> Result<keyring::Entry, String> {
    if daemon_id.is_empty() || daemon_id.len() > 128 {
        return Err("a host id of 1 to 128 characters is needed".into());
    }
    keyring::Entry::new(APPROVAL_SERVICE, daemon_id).map_err(|e| e.to_string())
}

fn stored(daemon_id: &str) -> Result<Option<String>, String> {
    match entry(daemon_id)?.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// The public form of this device's key for a host, or `None` when it has none.
#[tauri::command]
pub async fn approval_key_get(daemon_id: String) -> Result<Option<DeviceKey>, String> {
    spawn_blocking_result(move || {
        stored(&daemon_id)?
            .map(|secret| key::public_info(&secret).map(DeviceKey::from))
            .transpose()
    })
    .await
}

/// Makes a new key for a host. It refuses when the host already has one, so a script cannot swap
/// the key an enrolled host trusts; the caller deletes the old key first on purpose.
#[tauri::command]
pub async fn approval_key_create(daemon_id: String) -> Result<DeviceKey, String> {
    spawn_blocking_result(move || {
        if stored(&daemon_id)?.is_some() {
            return Err("this device already has a key for this host".into());
        }
        let secret = key::generate();
        let info = key::public_info(&secret)?;
        entry(&daemon_id)?
            .set_password(&secret)
            .map_err(|e| e.to_string())?;
        Ok(info.into())
    })
    .await
}

#[tauri::command]
pub async fn approval_key_delete(daemon_id: String) -> Result<(), String> {
    spawn_blocking_result(move || match entry(&daemon_id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    })
    .await
}

/// Signs `message` with the key of `daemon_id` after the person says yes in a system dialog. Only
/// a text the protocol builds for this host and this key is signed (`key::describe`).
#[tauri::command]
pub async fn approval_sign(
    app: AppHandle,
    daemon_id: String,
    message: String,
    lang: String,
) -> Result<String, String> {
    spawn_blocking_result(move || {
        let secret = stored(&daemon_id)?.ok_or("this device has no key for this host")?;
        let own = key::public_info(&secret)?;
        let ask = key::describe(&message, &daemon_id, &own)?;
        let (title, body) = key::confirm_text(&ask, &lang);
        let (yes, no) = if lang == "pt-BR" {
            ("Permitir", "Cancelar")
        } else {
            ("Allow", "Cancel")
        };
        let _only_one = Asking::begin()?;
        let said_yes = app
            .dialog()
            .message(body)
            .title(title)
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::OkCancelCustom(yes.into(), no.into()))
            .blocking_show();
        if !said_yes {
            return Err("declined".into());
        }
        key::sign(&secret, &message)
    })
    .await
}
