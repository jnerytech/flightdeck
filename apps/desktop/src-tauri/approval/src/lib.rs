//! #3439: the device key of a host and the check of what it is asked to sign. The private scalar
//! lives in the OS credential store (the app crate) and never reaches the webview; this crate holds
//! the parts that need no Tauri: making a key, its two public forms, the signature, and reading the
//! text to be signed so the native confirmation says what the key is about to do.

use base64::{engine::general_purpose::STANDARD, Engine};
use p256::ecdsa::{signature::Signer, Signature, SigningKey, VerifyingKey};
use p256::pkcs8::{DecodePublicKey, EncodePublicKey};
use sha2::{Digest, Sha256};

/// What a signed text asks for.
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum Kind {
    Approve,
    EnrollFirst,
    /// An enrolled device adds another one (#3478).
    EnrollAdd,
    Revoke,
    /// The use of a secret of a prod or high-risk request (#3452).
    VaultApprove,
    /// A command that moves code or trust, with the payload the dialog reads (#3453).
    Command,
}

/// What a signed command does, read from its payload (never from text the webview sent).
#[derive(Debug, PartialEq, Eq, Clone)]
pub enum CommandAsk {
    /// `card.pr.merge`: this pull request, at this head commit, by this method.
    PrMerge { url: String, head: String, method: String },
    /// `host.bypass` with `allow: true`: sessions of this host may start with every permission check off (#3507).
    Bypass,
    /// `project.trust.set` with `trusted: true`: this folder's own hooks and servers run with no prompt.
    TrustProject { path: String },
    /// `autoapprove.resume`: the automatic approver answers this session's requests again with no person.
    ResumeApproval { session: String },
    /// `roots.add`: sessions of this host may start in this folder and everything inside it (#3507).
    RootsAdd { path: String },
    /// `project.harness.apply`: write these parts of the Claude Code setup into this folder, from a template or not (#3507).
    HarnessApply { path: String, parts: Vec<String>, template: Option<String>, reformat: bool },
    /// `plugins.install`: install this plugin (by id, or from this folder) at this scope; it runs code on the host (#3516).
    PluginInstall { plugin: Option<String>, dir: Option<String>, scope: String },
    /// `plugins.update`: update this installed plugin to the content the person was shown (#3516).
    PluginUpdate { plugin: String },
}

/// What the text names: the request to allow, the key to add or the key to revoke.
#[derive(Debug, PartialEq, Eq)]
pub struct Ask {
    pub kind: Kind,
    /// The host the text is for (its daemon id): the dialog names it, since the webview picks it.
    pub host: String,
    pub subject: String,
    /// What an allow carries besides the allow itself; the hashes say it, the dialog must too.
    pub also: Also,
    /// For a signed command: what its payload says, read here (#3453).
    pub command: Option<CommandAsk>,
}

/// What a signed allow also does: saves permission rules, rewrites the tool's input, adds a message.
/// A signed use of a secret (#3452) says here whether it holds for the whole session, not one use.
#[derive(Debug, PartialEq, Eq, Clone, Copy, Default)]
pub struct Also {
    pub rules: bool,
    pub input: bool,
    pub message: bool,
    pub session: bool,
}

/// The two public forms the daemon knows a key by.
#[derive(Debug, PartialEq, Eq, Clone)]
pub struct PublicInfo {
    /// Base64 of the SPKI DER.
    pub public_key: String,
    /// Lowercase hex SHA-256 of the SPKI DER.
    pub key_id: String,
}

const TAG_APPROVAL: &str = "flightdeck/approval/v1";
const TAG_ENROLL_FIRST: &str = "flightdeck/enroll-first/v1";
const TAG_ENROLL_ADD: &str = "flightdeck/enroll-add/v1";
const TAG_REVOKE: &str = "flightdeck/revoke/v1";
const TAG_VAULT_APPROVE: &str = "flightdeck/vault-approve/v1";
const TAG_COMMAND: &str = "flightdeck/command/v1";

/// The longest text the protocol builds is about 600 bytes; anything past this is not one of them.
const MAX_TEXT: usize = 2048;
/// The payload a command signs is a few short fields; anything past this is not one of them.
const MAX_PAYLOAD: usize = 1024;
/// A setup's payload also carries the digest of each file the host would write (up to 17 of them), so it may be longer.
const MAX_HARNESS_PAYLOAD: usize = 8192;
/// The parts of the Claude Code setup the host writes, as the protocol names them.
const HARNESS_PARTS: [&str; 5] = ["claudeMd", "hooks", "permissions", "skills", "agents"];
/// The most files one setup writes (the preview's digests).
const MAX_HARNESS_DIGESTS: usize = 17;

fn sha256_hex(text: &str) -> String {
    Sha256::digest(text.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

/// A new key: the base64 of its 32-byte scalar.
pub fn generate() -> String {
    STANDARD.encode(SigningKey::random(&mut rand_core::OsRng).to_bytes())
}

/// Whether the text is the base64 SPKI of an ECDSA P-256 public key, the form the daemon enrolls.
fn is_p256_public_key(public_key: &str) -> bool {
    // 91 bytes is the uncompressed form the app and the host make; a compressed encoding of the same
    // point (59 bytes) would pass for another key beside the one it repeats.
    STANDARD
        .decode(public_key)
        .ok()
        .is_some_and(|der| der.len() == 91 && VerifyingKey::from_public_key_der(&der).is_ok())
}

fn signing_key(secret: &str) -> Result<SigningKey, String> {
    let bytes = STANDARD
        .decode(secret)
        .map_err(|_| "the stored key is not base64".to_string())?;
    SigningKey::from_slice(&bytes).map_err(|_| "the stored key is not a P-256 scalar".to_string())
}

pub fn public_info(secret: &str) -> Result<PublicInfo, String> {
    let der = signing_key(secret)?
        .verifying_key()
        .to_public_key_der()
        .map_err(|e| e.to_string())?;
    let key_id = Sha256::digest(der.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    Ok(PublicInfo { public_key: STANDARD.encode(der.as_bytes()), key_id })
}

/// The base64 of the 64-byte r||s signature (IEEE P1363) of ECDSA P-256 / SHA-256 over `message`.
pub fn sign(secret: &str, message: &str) -> Result<String, String> {
    let signature: Signature = signing_key(secret)?.sign(message.as_bytes());
    Ok(STANDARD.encode(signature.to_bytes()))
}

/// Reads the text a device is asked to sign and refuses what the key must never sign: another tag,
/// another host (`daemon_id`), a message made for another key, or an enrollment of another key
/// than this one. The text is the canonical JSON array of strings the protocol builds.
pub fn describe(message: &str, daemon_id: &str, own: &PublicInfo) -> Result<Ask, String> {
    describe_with(message, daemon_id, own, None)
}

/// `describe` for a text that hashes a payload (a command, #3453): `payload` is the text the hash is of.
pub fn describe_with(message: &str, daemon_id: &str, own: &PublicInfo, payload: Option<&str>) -> Result<Ask, String> {
    if message.len() > MAX_TEXT {
        return Err("the text to sign is too long".into());
    }
    let parts: Vec<String> = serde_json::from_str::<Vec<serde_json::Value>>(message)
        .map_err(|_| "the text to sign is not a list".to_string())?
        .into_iter()
        .map(|part| match part {
            serde_json::Value::String(text) => Ok(text),
            _ => Err("the text to sign holds a part that is not text".to_string()),
        })
        .collect::<Result<_, _>>()?;
    let shape = |len: usize| {
        if parts.len() == len {
            Ok(())
        } else {
            Err("the text to sign has the wrong shape".to_string())
        }
    };
    let part = |i: usize| parts.get(i).map(String::as_str).unwrap_or_default();
    let mut command = None;
    let (kind, host, key, subject) = match part(0) {
        TAG_APPROVAL => {
            shape(9)?;
            if part(5) != "allow" {
                return Err("only an allow is signed".into());
            }
            (Kind::Approve, part(2), Some(part(1)), part(3))
        }
        TAG_ENROLL_FIRST => {
            shape(5)?;
            if part(3) != own.public_key {
                return Err("an enrollment of another key is not signed".into());
            }
            (Kind::EnrollFirst, part(1), None, part(3))
        }
        TAG_ENROLL_ADD => {
            shape(5)?;
            // Another key than this one, and one the daemon can verify: an add of anything else is no add.
            if part(4) == own.public_key || !is_p256_public_key(part(4)) {
                return Err("an add of this key, or of something that is not a device key, is not signed".into());
            }
            (Kind::EnrollAdd, part(2), Some(part(1)), part(4))
        }
        TAG_REVOKE => {
            shape(5)?;
            (Kind::Revoke, part(2), Some(part(1)), part(4))
        }
        TAG_VAULT_APPROVE => {
            shape(6)?;
            if !matches!(part(5), "once" | "session") {
                return Err("a use of a secret is signed for once or for the session only".into());
            }
            (Kind::VaultApprove, part(2), Some(part(1)), part(3))
        }
        TAG_COMMAND => {
            shape(6)?;
            // The text carries a hash; the dialog is built from the payload whose hash it is, never from the text.
            let (ask, canonical) = read_command(part(3), payload.ok_or("a command is signed with its payload")?)?;
            if sha256_hex(&canonical) != part(5) {
                return Err("the payload is not the one the text hashes".into());
            }
            command = Some(ask);
            (Kind::Command, part(2), Some(part(1)), part(3))
        }
        _ => return Err("this text is not one this key signs".into()),
    };
    if host != daemon_id {
        return Err("the text is for another host".into());
    }
    if key.is_some_and(|k| k != own.key_id) {
        return Err("the text is made for another key".into());
    }
    // The subject and the host go into the dialog: only the characters of an id, so they cannot pad or fake a line.
    let plain = |text: &str| {
        !text.is_empty()
            && text.len() <= 64
            && text.chars().all(|c| c.is_ascii_alphanumeric() || "._:-".contains(c))
    };
    if matches!(kind, Kind::Approve | Kind::Revoke | Kind::VaultApprove | Kind::Command) && !plain(subject) {
        return Err("the text to sign names an id that is not one".into());
    }
    if matches!(kind, Kind::EnrollAdd | Kind::Command) && !plain(host) {
        return Err("the text to sign names a host that is not an id".into());
    }
    // What the allow carries besides the allow: the hashes of nothing say it carries nothing.
    let none = |index: usize, empty: &str| part(index) != sha256_hex(empty);
    let also = if kind == Kind::Approve {
        Also { rules: none(6, "[]"), input: none(7, "null"), message: none(8, ""), session: false }
    } else {
        Also { session: kind == Kind::VaultApprove && part(5) == "session", ..Also::default() }
    };
    Ok(Ask { kind, host: host.to_string(), subject: subject.to_string(), also, command })
}

/// Reads the payload of `command` and gives what the dialog says plus the payload in canonical form (keys
/// sorted, no spaces: the text the protocol hashes, written here by hand so no crate feature changes it).
/// Each command names its fields: one more, one less or one that is not plain is refused, so a field the
/// dialog does not show can never be signed.
fn read_command(name: &str, payload: &str) -> Result<(CommandAsk, String), String> {
    let longest = if name == "project.harness.apply" { MAX_HARNESS_PAYLOAD } else { MAX_PAYLOAD };
    if payload.len() > longest {
        return Err("the payload to sign is too long".into());
    }
    let value: serde_json::Value =
        serde_json::from_str(payload).map_err(|_| "the payload to sign is not JSON".to_string())?;
    let fields = value.as_object().ok_or("the payload to sign is not an object")?;
    match name {
        "card.pr.merge" => {
            if fields.len() != 5 {
                return Err("the merge payload has the wrong fields".into());
            }
            let text = |key: &str| {
                fields
                    .get(key)
                    .and_then(serde_json::Value::as_str)
                    .ok_or_else(|| format!("the merge payload has no text for {key}"))
            };
            let (card, url, head, method) = (text("cardId")?, text("prUrl")?, text("headSha")?, text("method")?);
            if fields.get("confirm") != Some(&serde_json::Value::Bool(true)) {
                return Err("a merge is signed only once it is confirmed".into());
            }
            let id = !card.is_empty()
                && card.len() <= 64
                && card.chars().all(|c| c.is_ascii_alphanumeric() || "._:-".contains(c));
            // The address of a pull request's page, plain: https://<host>/<owner>/<repo>/pull/<number>, with no
            // userinfo, port, query or fragment, so the host the dialog shows is the one that is meant.
            let address = url.len() <= 200 && is_pull_request_address(url);
            let commit = matches!(head.len(), 40 | 64) && head.chars().all(|c| matches!(c, '0'..='9' | 'a'..='f'));
            if !id || !address || !commit || !matches!(method, "merge" | "squash") {
                return Err("the merge payload names something that is not a card, an address, a commit or a method".into());
            }
            let quoted = |text: &str| serde_json::to_string(text).unwrap_or_default();
            let canonical = format!(
                "{{\"cardId\":{},\"confirm\":true,\"headSha\":{},\"method\":{},\"prUrl\":{}}}",
                quoted(card),
                quoted(head),
                quoted(method),
                quoted(url)
            );
            Ok((CommandAsk::PrMerge { url: url.into(), head: head.into(), method: method.into() }, canonical))
        }
        // Only the turn-on is signed (turning it off is open and never asks a key), and only once confirmed.
        "host.bypass" => {
            let on = |key: &str| fields.get(key) == Some(&serde_json::Value::Bool(true));
            if fields.len() != 2 || !on("allow") || !on("confirm") {
                return Err("a bypass switch is signed only to turn it on, confirmed, with no other field".into());
            }
            Ok((CommandAsk::Bypass, "{\"allow\":true,\"confirm\":true}".to_string()))
        }
        "project.trust.set" => {
            if fields.len() != 2 {
                return Err("the trust payload has the wrong fields".into());
            }
            let path = fields
                .get("path")
                .and_then(serde_json::Value::as_str)
                .ok_or("the trust payload has no text for path")?;
            // Revoking trust lowers risk and takes no proof: only the grant is signed.
            if fields.get("trusted") != Some(&serde_json::Value::Bool(true)) {
                return Err("only trusting a folder is signed".into());
            }
            if !is_shown_path(path) {
                return Err("the folder is not a path the dialog can show".into());
            }
            let canonical = format!(
                "{{\"path\":{},\"trusted\":true}}",
                serde_json::to_string(path).unwrap_or_default()
            );
            Ok((CommandAsk::TrustProject { path: path.into() }, canonical))
        }
        "autoapprove.resume" => {
            if fields.len() != 2 {
                return Err("the resume payload has the wrong fields".into());
            }
            let key = fields
                .get("sessionKey")
                .and_then(serde_json::Value::as_str)
                .ok_or("the resume payload has no text for sessionKey")?;
            if fields.get("confirm") != Some(&serde_json::Value::Bool(true)) {
                return Err("a resume is signed only once it is confirmed".into());
            }
            // A session key is a plain token, like a card id: nothing in it can pad or continue the dialog.
            let token = !key.is_empty()
                && key.len() <= 128
                && key.chars().all(|c| c.is_ascii_alphanumeric() || "._:-".contains(c));
            if !token {
                return Err("the session key is not one the dialog can show".into());
            }
            let canonical = format!(
                "{{\"confirm\":true,\"sessionKey\":{}}}",
                serde_json::to_string(key).unwrap_or_default()
            );
            Ok((CommandAsk::ResumeApproval { session: key.into() }, canonical))
        }
        // Every payload of the command is signed: adding a folder has no value that lowers risk. Only a confirmed
        // add of a path the dialog can show whole is.
        "roots.add" => {
            if fields.len() != 2 || fields.get("confirm") != Some(&serde_json::Value::Bool(true)) {
                return Err("a folder is signed only confirmed, with a path and no other field".into());
            }
            let path = fields
                .get("path")
                .and_then(serde_json::Value::as_str)
                .ok_or("the folder payload has no text for path")?;
            if !is_shown_path(path) {
                return Err("the folder is not a path the dialog can show".into());
            }
            let canonical = format!(
                "{{\"confirm\":true,\"path\":{}}}",
                serde_json::to_string(path).unwrap_or_default()
            );
            Ok((CommandAsk::RootsAdd { path: path.into() }, canonical))
        }
        // Every payload of the command is signed. The dialog says the folder, the parts, the template and whether
        // hooks or a rewritten settings file are in; the digests are signed but not shown, and each one is a plain
        // token the host makes, so nothing in them can pad the text. The hook commands are not in the payload: the
        // host reads them again, so the person's check of them is the preview in the app.
        "project.harness.apply" => read_harness_apply(fields),
        // Every payload of both commands is signed. The dialog says the plugin (or the folder it comes from) and the
        // scope; the hash of the content the person was shown and the command the host showed are signed but not
        // shown, and each one is a plain token the host makes, so nothing in them can pad the text. What the plugin
        // contains is the preview in the app; the hash ties the install to that preview.
        "plugins.install" => read_plugin(fields, true),
        "plugins.update" => read_plugin(fields, false),
        _ => Err("this command is not one this key signs".into()),
    }
}

fn read_harness_apply(
    fields: &serde_json::Map<String, serde_json::Value>,
) -> Result<(CommandAsk, String), String> {
    const REFUSED: &str = "the setup payload has the wrong fields";
    let allowed = ["confirm", "digests", "parts", "path", "reformat", "template"];
    if fields.keys().any(|key| !allowed.contains(&key.as_str())) {
        return Err(REFUSED.into());
    }
    if fields.get("confirm") != Some(&serde_json::Value::Bool(true)) {
        return Err("a setup is signed only once it is confirmed".into());
    }
    let path = fields
        .get("path")
        .and_then(serde_json::Value::as_str)
        .ok_or("the setup payload has no text for path")?;
    if !is_shown_path(path) {
        return Err("the folder is not a path the dialog can show".into());
    }
    let listed = fields
        .get("parts")
        .and_then(serde_json::Value::as_array)
        .ok_or("the setup payload has no list of parts")?;
    let mut parts: Vec<String> = Vec::new();
    for part in listed {
        let name = part.as_str().filter(|name| HARNESS_PARTS.contains(name)).ok_or("the setup names a part the harness does not have")?;
        if parts.iter().any(|seen| seen == name) {
            return Err("the setup names a part twice".into());
        }
        parts.push(name.to_string());
    }
    if parts.is_empty() {
        return Err("the setup names no part".into());
    }
    let reformat = match fields.get("reformat") {
        None => false,
        Some(serde_json::Value::Bool(value)) => *value,
        Some(_) => return Err("the reformat of a setup is yes or no".into()),
    };
    let template = match fields.get("template") {
        None => None,
        Some(value) => {
            let id = value.as_str().ok_or("the template of a setup is a name")?;
            let mut chars = id.chars();
            let plain = id.len() <= 40
                && chars.next().is_some_and(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
                && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
            if !plain {
                return Err("the template is not a name the host takes".into());
            }
            Some(id.to_string())
        }
    };
    let listed = fields
        .get("digests")
        .and_then(serde_json::Value::as_object)
        .ok_or("the setup payload has no digests")?;
    if listed.is_empty() || listed.len() > MAX_HARNESS_DIGESTS {
        return Err("the setup has too many or no digests".into());
    }
    let mut digests: Vec<(&str, &str)> = Vec::new();
    for (key, value) in listed {
        let value = value.as_str().ok_or("a digest of a setup is text")?;
        let key_ok = !key.is_empty()
            && key.len() <= 256
            && key.chars().all(|c| c.is_ascii_alphanumeric() || "._/-@+".contains(c));
        let value_ok = !value.is_empty()
            && value.len() <= 128
            && value.chars().all(|c| c.is_ascii_alphanumeric() || "._:-".contains(c));
        if !key_ok || !value_ok {
            return Err("a digest of a setup is not a file name and a plain token".into());
        }
        digests.push((key, value));
    }
    // Byte order is the UTF-16 order the protocol sorts by, for ASCII.
    digests.sort_by(|a, b| a.0.cmp(b.0));
    let quoted = |text: &str| serde_json::to_string(text).unwrap_or_default();
    let digests_json = digests
        .iter()
        .map(|(key, value)| format!("{}:{}", quoted(key), quoted(value)))
        .collect::<Vec<_>>()
        .join(",");
    let parts_json = parts.iter().map(|part| quoted(part)).collect::<Vec<_>>().join(",");
    let mut canonical = format!(
        "{{\"confirm\":true,\"digests\":{{{digests_json}}},\"parts\":[{parts_json}],\"path\":{}",
        quoted(path)
    );
    if fields.contains_key("reformat") {
        canonical.push_str(&format!(",\"reformat\":{reformat}"));
    }
    if let Some(id) = &template {
        canonical.push_str(&format!(",\"template\":{}", quoted(id)));
    }
    canonical.push('}');
    Ok((CommandAsk::HarnessApply { path: path.into(), parts, template, reformat }, canonical))
}

/// The payload of `plugins.install` (`install`) or `plugins.update`, read for the dialog and written in canonical form.
fn read_plugin(
    fields: &serde_json::Map<String, serde_json::Value>,
    install: bool,
) -> Result<(CommandAsk, String), String> {
    let allowed: &[&str] = if install {
        &["acceptCommand", "confirmHash", "dir", "plugin", "scope"]
    } else {
        &["acceptCommand", "confirmHash", "plugin"]
    };
    if fields.keys().any(|key| !allowed.contains(&key.as_str())) {
        return Err("the plugin payload has the wrong fields".into());
    }
    let text = |key: &str| match fields.get(key) {
        None => Ok(None),
        Some(value) => value
            .as_str()
            .map(Some)
            .ok_or_else(|| format!("the plugin payload has no text for {key}")),
    };
    // A token the host makes (a content hash, the hash of a command it showed): never shown, so only plain.
    let token = |value: &str| {
        !value.is_empty()
            && value.len() <= 128
            && value.chars().all(|c| c.is_ascii_alphanumeric() || "._:-".contains(c))
    };
    let confirm = text("confirmHash")?.ok_or("the plugin payload has no content hash")?;
    let accept = text("acceptCommand")?;
    if !token(confirm) || accept.is_some_and(|value| !token(value)) {
        return Err("a hash of a plugin payload is not a plain token".into());
    }
    let plugin = text("plugin")?;
    let dir = text("dir")?;
    let one_source = if install { plugin.is_some() != dir.is_some() } else { plugin.is_some() };
    if !one_source {
        return Err("a plugin payload names a plugin or a folder, one of the two".into());
    }
    // `name@marketplace`: letters, digits and a few marks, never a first `-` (the host takes it as an option).
    if let Some(id) = plugin {
        let plain = id.len() <= 128
            && !id.starts_with('-')
            && !id.is_empty()
            && id.chars().all(|c| c.is_ascii_alphanumeric() || "._-@".contains(c));
        if !plain {
            return Err("the plugin is not a name the dialog can show".into());
        }
    }
    if let Some(path) = dir {
        if !is_shown_path(path) {
            return Err("the folder is not a path the dialog can show".into());
        }
    }
    let scope = text("scope")?;
    if scope.is_some_and(|value| !["user", "project", "local"].contains(&value)) {
        return Err("the scope of a plugin is user, project or local".into());
    }
    let quoted = |text: &str| serde_json::to_string(text).unwrap_or_default();
    let mut canonical = String::from("{");
    for (key, value) in [
        ("acceptCommand", accept),
        ("confirmHash", Some(confirm)),
        ("dir", dir),
        ("plugin", plugin),
        ("scope", scope),
    ] {
        if let Some(value) = value {
            if canonical.len() > 1 {
                canonical.push(',');
            }
            canonical.push_str(&format!("{}:{}", quoted(key), quoted(value)));
        }
    }
    canonical.push('}');
    let ask = if install {
        CommandAsk::PluginInstall {
            plugin: plugin.map(String::from),
            dir: dir.map(String::from),
            scope: scope.unwrap_or("user").to_string(),
        }
    } else {
        CommandAsk::PluginUpdate { plugin: plugin.unwrap_or_default().to_string() }
    };
    Ok((ask, canonical))
}

/// A folder path the dialog can show whole: an absolute path (`/…`, `X:\…` or `\\host\…`), not long, with no
/// control, no blank or invisible character, no space but the plain one and never two in a row or at an end,
/// so it cannot pad the text, continue its sentences or reorder it.
fn is_shown_path(path: &str) -> bool {
    let absolute = path.starts_with('/')
        || path.starts_with("\\\\")
        || matches!(path.as_bytes(), [d, b':', b'\\' | b'/', ..] if d.is_ascii_alphabetic());
    absolute
        && path.len() <= 512
        && !path.starts_with(' ')
        && !path.ends_with(' ')
        && !path.contains("  ")
        // A quote would close the one the dialog puts around the path, so the rest of the name would read as prose.
        && !path.contains('"')
        && !path.chars().any(|c| {
            c.is_control()
                || (c.is_whitespace() && c != ' ')
                || matches!(
                    c,
                    '\u{00ad}' | '\u{034f}' | '\u{061c}' | '\u{115f}' | '\u{1160}' | '\u{180e}'
                        | '\u{200b}'..='\u{200f}' | '\u{2028}'..='\u{202e}' | '\u{2060}'..='\u{206f}'
                        | '\u{2800}' | '\u{3164}' | '\u{fe00}'..='\u{fe0f}' | '\u{feff}' | '\u{ffa0}'
                        | '\u{fff9}'..='\u{fffc}' | '\u{e0000}'..='\u{e007f}'
                )
        })
}

/// `https://<host>/<owner>/<repo>/pull/<number>` in the characters of a path: nothing that can pad a line or
/// hide the real host (`@`, `:`, `?`, `#`).
fn is_pull_request_address(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("https://") else { return false };
    let parts: Vec<&str> = rest.split('/').collect();
    let plain = |part: &str, extra: &str| {
        !part.is_empty() && part.chars().all(|c| c.is_ascii_alphanumeric() || extra.contains(c))
    };
    matches!(parts.as_slice(), [host, owner, repo, "pull", number]
        if plain(host, "-.")
            && plain(owner, "-._")
            && plain(repo, "-._")
            && number.chars().all(|c| c.is_ascii_digit())
            && !number.is_empty())
}

/// The words of the system's confirmation: its title and its text, in `lang` ("pt-BR" or English
/// for anything else). Built here from the parsed message, never from text the webview sent.
pub fn confirm_text(ask: &Ask, lang: &str) -> (String, String) {
    let pt = lang == "pt-BR";
    let short = |id: &str| id.chars().take(8).collect::<String>();
    // The fingerprint a person compares across two devices: 16 characters of the key id, in groups of four.
    let fingerprint = |public_key: &str| {
        let der = STANDARD.decode(public_key).unwrap_or_default();
        let id: String = Sha256::digest(der).iter().map(|b| format!("{b:02x}")).collect();
        id.chars().take(16).collect::<Vec<_>>().chunks(4).map(|c| c.iter().collect::<String>()).collect::<Vec<_>>().join("-")
    };
    // A key is shown by the id the device list shows: the SHA-256 of its public form, 8 characters.
    let print = |public_key: &str| {
        let der = STANDARD.decode(public_key).unwrap_or_default();
        short(&Sha256::digest(der).iter().map(|b| format!("{b:02x}")).collect::<String>())
    };
    let mut saves = Vec::new();
    if ask.also.rules {
        saves.push(if pt { "salva regras de permissão" } else { "saves permission rules" });
    }
    if ask.also.input {
        saves.push(if pt { "altera a entrada da ferramenta" } else { "changes the tool's input" });
    }
    if ask.also.message {
        saves.push(if pt { "adiciona uma mensagem" } else { "adds a message" });
    }
    let also = match (saves.is_empty(), pt) {
        (true, _) => String::new(),
        (false, false) => format!(" It also {}.", saves.join(", ")),
        (false, true) => format!(" Também {}.", saves.join(", ")),
    };
    let body = match (ask.kind, pt) {
        (Kind::Approve, false) => format!(
            "Allow request {}?{also} Continue only if you just pressed Approve in Flightdeck.",
            ask.subject
        ),
        (Kind::Approve, true) => format!(
            "Permitir o pedido {}?{also} Continue só se você acabou de apertar Aprovar no Flightdeck.",
            ask.subject
        ),
        (Kind::EnrollFirst, false) => format!(
            "Enroll this device (key {}) as an approver of this host? Continue only if you just started it in Flightdeck.",
            print(&ask.subject)
        ),
        (Kind::EnrollFirst, true) => format!(
            "Cadastrar este dispositivo (chave {}) como aprovador deste host? Continue só se você acabou de iniciar isso no Flightdeck.",
            print(&ask.subject)
        ),
        (Kind::EnrollAdd, false) => format!(
            "Add the device with key {} as an approver of host {}? Continue only if the same code is shown on the other device.",
            fingerprint(&ask.subject),
            short(&ask.host)
        ),
        (Kind::EnrollAdd, true) => format!(
            "Adicionar o dispositivo com a chave {} como aprovador do host {}? Continue só se o mesmo código aparece no outro dispositivo.",
            fingerprint(&ask.subject),
            short(&ask.host)
        ),
        (Kind::Revoke, false) => format!(
            "Remove the device with key {} from the approvers of this host? Continue only if you just asked for it in Flightdeck.",
            short(&ask.subject)
        ),
        (Kind::Revoke, true) => format!(
            "Remover o dispositivo com a chave {} dos aprovadores deste host? Continue só se você acabou de pedir isso no Flightdeck.",
            short(&ask.subject)
        ),
        (Kind::VaultApprove, false) => format!(
            "Allow the use of a secret for request {}, {}? Continue only if you just pressed Approve in Flightdeck.",
            ask.subject,
            if ask.also.session { "for the whole session" } else { "once" }
        ),
        (Kind::VaultApprove, true) => format!(
            "Permitir o uso de um segredo no pedido {}, {}? Continue só se você acabou de apertar Aprovar no Flightdeck.",
            ask.subject,
            if ask.also.session { "durante toda a sessão" } else { "uma vez" }
        ),
        (Kind::Command, _) => match &ask.command {
            Some(CommandAsk::PrMerge { url, head, method }) if pt => format!(
                "Mesclar o pull request {url} no commit {} pelo método {method}? Continue só se você acabou de apertar Mesclar no Flightdeck.",
                short(head)
            ),
            Some(CommandAsk::PrMerge { url, head, method }) => format!(
                "Merge pull request {url} at commit {} by {method}? Continue only if you just pressed Merge in Flightdeck.",
                short(head)
            ),
            Some(CommandAsk::Bypass) if pt => format!(
                "Deixar as sessões do host {} rodarem sem nenhuma verificação de permissão? Continue só se você acabou de ligar isso no Flightdeck.",
                short(&ask.host)
            ),
            Some(CommandAsk::Bypass) => format!(
                "Let sessions on host {} run with every permission check off? Continue only if you just turned this on in Flightdeck.",
                short(&ask.host)
            ),
            Some(CommandAsk::TrustProject { path }) if pt => format!(
                "Confiar em uma pasta de projeto? Os hooks e os servidores dela, e os de tudo o que há dentro dela, vão rodar sem pedir confirmação. Continue só se você acabou de apertar Confiar no Flightdeck.\n\"{path}\""
            ),
            Some(CommandAsk::TrustProject { path }) => format!(
                "Trust a project folder? Its hooks and servers, and those of everything inside it, will run with no prompt. Continue only if you just pressed Trust in Flightdeck.\n\"{path}\""
            ),
            Some(CommandAsk::RootsAdd { path }) if pt => format!(
                "Permitir sessões em uma pasta? Sessões do host {} poderão rodar nela e em tudo o que há dentro dela. Continue só se você acabou de apertar Adicionar às pastas permitidas no Flightdeck.\n\"{path}\"",
                short(&ask.host)
            ),
            Some(CommandAsk::RootsAdd { path }) => format!(
                "Allow sessions in a folder? Sessions on host {} will be able to run in it and in everything inside it. Continue only if you just pressed Add to allowed folders in Flightdeck.\n\"{path}\"",
                short(&ask.host)
            ),
            Some(CommandAsk::ResumeApproval { session }) if pt => format!(
                "Reativar a aprovação automática de uma sessão? Ela volta a aprovar pedidos sem que nenhuma pessoa os veja, depois de ter lido conteúdo de terceiros. Continue só se você acabou de apertar Reativar no Flightdeck.\n\"{session}\""
            ),
            Some(CommandAsk::ResumeApproval { session }) => format!(
                "Turn automatic approval back on for a session? It will approve requests with no person seeing them, after it read third-party content. Continue only if you just pressed Resume in Flightdeck.\n\"{session}\""
            ),
            Some(CommandAsk::HarnessApply { path, parts, template, reformat }) => {
                let names = parts
                    .iter()
                    .map(|part| match (part.as_str(), pt) {
                        ("claudeMd", _) => "CLAUDE.md",
                        ("permissions", true) => "permissões",
                        (other, _) => other,
                    })
                    .collect::<Vec<_>>()
                    .join(", ");
                let hooks = parts.iter().any(|part| part == "hooks");
                let from = match (template, pt) {
                    (Some(id), true) => format!(" do modelo \"{id}\""),
                    (Some(id), false) => format!(" from template \"{id}\""),
                    (None, _) => String::new(),
                };
                let runs = match (hooks, pt) {
                    (true, true) => " Os hooks rodam como comandos em toda sessão do projeto.",
                    (true, false) => " Hooks run as commands in every session of the project.",
                    (false, _) => "",
                };
                let layout = match (*reformat, pt) {
                    (true, true) => " O arquivo de configurações (settings) é reescrito com outro formato.",
                    (true, false) => " The settings file is rewritten with another layout.",
                    (false, _) => "",
                };
                if pt {
                    format!(
                        "Gravar a configuração do Claude Code de um projeto? O host {} grava: {names}{from}.{runs}{layout} Continue só se você acabou de apertar Aplicar a configuração no Flightdeck.\n\"{path}\"",
                        short(&ask.host)
                    )
                } else {
                    format!(
                        "Write the Claude Code setup of a project? Host {} will write: {names}{from}.{runs}{layout} Continue only if you just pressed Apply the setup in Flightdeck.\n\"{path}\"",
                        short(&ask.host)
                    )
                }
            }
            Some(CommandAsk::PluginInstall { plugin, dir, scope }) => {
                let scope = match (scope.as_str(), pt) {
                    ("user", true) => "para você",
                    ("project", true) => "para o projeto",
                    ("local", true) => "só para este projeto, neste computador",
                    ("user", false) => "for you",
                    ("project", false) => "for the project",
                    (_, false) => "for this project on this computer only",
                    (_, true) => "só para este projeto, neste computador",
                };
                match (plugin, dir, pt) {
                    (Some(name), _, true) => format!(
                        "Instalar um plugin? Um plugin roda código neste computador, em suas sessões. O host {} vai instalar \"{name}\" {scope}. Continue só se você acabou de apertar Instalar no Flightdeck.",
                        short(&ask.host)
                    ),
                    (Some(name), _, false) => format!(
                        "Install a plugin? A plugin runs code on this computer, in your sessions. Host {} will install \"{name}\" {scope}. Continue only if you just pressed Install in Flightdeck.",
                        short(&ask.host)
                    ),
                    (None, path, true) => format!(
                        "Instalar um plugin de uma pasta? Um plugin roda código neste computador, em suas sessões. O host {} vai instalar o que está na pasta {scope}. Continue só se você acabou de apertar Instalar no Flightdeck.\n\"{}\"",
                        short(&ask.host),
                        path.as_deref().unwrap_or_default()
                    ),
                    (None, path, false) => format!(
                        "Install a plugin from a folder? A plugin runs code on this computer, in your sessions. Host {} will install what is in the folder {scope}. Continue only if you just pressed Install in Flightdeck.\n\"{}\"",
                        short(&ask.host),
                        path.as_deref().unwrap_or_default()
                    ),
                }
            }
            Some(CommandAsk::PluginUpdate { plugin }) if pt => format!(
                "Atualizar um plugin? O plugin \"{plugin}\" vai passar para o conteúdo que você viu, e um plugin roda código neste computador, em suas sessões. O host {} faz a troca. Continue só se você acabou de apertar Atualizar no Flightdeck.",
                short(&ask.host)
            ),
            Some(CommandAsk::PluginUpdate { plugin }) => format!(
                "Update a plugin? The plugin \"{plugin}\" will change to the content you saw, and a plugin runs code on this computer, in your sessions. Host {} makes the change. Continue only if you just pressed Update in Flightdeck.",
                short(&ask.host)
            ),
            None => String::new(),
        },
    };
    let title = if pt { "Flightdeck: confirmar" } else { "Flightdeck: confirm" };
    (title.to_string(), body)
}

/// The two buttons of the confirmation: the add of a device has its own, so a habit click on "Allow"
/// does not add a device.
pub fn confirm_labels(ask: &Ask, lang: &str) -> (String, String) {
    let (yes, no) = match (ask.kind, lang == "pt-BR") {
        (Kind::Command, pt) if matches!(ask.command, Some(CommandAsk::TrustProject { .. })) => {
            if pt { ("Confiar", "Cancelar") } else { ("Trust", "Cancel") }
        }
        (Kind::Command, pt) if matches!(ask.command, Some(CommandAsk::RootsAdd { .. })) => {
            if pt { ("Adicionar pasta", "Cancelar") } else { ("Add folder", "Cancel") }
        }
        (Kind::Command, pt) if matches!(ask.command, Some(CommandAsk::HarnessApply { .. })) => {
            if pt { ("Gravar configuração", "Cancelar") } else { ("Write setup", "Cancel") }
        }
        (Kind::Command, pt) if matches!(ask.command, Some(CommandAsk::PluginInstall { .. })) => {
            if pt { ("Instalar", "Cancelar") } else { ("Install", "Cancel") }
        }
        (Kind::Command, pt) if matches!(ask.command, Some(CommandAsk::PluginUpdate { .. })) => {
            if pt { ("Atualizar", "Cancelar") } else { ("Update", "Cancel") }
        }
        (Kind::Command, pt) if matches!(ask.command, Some(CommandAsk::ResumeApproval { .. })) => {
            if pt { ("Reativar", "Cancelar") } else { ("Resume", "Cancel") }
        }
        (Kind::EnrollAdd, false) => ("Add device", "Cancel"),
        (Kind::EnrollAdd, true) => ("Adicionar dispositivo", "Cancelar"),
        (Kind::Command, false) if ask.command == Some(CommandAsk::Bypass) => ("Turn on", "Cancel"),
        (Kind::Command, true) if ask.command == Some(CommandAsk::Bypass) => ("Ligar", "Cancelar"),
        (Kind::Command, false) => ("Merge", "Cancel"),
        (Kind::Command, true) => ("Mesclar", "Cancelar"),
        (_, false) => ("Allow", "Cancel"),
        (_, true) => ("Permitir", "Cancelar"),
    };
    (yes.to_string(), no.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{engine::general_purpose::STANDARD, Engine};
    use p256::ecdsa::{signature::Verifier, Signature, VerifyingKey};
    use p256::pkcs8::DecodePublicKey;
    use sha2::{Digest, Sha256};

    const DAEMON: &str = "daemon-0123456789";

    #[test]
    fn a_key_has_a_32_byte_scalar_and_a_new_one_each_time() {
        let a = generate();
        assert_eq!(STANDARD.decode(&a).unwrap().len(), 32);
        assert_ne!(a, generate());
    }

    #[test]
    fn the_public_forms_are_the_spki_der_and_its_sha256() {
        let info = public_info(&generate()).unwrap();
        let der = STANDARD.decode(&info.public_key).unwrap();
        // SPKI of a P-256 key: the fixed 26-byte header, then the 65-byte uncompressed point.
        assert_eq!(der.len(), 91);
        assert_eq!(&der[..2], &[0x30, 0x59]);
        let hex: String = Sha256::digest(&der).iter().map(|b| format!("{b:02x}")).collect();
        assert_eq!(info.key_id, hex);
    }

    #[test]
    fn a_signature_is_64_bytes_and_verifies_with_the_public_key() {
        let secret = generate();
        let info = public_info(&secret).unwrap();
        let sig = STANDARD.decode(sign(&secret, "[\"x\"]").unwrap()).unwrap();
        assert_eq!(sig.len(), 64);
        let key = VerifyingKey::from_public_key_der(&STANDARD.decode(&info.public_key).unwrap())
            .unwrap();
        assert!(key
            .verify(b"[\"x\"]", &Signature::from_slice(&sig).unwrap())
            .is_ok());
        assert!(key.verify(b"[\"y\"]", &Signature::from_slice(&sig).unwrap()).is_err());
    }

    #[test]
    fn a_secret_that_is_not_a_scalar_is_refused() {
        assert!(public_info("not base64 !!").is_err());
        assert!(sign(&STANDARD.encode([1u8; 5]), "m").is_err());
    }

    fn own() -> PublicInfo {
        public_info(&generate()).unwrap()
    }

    fn also_all() -> Also {
        Also { rules: true, input: true, message: true, session: false }
    }

    /// An approval text for `id`, carrying the hashes of the saved rules, the input and the message.
    fn approval(me: &PublicInfo, id: &str, rules: &str, input: &str, message: &str) -> String {
        serde_json::to_string(&[
            "flightdeck/approval/v1", &me.key_id, DAEMON, id, "n", "allow", &sha256_hex(rules), &sha256_hex(input),
            &sha256_hex(message),
        ])
        .unwrap()
    }

    #[test]
    fn an_approval_names_its_request() {
        let me = own();
        let m = format!(
            "[\"flightdeck/approval/v1\",\"{}\",\"{DAEMON}\",\"ext-7\",\"n\",\"allow\",\"a\",\"b\",\"c\"]",
            me.key_id
        );
        assert_eq!(
            describe(&m, DAEMON, &me).unwrap(),
            Ask { kind: Kind::Approve, host: DAEMON.into(), subject: "ext-7".into(), also: also_all(), command: None }
        );
    }

    #[test]
    fn a_first_enrollment_must_be_of_this_key() {
        let me = own();
        let ok = format!(
            "[\"flightdeck/enroll-first/v1\",\"{DAEMON}\",\"n\",\"{}\",\"h\"]",
            me.public_key
        );
        assert_eq!(describe(&ok, DAEMON, &me).unwrap().kind, Kind::EnrollFirst);
        let other = "[\"flightdeck/enroll-first/v1\",\"daemon-0123456789\",\"n\",\"AAAA\",\"h\"]";
        assert!(describe(other, DAEMON, &me).is_err());
    }

    #[test]
    fn revoking_names_the_other_key() {
        let me = own();
        let rv = format!(
            "[\"flightdeck/revoke/v1\",\"{}\",\"{DAEMON}\",\"n\",\"abc123\"]",
            me.key_id
        );
        assert_eq!(
            describe(&rv, DAEMON, &me).unwrap(),
            Ask { kind: Kind::Revoke, host: DAEMON.into(), subject: "abc123".into(), also: Also::default(), command: None }
        );
    }

    #[test]
    fn what_the_key_must_never_sign_is_refused() {
        let me = own();
        let refused = [
            // Another tag, a tag from another protocol, plain text and a wrong shape.
            format!("[\"flightdeck/approval/v2\",\"{}\",\"{DAEMON}\",\"r\",\"n\",\"allow\",\"a\",\"b\",\"c\"]", me.key_id),
            "hello".to_string(),
            "{\"a\":1}".to_string(),
            "[1,2]".to_string(),
            "[]".to_string(),
            // Another host.
            format!("[\"flightdeck/approval/v1\",\"{}\",\"other-host\",\"r\",\"n\",\"allow\",\"a\",\"b\",\"c\"]", me.key_id),
            // Made for another key.
            format!("[\"flightdeck/approval/v1\",\"{}\",\"{DAEMON}\",\"r\",\"n\",\"allow\",\"a\",\"b\",\"c\"]", "f".repeat(64)),
            // Not an allow.
            format!("[\"flightdeck/approval/v1\",\"{}\",\"{DAEMON}\",\"r\",\"n\",\"deny\",\"a\",\"b\",\"c\"]", me.key_id),
            // Wrong length.
            format!("[\"flightdeck/revoke/v1\",\"{}\",\"{DAEMON}\",\"n\"]", me.key_id),
            format!("[\"flightdeck/revoke/v1\",\"{}\",\"{DAEMON}\",\"n\",\"t\",\"extra\"]", me.key_id),
            // A part that is not a string.
            format!("[\"flightdeck/revoke/v1\",\"{}\",\"{DAEMON}\",\"n\",7]", me.key_id),
        ];
        for m in refused {
            assert!(describe(&m, DAEMON, &me).is_err(), "signed: {m}");
        }
    }

    #[test]
    fn the_confirmation_names_the_action_and_its_subject_in_both_languages() {
        let approve = Ask { kind: Kind::Approve, host: DAEMON.into(), subject: "ext-7".into(), also: Also::default(), command: None };
        let (title, body) = confirm_text(&approve, "en");
        assert!(title.contains("Flightdeck"));
        assert!(body.contains("ext-7") && body.contains("just pressed"));
        let (_, body_pt) = confirm_text(&approve, "pt-BR");
        assert!(body_pt.contains("ext-7") && body_pt.contains("acabou de apertar"));
        let revoke = Ask { kind: Kind::Revoke, host: DAEMON.into(), subject: "0123456789abcdef".into(), also: Also::default(), command: None };
        assert!(confirm_text(&revoke, "en").1.contains("01234567"));
        assert!(!confirm_text(&revoke, "en").1.contains("0123456789abcdef"));
    }

    #[test]
    fn an_enrollment_shows_the_fingerprint_of_the_key_not_its_text() {
        let info = public_info(&generate()).unwrap();
        let first = Ask { kind: Kind::EnrollFirst, host: DAEMON.into(), subject: info.public_key.clone(), also: Also::default(), command: None };
        let body = confirm_text(&first, "en").1;
        assert!(body.contains(&info.key_id[..8]));
        assert!(!body.contains(&info.public_key));
    }

    #[test]
    fn an_allow_that_saves_rules_or_rewrites_the_input_says_so_in_the_dialog() {
        let me = own();
        let plain = approval(&me, "ext-7", "[]", "null", "");
        let ask = describe(&plain, DAEMON, &me).unwrap();
        assert_eq!(ask.also, Also::default());
        assert!(!confirm_text(&ask, "en").1.contains("also"));
        let rules = describe(&approval(&me, "ext-7", "[{\"a\":1}]", "null", ""), DAEMON, &me).unwrap();
        assert_eq!(rules.also, Also { rules: true, input: false, message: false, session: false });
        assert!(confirm_text(&rules, "en").1.contains("saves permission rules"));
        assert!(confirm_text(&rules, "pt-BR").1.contains("salva regras de permissão"));
        let input = describe(&approval(&me, "ext-7", "[]", "{\"c\":\"x\"}", "hi"), DAEMON, &me).unwrap();
        assert_eq!(input.also, Also { rules: false, input: true, message: true, session: false });
        let body = confirm_text(&input, "en").1;
        assert!(body.contains("changes the tool's input") && body.contains("adds a message"));
    }

    #[test]
    fn a_request_id_that_could_pad_or_fake_the_dialog_is_refused() {
        let me = own();
        for id in ["", "ext 7", "ext-7\nVerified safe", &"r".repeat(65), "ext-7;"] {
            assert!(describe(&approval(&me, id, "[]", "null", ""), DAEMON, &me).is_err(), "signed: {id:?}");
        }
        assert!(describe(&approval(&me, "ext-7:a.b_c", "[]", "null", ""), DAEMON, &me).is_ok());
    }

    #[test]
    fn a_text_far_longer_than_any_the_protocol_builds_is_refused() {
        let me = own();
        let padded = format!(
            "[\"flightdeck/approval/v1\",\"{}\",\"{DAEMON}\",\"ext-7\",\"{}\",\"allow\",\"a\",\"b\",\"c\"]",
            me.key_id,
            "n".repeat(5000)
        );
        assert!(describe(&padded, DAEMON, &me).is_err());
    }

    /// The text an enrolled device signs to add `new`.
    fn add(signer: &str, host: &str, new: &str) -> String {
        serde_json::to_string(&["flightdeck/enroll-add/v1", signer, host, "n", new]).unwrap()
    }

    #[test]
    fn an_enrolled_device_signs_the_add_of_another_key_for_this_host() {
        let me = own();
        let other = own();
        let asked = describe(&add(&me.key_id, DAEMON, &other.public_key), DAEMON, &me);
        assert!(asked.is_ok(), "an add by this device is signed: {asked:?}");
        let ask = asked.unwrap();
        assert_eq!(ask.kind, Kind::EnrollAdd);
        assert_eq!(ask.subject, other.public_key);
    }

    #[test]
    fn an_add_for_another_host_another_signer_or_this_key_is_not_signed() {
        let me = own();
        let other = own();
        assert!(describe(&add(&me.key_id, "daemon-other-host", &other.public_key), DAEMON, &me).is_err());
        assert!(describe(&add(&other.key_id, DAEMON, &other.public_key), DAEMON, &me).is_err());
        assert!(describe(&add(&me.key_id, DAEMON, &me.public_key), DAEMON, &me).is_err());
    }

    #[test]
    fn an_add_for_a_host_id_that_could_fake_a_dialog_line_is_not_signed() {
        let me = own();
        let other = own();
        for host in ["line\nbreak-host", "\u{202e}evil-host", "spaced host", ""] {
            assert!(describe(&add(&me.key_id, host, &other.public_key), host, &me).is_err(), "signed: {host:?}");
        }
    }

    #[test]
    fn an_add_of_something_that_is_not_a_p256_key_is_not_signed() {
        let me = own();
        for new in ["", "AAAA", "not base64 at all", &"A".repeat(200)] {
            assert!(describe(&add(&me.key_id, DAEMON, new), DAEMON, &me).is_err(), "signed: {new:?}");
        }
    }

    #[test]
    fn the_dialog_of_an_add_names_the_new_key_by_sixteen_characters_in_groups() {
        let me = own();
        let other = own();
        let asked = describe(&add(&me.key_id, DAEMON, &other.public_key), DAEMON, &me);
        assert!(asked.is_ok(), "an add by this device is signed: {asked:?}");
        let ask = asked.unwrap();
        let id = &other.key_id;
        let print = format!("{}-{}-{}-{}", &id[0..4], &id[4..8], &id[8..12], &id[12..16]);
        let en = confirm_text(&ask, "en").1;
        assert!(en.contains(&print), "{en}");
        assert!(en.contains("Add the device"), "{en}");
        let pt = confirm_text(&ask, "pt-BR").1;
        assert!(pt.contains(&print), "{pt}");
        assert!(pt.contains("Adicionar o dispositivo"), "{pt}");
        assert!(!en.contains(&id[0..20]), "more than the fingerprint: {en}");
    }

    #[test]
    fn the_dialog_of_an_add_names_the_host_it_is_for_and_has_buttons_of_its_own() {
        let me = own();
        let other = own();
        let ask = describe(&add(&me.key_id, DAEMON, &other.public_key), DAEMON, &me).unwrap();
        assert_eq!(ask.host, DAEMON);
        assert!(confirm_text(&ask, "en").1.contains("host daemon-0"), "{}", confirm_text(&ask, "en").1);
        assert!(confirm_text(&ask, "pt-BR").1.contains("host daemon-0"));
        assert_eq!(confirm_labels(&ask, "en"), ("Add device".to_string(), "Cancel".to_string()));
        assert_eq!(confirm_labels(&ask, "pt-BR").0, "Adicionar dispositivo");
        assert_eq!(confirm_labels(&of_kind(Kind::Approve), "en").0, "Allow");
        assert_eq!(confirm_labels(&of_kind(Kind::Revoke), "pt-BR").0, "Permitir");
    }

    #[test]
    fn this_devices_own_key_in_another_encoding_is_not_added_as_another() {
        let me = own();
        let mut der = STANDARD.decode(&me.public_key).unwrap();
        // The compressed SPKI of the same point: the point's x, and the parity of y in the prefix.
        let parity = 2 + (der[90] & 1);
        let x: Vec<u8> = der[27..59].to_vec();
        der.truncate(26);
        der[1] = 0x39;
        der[24] = 0x22;
        der.push(parity);
        der.extend(x);
        let compressed = STANDARD.encode(&der);
        assert_ne!(compressed, me.public_key);
        assert!(describe(&add(&me.key_id, DAEMON, &compressed), DAEMON, &me).is_err());
    }

    /// A vault-approve text (#3452): tag, key id, host, request id, nonce, scope.
    fn vault(me: &PublicInfo, host: &str, id: &str, scope: &str) -> String {
        serde_json::to_string(&["flightdeck/vault-approve/v1", &me.key_id, host, id, "n", scope]).unwrap()
    }

    #[test]
    fn a_vault_approve_names_its_request_and_scope() {
        let me = own();
        assert_eq!(
            describe(&vault(&me, DAEMON, "act-7", "once"), DAEMON, &me),
            Ok(Ask { kind: Kind::VaultApprove, host: DAEMON.into(), subject: "act-7".into(), also: Also::default(), command: None })
        );
        let session = describe(&vault(&me, DAEMON, "act-7", "session"), DAEMON, &me).unwrap();
        assert!(session.kind == Kind::VaultApprove && session.also.session);
    }

    #[test]
    fn a_vault_approve_for_another_host_key_scope_or_id_is_not_signed() {
        let me = own();
        let other = own();
        assert!(describe(&vault(&me, DAEMON, "act-7", "once"), DAEMON, &me).is_ok());
        for text in [
            vault(&me, "another-host", "act-7", "once"),
            vault(&other, DAEMON, "act-7", "once"),
            vault(&me, DAEMON, "act-7", "forever"),
            vault(&me, DAEMON, "act-7", ""),
            vault(&me, DAEMON, "act 7\nAllow", "once"),
            vault(&me, DAEMON, "", "once"),
        ] {
            assert!(describe(&text, DAEMON, &me).is_err(), "{text}");
        }
        let short = serde_json::to_string(&["flightdeck/vault-approve/v1", &me.key_id, DAEMON, "act-7", "n"]).unwrap();
        assert!(describe(&short, DAEMON, &me).is_err());
    }

    #[test]
    fn the_dialog_of_a_vault_approve_says_a_secret_is_used_and_for_how_long() {
        let me = own();
        let once = describe(&vault(&me, DAEMON, "act-7", "once"), DAEMON, &me).unwrap();
        let session = describe(&vault(&me, DAEMON, "act-7", "session"), DAEMON, &me).unwrap();
        let (_, en) = confirm_text(&once, "en");
        assert!(en.contains("secret") && en.contains("act-7") && en.contains("once"), "{en}");
        let (_, pt) = confirm_text(&session, "pt-BR");
        assert!(pt.contains("segredo") && pt.contains("act-7") && pt.contains("sessão"), "{pt}");
        assert_eq!(confirm_labels(&of_kind(Kind::VaultApprove), "en").0, "Allow");
    }

    /// The payload a merge signs, in canonical form, and the hash both sides share (the protocol test asserts the same two literals).
    const MERGE_PAYLOAD: &str = "{\"cardId\":\"c1\",\"confirm\":true,\"headSha\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"method\":\"squash\",\"prUrl\":\"https://github.com/acme/repo/pull/9\"}";
    const MERGE_HASH: &str = "ab4ff38dd49488370b26c6082bcce7b9c06e7126faaf113cc562ef156d7c1e8e";

    /// An ask of `kind` that carries nothing: enough to read the labels of its dialog.
    fn of_kind(kind: Kind) -> Ask {
        Ask { kind, host: DAEMON.into(), subject: "s".into(), also: Also::default(), command: None }
    }

    /// A command text (#3453): tag, key id, host, command, nonce, hash of the payload.
    fn command(me: &PublicInfo, host: &str, name: &str, payload: &str) -> String {
        serde_json::to_string(&["flightdeck/command/v1", &me.key_id, host, name, "n", &sha256_hex(payload)]).unwrap()
    }

    fn merge_ask() -> Ask {
        Ask {
            kind: Kind::Command,
            host: DAEMON.into(),
            subject: "card.pr.merge".into(),
            also: Also::default(),
            command: Some(CommandAsk::PrMerge {
                url: "https://github.com/acme/repo/pull/9".into(),
                head: "a".repeat(40),
                method: "squash".into(),
            }),
        }
    }

    #[test]
    fn the_shared_vector_hashes_the_same_in_both_languages() {
        assert_eq!(sha256_hex(MERGE_PAYLOAD), MERGE_HASH);
    }

    #[test]
    fn a_merge_is_read_from_its_payload_after_the_hash_matches() {
        let me = own();
        let text = command(&me, DAEMON, "card.pr.merge", MERGE_PAYLOAD);
        assert_eq!(describe_with(&text, DAEMON, &me, Some(MERGE_PAYLOAD)), Ok(merge_ask()));
    }

    #[test]
    fn a_merge_payload_in_another_key_order_is_read_in_canonical_order_and_still_matches() {
        let me = own();
        let shuffled = "{\"prUrl\":\"https://github.com/acme/repo/pull/9\",\"method\":\"squash\",\"headSha\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"confirm\":true,\"cardId\":\"c1\"}";
        let text = command(&me, DAEMON, "card.pr.merge", MERGE_PAYLOAD);
        assert_eq!(describe_with(&text, DAEMON, &me, Some(shuffled)), Ok(merge_ask()));
    }

    #[test]
    fn a_command_whose_payload_is_not_the_one_hashed_is_not_signed() {
        let me = own();
        let text = command(&me, DAEMON, "card.pr.merge", MERGE_PAYLOAD);
        let moved = MERGE_PAYLOAD.replace(&"a".repeat(40), &"b".repeat(40));
        assert!(describe_with(&text, DAEMON, &me, Some(&moved)).is_err());
        assert!(describe_with(&text, DAEMON, &me, None).is_err());
        assert!(describe(&text, DAEMON, &me).is_err());
    }

    #[test]
    fn a_merge_payload_that_the_dialog_could_not_show_is_not_signed() {
        let me = own();
        let good = |change: &dyn Fn(&str) -> String| {
            let payload = change(MERGE_PAYLOAD);
            describe_with(&command(&me, DAEMON, "card.pr.merge", &payload), DAEMON, &me, Some(&payload))
        };
        assert!(good(&|p| p.to_string()).is_ok());
        let changes: Vec<Box<dyn Fn(&str) -> String>> = vec![
            // A field the dialog does not say, a field gone, a method it does not know, no confirm.
            Box::new(|p| p.replace("{", "{\"deleteBranch\":true,")),
            Box::new(|p| p.replace("\"cardId\":\"c1\",", "")),
            Box::new(|p| p.replace("squash", "rebase")),
            Box::new(|p| p.replace("true", "false")),
            // A head that is not a commit hash, an address that is not plain, a card id that is not an id.
            Box::new(|p| p.replace(&"a".repeat(40), "--delete-branch")),
            Box::new(|p| p.replace("pull/9", "pull/9 \\n Allow everything")),
            Box::new(|p| p.replace("https://github.com", "javascript:alert(1)//")),
            // An address whose real host is not the one it reads as, or that is not a pull request's page.
            Box::new(|p| p.replace("https://github.com", "https://github.com:x@evil.example")),
            Box::new(|p| p.replace("pull/9", "pull/9?x=1")),
            Box::new(|p| p.replace("pull/9", "pull/9#top")),
            Box::new(|p| p.replace("pull/9", "issues/9")),
            Box::new(|p| p.replace("\"c1\"", "\"c1\\nAllow\"")),
            Box::new(|p| format!("{}{}", &p[..p.len() - 1], ",\"proof\":{}}")),
            Box::new(|p| format!("[{p}]")),
        ];
        for change in changes {
            assert!(good(&*change).is_err(), "signed: {}", change(MERGE_PAYLOAD));
        }
    }

    #[test]
    fn a_command_for_another_host_key_or_a_command_it_does_not_know_is_not_signed() {
        let me = own();
        let other = own();
        for text in [
            command(&me, "another-host", "card.pr.merge", MERGE_PAYLOAD),
            command(&other, DAEMON, "card.pr.merge", MERGE_PAYLOAD),
            command(&me, DAEMON, "session.start", MERGE_PAYLOAD),
        ] {
            assert!(describe_with(&text, DAEMON, &me, Some(MERGE_PAYLOAD)).is_err(), "{text}");
        }
    }

    #[test]
    fn the_dialog_of_a_merge_names_the_pull_request_the_commit_and_the_method() {
        let (_, en) = confirm_text(&merge_ask(), "en");
        assert!(
            en.contains("https://github.com/acme/repo/pull/9") && en.contains("aaaaaaaa") && en.contains("squash"),
            "{en}"
        );
        assert!(!en.contains(&"a".repeat(40)), "the head is shown short: {en}");
        let (_, pt) = confirm_text(&merge_ask(), "pt-BR");
        assert!(pt.contains("pull/9") && pt.contains("squash") && pt.contains("Flightdeck"), "{pt}");
        assert_eq!(confirm_labels(&merge_ask(), "en").0, "Merge");
        assert_eq!(confirm_labels(&merge_ask(), "pt-BR").0, "Mesclar");
    }

    /// The payload a bypass turn-on signs, and the hash both sides share (the protocol test asserts the same canonical text).
    const BYPASS_PAYLOAD: &str = "{\"allow\":true,\"confirm\":true}";
    const BYPASS_HASH: &str = "2ce79890e0ec3a64a198f2d1f21fab775c0f33e6bbccb797ed642ba413136f67";

    fn bypass_ask() -> Ask {
        Ask {
            kind: Kind::Command,
            host: DAEMON.into(),
            subject: "host.bypass".into(),
            also: Also::default(),
            command: Some(CommandAsk::Bypass),
        }
    }

    /// The payload that trusts a folder, in canonical form with a path of the characters a real one holds
    /// (a backslash, accents), and the hash both sides share (the protocol test asserts the same two literals).
    const TRUST_PAYLOAD: &str = "{\"path\":\"C:\\\\Users\\\\José\\\\código\",\"trusted\":true}";
    const TRUST_HASH: &str = "3e9907a6f46d40d59cbc41b9cd51ddc6b2c11c1ca2195fedc491e9f0643ec51f";

    fn trust_ask() -> Ask {
        Ask {
            kind: Kind::Command,
            host: DAEMON.into(),
            subject: "project.trust.set".into(),
            also: Also::default(),
            command: Some(CommandAsk::TrustProject { path: "C:\\Users\\José\\código".into() }),
        }
    }

    #[test]
    fn a_bypass_turn_on_is_read_from_its_payload_in_any_key_order() {
        let me = own();
        assert_eq!(sha256_hex(BYPASS_PAYLOAD), BYPASS_HASH);
        let text = command(&me, DAEMON, "host.bypass", BYPASS_PAYLOAD);
        assert_eq!(describe_with(&text, DAEMON, &me, Some(BYPASS_PAYLOAD)), Ok(bypass_ask()));
        let shuffled = "{\"confirm\":true,\"allow\":true}";
        assert_eq!(describe_with(&text, DAEMON, &me, Some(shuffled)), Ok(bypass_ask()));
    }

    #[test]
    fn a_bypass_payload_that_is_not_a_confirmed_turn_on_is_not_signed() {
        let me = own();
        for payload in [
            "{\"allow\":false,\"confirm\":true}",
            "{\"allow\":true,\"confirm\":false}",
            "{\"allow\":true}",
            "{\"allow\":\"true\",\"confirm\":true}",
            "{\"allow\":true,\"confirm\":true,\"path\":\"/\"}",
            "{\"allow\":true,\"confirm\":true,\"proof\":{}}",
            "[{\"allow\":true,\"confirm\":true}]",
        ] {
            // The payload guard itself, not the hash check that would refuse it anyway.
            assert!(read_command("host.bypass", payload).is_err(), "read: {payload}");
            let text = command(&me, DAEMON, "host.bypass", payload);
            assert!(describe_with(&text, DAEMON, &me, Some(payload)).is_err(), "signed: {payload}");
        }
    }

    #[test]
    fn a_bypass_payload_is_signed_only_under_its_own_command_name() {
        let me = own();
        let under_merge = command(&me, DAEMON, "card.pr.merge", BYPASS_PAYLOAD);
        assert!(describe_with(&under_merge, DAEMON, &me, Some(BYPASS_PAYLOAD)).is_err());
        let merge_under_bypass = command(&me, DAEMON, "host.bypass", MERGE_PAYLOAD);
        assert!(describe_with(&merge_under_bypass, DAEMON, &me, Some(MERGE_PAYLOAD)).is_err());
        // The signer hashes the canonical form it builds, so a spaced spelling of the same payload is the same ask.
        let spaced = "{\"allow\": true, \"confirm\": true}";
        let text = command(&me, DAEMON, "host.bypass", BYPASS_PAYLOAD);
        assert_eq!(describe_with(&text, DAEMON, &me, Some(spaced)), Ok(bypass_ask()));
    }

    #[test]
    fn a_command_dialog_does_not_name_a_host_that_is_not_an_id() {
        let me = own();
        let host = "ab\ncd-padding";
        let text = command(&me, host, "host.bypass", BYPASS_PAYLOAD);
        assert!(describe_with(&text, host, &me, Some(BYPASS_PAYLOAD)).is_err());
    }

    #[test]
    fn the_dialog_of_a_bypass_turn_on_names_the_host_and_has_its_own_buttons() {
        let (_, en) = confirm_text(&bypass_ask(), "en");
        assert!(en.contains("permission check") && en.contains(&DAEMON[..8]), "{en}");
        let (_, pt) = confirm_text(&bypass_ask(), "pt-BR");
        assert!(pt.contains("verificação de permissão") && pt.contains("Flightdeck"), "{pt}");
        assert_eq!(confirm_labels(&bypass_ask(), "en").0, "Turn on");
        assert_eq!(confirm_labels(&bypass_ask(), "pt-BR").0, "Ligar");
    }

    #[test]
    fn the_trust_vector_hashes_the_same_in_both_languages() {
        assert_eq!(sha256_hex(TRUST_PAYLOAD), TRUST_HASH);
    }

    #[test]
    fn trusting_a_folder_is_read_from_its_payload_after_the_hash_matches() {
        let me = own();
        let text = command(&me, DAEMON, "project.trust.set", TRUST_PAYLOAD);
        assert_eq!(describe_with(&text, DAEMON, &me, Some(TRUST_PAYLOAD)), Ok(trust_ask()));
        let shuffled = "{\"trusted\":true,\"path\":\"C:\\\\Users\\\\José\\\\código\"}";
        assert_eq!(describe_with(&text, DAEMON, &me, Some(shuffled)), Ok(trust_ask()));
    }

    #[test]
    fn a_trust_payload_that_the_dialog_could_not_show_is_not_signed() {
        let me = own();
        let signed = |payload: &str| {
            describe_with(&command(&me, DAEMON, "project.trust.set", payload), DAEMON, &me, Some(payload))
        };
        let long = format!("{{\"path\":\"/{}\",\"trusted\":true}}", "a".repeat(900));
        for bad in [
            // Revoking is open and is never signed; a field the dialog does not say; no path; an empty path.
            "{\"path\":\"/work/app\",\"trusted\":false}".to_string(),
            "{\"path\":\"/work/app\",\"trusted\":true,\"confirm\":true}".to_string(),
            "{\"trusted\":true}".to_string(),
            "{\"path\":\"\",\"trusted\":true}".to_string(),
            "{\"path\":7,\"trusted\":true}".to_string(),
            // A line break or a text-direction mark could pad or reorder what the dialog says.
            "{\"path\":\"/work/app\\nAllow everything\",\"trusted\":true}".to_string(),
            "{\"path\":\"/work/\\u202eppa\",\"trusted\":true}".to_string(),
            "{\"path\":\"/work/\\u2028app\",\"trusted\":true}".to_string(),
            "{\"path\":\"/work/\\u200bapp\",\"trusted\":true}".to_string(),
            // Blank or invisible characters that are not controls, a run of spaces, text that is no absolute path.
            "{\"path\":\"/work/\\u00a0app\",\"trusted\":true}".to_string(),
            "{\"path\":\"/work/\\u3000app\",\"trusted\":true}".to_string(),
            "{\"path\":\"/work/\\u2060app\",\"trusted\":true}".to_string(),
            "{\"path\":\"/work/\\ufe0fapp\",\"trusted\":true}".to_string(),
            "{\"path\":\"/work/app  Nothing will run\",\"trusted\":true}".to_string(),
            "{\"path\":\"/work/app \",\"trusted\":true}".to_string(),
            "{\"path\":\"work/app\",\"trusted\":true}".to_string(),
            "{\"path\":\"Nothing will run\",\"trusted\":true}".to_string(),
            long,
        ] {
            assert!(signed(&bad).is_err(), "signed: {bad}");
        }
        assert!(signed("{\"path\":\"/work/app\",\"trusted\":true}").is_ok());
        assert!(signed("{\"path\":\"/work/my app\",\"trusted\":true}").is_ok());
        assert!(signed("{\"path\":\"\\\\\\\\host\\\\share\\\\app\",\"trusted\":true}").is_ok());
    }

    #[test]
    fn the_dialog_of_a_trust_names_the_folder_and_what_trusting_lets_run_and_has_a_button_of_its_own() {
        let (_, en) = confirm_text(&trust_ask(), "en");
        assert!(en.contains("C:\\Users\\José\\código") && en.contains("hooks"), "{en}");
        let (_, pt) = confirm_text(&trust_ask(), "pt-BR");
        assert!(pt.contains("José") && pt.contains("hooks") && pt.contains("Flightdeck"), "{pt}");
        // The fixed warning comes first and the folder last, on a line of its own and in quotes, so a path
        // cannot pad or continue the sentences that say what trusting does.
        assert!(en.starts_with("Trust a project folder?"), "{en}");
        assert!(en.ends_with("\n\"C:\\Users\\José\\código\""), "{en}");
        assert!(pt.starts_with("Confiar em uma pasta de projeto?"), "{pt}");
        // Trusting a folder trusts what is inside it too: the dialog says so.
        assert!(en.contains("everything inside it") && pt.contains("tudo o que há dentro dela"), "{en} {pt}");
        assert_eq!(confirm_labels(&trust_ask(), "en").0, "Trust");
        assert_eq!(confirm_labels(&trust_ask(), "pt-BR").0, "Confiar");
    }

    /// The payload that resumes the automatic approver of a session, in canonical form, and the hash both sides
    /// share (the protocol test asserts the same two literals).
    const RESUME_PAYLOAD: &str = "{\"confirm\":true,\"sessionKey\":\"card:c1\"}";
    const RESUME_HASH: &str = "e0a91d4acb8e261e30090aa274dad9660a38643c12544415b7fc128214ff6e00";

    fn resume_ask() -> Ask {
        Ask {
            kind: Kind::Command,
            host: DAEMON.into(),
            subject: "autoapprove.resume".into(),
            also: Also::default(),
            command: Some(CommandAsk::ResumeApproval { session: "card:c1".into() }),
        }
    }

    #[test]
    fn the_resume_vector_hashes_the_same_in_both_languages() {
        assert_eq!(sha256_hex(RESUME_PAYLOAD), RESUME_HASH);
    }

    #[test]
    fn resuming_a_session_is_read_from_its_payload_after_the_hash_matches() {
        let me = own();
        let text = command(&me, DAEMON, "autoapprove.resume", RESUME_PAYLOAD);
        assert_eq!(describe_with(&text, DAEMON, &me, Some(RESUME_PAYLOAD)), Ok(resume_ask()));
        let shuffled = "{\"sessionKey\":\"card:c1\",\"confirm\":true}";
        assert_eq!(describe_with(&text, DAEMON, &me, Some(shuffled)), Ok(resume_ask()));
    }

    #[test]
    fn a_resume_payload_that_the_dialog_could_not_show_is_not_signed() {
        let me = own();
        let signed = |payload: &str| {
            describe_with(&command(&me, DAEMON, "autoapprove.resume", payload), DAEMON, &me, Some(payload))
        };
        let long = format!("{{\"confirm\":true,\"sessionKey\":\"{}\"}}", "a".repeat(200));
        for bad in [
            // No confirm, a false one, a field the dialog does not say, no key, an empty key, a key that is no text.
            "{\"sessionKey\":\"card:c1\"}".to_string(),
            "{\"confirm\":false,\"sessionKey\":\"card:c1\"}".to_string(),
            "{\"confirm\":true,\"sessionKey\":\"card:c1\",\"extra\":1}".to_string(),
            "{\"confirm\":true}".to_string(),
            "{\"confirm\":true,\"sessionKey\":\"\"}".to_string(),
            "{\"confirm\":true,\"sessionKey\":7}".to_string(),
            // A key is a plain token: a space, a line break, a mark or a quote could pad or continue the dialog.
            "{\"confirm\":true,\"sessionKey\":\"card c1\"}".to_string(),
            "{\"confirm\":true,\"sessionKey\":\"card:c1\\nAllow\"}".to_string(),
            "{\"confirm\":true,\"sessionKey\":\"card:\\u202ec1\"}".to_string(),
            "{\"confirm\":true,\"sessionKey\":\"card:\\u00a0c1\"}".to_string(),
            "{\"confirm\":true,\"sessionKey\":\"card:\\\"c1\"}".to_string(),
            long,
        ] {
            assert!(signed(&bad).is_err(), "signed: {bad}");
        }
        assert!(signed("{\"confirm\":true,\"sessionKey\":\"3f2c9a1e-7d44-4b6e-9d10-5a8e2b7c4f60\"}").is_ok());
    }

    #[test]
    fn the_dialog_of_a_resume_names_the_session_and_what_resuming_lets_happen_and_has_a_button_of_its_own() {
        let (_, en) = confirm_text(&resume_ask(), "en");
        assert!(en.starts_with("Turn automatic approval back on"), "{en}");
        assert!(en.contains("no person") && en.ends_with("\n\"card:c1\""), "{en}");
        let (_, pt) = confirm_text(&resume_ask(), "pt-BR");
        assert!(pt.starts_with("Reativar a aprovação automática") && pt.ends_with("\n\"card:c1\""), "{pt}");
        assert_eq!(confirm_labels(&resume_ask(), "en").0, "Resume");
        assert_eq!(confirm_labels(&resume_ask(), "pt-BR").0, "Reativar");
    }

    /// The payload that adds an allowed folder, in canonical form (`confirm` before `path`) with a path of the
    /// characters a real one holds, and the hash both sides share (the protocol test asserts the same two literals).
    const ROOTS_PAYLOAD: &str = "{\"confirm\":true,\"path\":\"C:\\\\Users\\\\José\\\\código\"}";
    const ROOTS_HASH: &str = "33ef725f8a057e6ba6c4a7a90ef156230c763669d969fb952c2e86b020f2ff8c";

    fn roots_ask() -> Ask {
        Ask {
            kind: Kind::Command,
            host: DAEMON.into(),
            subject: "roots.add".into(),
            also: Also::default(),
            command: Some(CommandAsk::RootsAdd { path: "C:\\Users\\José\\código".into() }),
        }
    }

    #[test]
    fn the_roots_vector_hashes_the_same_in_both_languages() {
        assert_eq!(sha256_hex(ROOTS_PAYLOAD), ROOTS_HASH);
    }

    #[test]
    fn adding_a_folder_is_read_from_its_payload_after_the_hash_matches() {
        let me = own();
        let text = command(&me, DAEMON, "roots.add", ROOTS_PAYLOAD);
        assert_eq!(describe_with(&text, DAEMON, &me, Some(ROOTS_PAYLOAD)), Ok(roots_ask()));
        let shuffled = "{\"path\":\"C:\\\\Users\\\\José\\\\código\",\"confirm\":true}";
        assert_eq!(describe_with(&text, DAEMON, &me, Some(shuffled)), Ok(roots_ask()));
    }

    #[test]
    fn a_roots_payload_that_the_dialog_could_not_show_is_not_signed() {
        let me = own();
        let signed = |payload: &str| {
            describe_with(&command(&me, DAEMON, "roots.add", payload), DAEMON, &me, Some(payload))
        };
        let long = format!("{{\"confirm\":true,\"path\":\"/{}\"}}", "a".repeat(900));
        for bad in [
            // Not confirmed, a field the dialog does not say, no path, an empty path, a path that is no text.
            "{\"confirm\":false,\"path\":\"/work/app\"}".to_string(),
            "{\"path\":\"/work/app\"}".to_string(),
            "{\"confirm\":true,\"path\":\"/work/app\",\"trusted\":true}".to_string(),
            "{\"confirm\":true}".to_string(),
            "{\"confirm\":true,\"path\":\"\"}".to_string(),
            "{\"confirm\":true,\"path\":7}".to_string(),
            // A line break or a text-direction mark could pad or reorder what the dialog says.
            "{\"confirm\":true,\"path\":\"/work/app\\nAllow everything\"}".to_string(),
            "{\"confirm\":true,\"path\":\"/work/\\u202eppa\"}".to_string(),
            "{\"confirm\":true,\"path\":\"/work/\\u200bapp\"}".to_string(),
            // A run of spaces, a path that is not absolute.
            "{\"confirm\":true,\"path\":\"/work/app  Nothing will run\"}".to_string(),
            "{\"confirm\":true,\"path\":\"work/app\"}".to_string(),
            long,
        ] {
            assert!(signed(&bad).is_err(), "signed: {bad}");
        }
        assert!(signed("{\"confirm\":true,\"path\":\"/work/app\"}").is_ok());
        assert!(signed("{\"confirm\":true,\"path\":\"\\\\\\\\host\\\\share\\\\app\"}").is_ok());
    }

    #[test]
    fn the_dialog_of_an_allowed_folder_names_the_folder_and_what_it_opens_and_has_a_button_of_its_own() {
        let (_, en) = confirm_text(&roots_ask(), "en");
        assert!(en.starts_with("Allow sessions in a folder?"), "{en}");
        assert!(en.contains("everything inside it") && en.contains(&DAEMON[..8]), "{en}");
        assert!(en.ends_with("\n\"C:\\Users\\José\\código\""), "{en}");
        let (_, pt) = confirm_text(&roots_ask(), "pt-BR");
        assert!(pt.starts_with("Permitir sessões em uma pasta?"), "{pt}");
        assert!(pt.contains("tudo o que há dentro dela") && pt.contains("Flightdeck"), "{pt}");
        assert_eq!(confirm_labels(&roots_ask(), "en").0, "Add folder");
        assert_eq!(confirm_labels(&roots_ask(), "pt-BR").0, "Adicionar pasta");
    }

    /// The payload that writes a project's setup, in canonical form (keys sorted, digests sorted, no spaces), and the
    /// hash both sides share (the protocol test asserts the same two literals).
    const HARNESS_PAYLOAD: &str = "{\"confirm\":true,\"digests\":{\".claude/settings.json\":\"d-settings\",\"CLAUDE.md\":\"d-claude\"},\"parts\":[\"claudeMd\",\"hooks\"],\"path\":\"/work/api\",\"reformat\":true,\"template\":\"shop\"}";
    const HARNESS_HASH: &str = "0292c9b1e82f6513b3e80cb1b62d9cc667079b39ea1ad2650303d318379718bf";

    fn harness_ask() -> Ask {
        Ask {
            kind: Kind::Command,
            host: DAEMON.into(),
            subject: "project.harness.apply".into(),
            also: Also::default(),
            command: Some(CommandAsk::HarnessApply {
                path: "/work/api".into(),
                parts: vec!["claudeMd".into(), "hooks".into()],
                template: Some("shop".into()),
                reformat: true,
            }),
        }
    }

    #[test]
    fn the_harness_vector_hashes_the_same_in_both_languages() {
        assert_eq!(sha256_hex(HARNESS_PAYLOAD), HARNESS_HASH);
    }

    #[test]
    fn writing_a_setup_is_read_from_its_payload_after_the_hash_matches() {
        let me = own();
        let text = command(&me, DAEMON, "project.harness.apply", HARNESS_PAYLOAD);
        assert_eq!(describe_with(&text, DAEMON, &me, Some(HARNESS_PAYLOAD)), Ok(harness_ask()));
        let shuffled = "{\"template\":\"shop\",\"reformat\":true,\"path\":\"/work/api\",\"parts\":[\"claudeMd\",\"hooks\"],\"digests\":{\"CLAUDE.md\":\"d-claude\",\".claude/settings.json\":\"d-settings\"},\"confirm\":true}";
        assert_eq!(describe_with(&text, DAEMON, &me, Some(shuffled)), Ok(harness_ask()));
    }

    #[test]
    fn a_setup_without_a_template_or_reformat_is_signed_as_it_is() {
        let me = own();
        let payload = "{\"confirm\":true,\"digests\":{\"CLAUDE.md\":\"d\"},\"parts\":[\"claudeMd\"],\"path\":\"/work/api\"}";
        let text = command(&me, DAEMON, "project.harness.apply", payload);
        let ask = describe_with(&text, DAEMON, &me, Some(payload)).expect("signed");
        assert_eq!(
            ask.command,
            Some(CommandAsk::HarnessApply {
                path: "/work/api".into(),
                parts: vec!["claudeMd".into()],
                template: None,
                reformat: false,
            })
        );
    }

    #[test]
    fn a_setup_payload_that_the_dialog_could_not_show_is_not_signed() {
        let me = own();
        let signed = |payload: &str| {
            describe_with(&command(&me, DAEMON, "project.harness.apply", payload), DAEMON, &me, Some(payload))
        };
        let ok = |extra: &str| format!("{{\"confirm\":true,\"digests\":{{\"a\":\"b\"}},\"parts\":[\"hooks\"],\"path\":\"/work/api\"{extra}}}");
        let many = (0..18).map(|i| format!("\"f{i}\":\"d\"")).collect::<Vec<_>>().join(",");
        for bad in [
            // Not confirmed, no folder, no parts, no digests, a field the dialog does not say.
            "{\"confirm\":false,\"digests\":{\"a\":\"b\"},\"parts\":[\"hooks\"],\"path\":\"/work/api\"}".to_string(),
            "{\"digests\":{\"a\":\"b\"},\"parts\":[\"hooks\"],\"path\":\"/work/api\"}".to_string(),
            "{\"confirm\":true,\"digests\":{\"a\":\"b\"},\"parts\":[\"hooks\"]}".to_string(),
            "{\"confirm\":true,\"digests\":{\"a\":\"b\"},\"path\":\"/work/api\"}".to_string(),
            "{\"confirm\":true,\"parts\":[\"hooks\"],\"path\":\"/work/api\"}".to_string(),
            ok(",\"extra\":1"),
            // A part the harness does not have, none at all, a repeated one, a part that is no text.
            ok("").replace("\"hooks\"", "\"mcp\""),
            ok("").replace("[\"hooks\"]", "[]"),
            ok("").replace("[\"hooks\"]", "[\"hooks\",\"hooks\"]"),
            ok("").replace("[\"hooks\"]", "[7]"),
            // A reformat or a template that is not what the host takes.
            ok(",\"reformat\":\"yes\""),
            ok(",\"template\":\"Shop\""),
            ok(",\"template\":\"shop\\nAllow\""),
            ok(",\"template\":\"\""),
            // A folder the dialog could not show whole.
            ok("").replace("/work/api", "work/api"),
            ok("").replace("/work/api", "/work/\\u202eipa"),
            ok("").replace("/work/api", "/work/api\\nAllow everything"),
            ok("").replace("/work/api", "/work/x\\\" harmless text"),
            // Digests: too many, a key or a value the host never makes, an empty one.
            format!("{{\"confirm\":true,\"digests\":{{{many}}},\"parts\":[\"hooks\"],\"path\":\"/work/api\"}}"),
            ok("").replace("\"a\":\"b\"", "\"a\\\"b\":\"b\""),
            ok("").replace("\"a\":\"b\"", "\"a\":\"b c\""),
            ok("").replace("\"a\":\"b\"", "\"a\":7"),
            ok("").replace("\"a\":\"b\"", "\"á\":\"b\""),
            ok("").replace("{\"a\":\"b\"}", "[\"a\"]"),
        ] {
            assert!(signed(&bad).is_err(), "signed: {bad}");
        }
        assert!(signed(&ok("")).is_ok());
        assert!(signed(&ok(",\"reformat\":false,\"template\":\"shop\"")).is_ok());
        // The host names a file of a template with `@` and `+` too (plainName).
        assert!(signed(&ok("").replace("\"a\":\"b\"", "\"skills/my+skill/a@b.md\":\"b\"")).is_ok());
    }

    #[test]
    fn a_setup_with_all_the_digests_of_a_template_is_still_signed() {
        let me = own();
        let digests = (0..17)
            .map(|i| format!("\".claude/skills/skill-{i:02}/SKILL.md\":\"{}\"", "a".repeat(64)))
            .collect::<Vec<_>>()
            .join(",");
        let payload = format!(
            "{{\"confirm\":true,\"digests\":{{{digests}}},\"parts\":[\"claudeMd\",\"hooks\",\"skills\",\"agents\",\"permissions\"],\"path\":\"/work/api\",\"template\":\"shop\"}}"
        );
        assert!(payload.len() > MAX_PAYLOAD, "the sample is longer than other commands may be");
        let text = command(&me, DAEMON, "project.harness.apply", &payload);
        assert!(describe_with(&text, DAEMON, &me, Some(&payload)).is_ok());
    }

    /// The payloads that install and update a plugin, in canonical form, and the hashes both sides share (the
    /// protocol test asserts the same literals).
    const PLUGIN_PAYLOAD: &str = "{\"acceptCommand\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\"confirmHash\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"plugin\":\"deploy-tools@acme\",\"scope\":\"project\"}";
    const PLUGIN_HASH: &str = "9f63013ef3891d7e3a3c30dbdb4812172f4c3d17e9f3babab503feae8cb0a2ef";
    const PLUGIN_DIR_PAYLOAD: &str = "{\"confirmHash\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"dir\":\"/work/plugins/deploy\"}";
    const PLUGIN_DIR_HASH: &str = "6e0874106473077fddaefcda0cb2963d24ecfac81bbaa0bf0e63577df0798713";
    const PLUGIN_UPDATE_PAYLOAD: &str = "{\"confirmHash\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"plugin\":\"deploy-tools@acme\"}";
    const PLUGIN_UPDATE_HASH: &str = "105dd69dedb5eeca4e9d83cfca9005986688a4bab71e3cc6450cd685c6d18198";

    fn install_ask() -> Ask {
        Ask {
            kind: Kind::Command,
            host: DAEMON.into(),
            subject: "plugins.install".into(),
            also: Also::default(),
            command: Some(CommandAsk::PluginInstall {
                plugin: Some("deploy-tools@acme".into()),
                dir: None,
                scope: "project".into(),
            }),
        }
    }

    fn update_ask() -> Ask {
        Ask {
            subject: "plugins.update".into(),
            command: Some(CommandAsk::PluginUpdate { plugin: "deploy-tools@acme".into() }),
            ..install_ask()
        }
    }

    #[test]
    fn the_plugin_vectors_hash_the_same_in_both_languages() {
        assert_eq!(
            [sha256_hex(PLUGIN_PAYLOAD), sha256_hex(PLUGIN_DIR_PAYLOAD), sha256_hex(PLUGIN_UPDATE_PAYLOAD)],
            [PLUGIN_HASH, PLUGIN_DIR_HASH, PLUGIN_UPDATE_HASH]
        );
    }

    #[test]
    fn installing_and_updating_a_plugin_are_read_from_their_payloads_after_the_hash_matches() {
        let me = own();
        let text = command(&me, DAEMON, "plugins.install", PLUGIN_PAYLOAD);
        assert_eq!(describe_with(&text, DAEMON, &me, Some(PLUGIN_PAYLOAD)), Ok(install_ask()));
        let shuffled = "{\"scope\":\"project\",\"plugin\":\"deploy-tools@acme\",\"confirmHash\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"acceptCommand\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\"}";
        assert_eq!(describe_with(&text, DAEMON, &me, Some(shuffled)), Ok(install_ask()));
        let text = command(&me, DAEMON, "plugins.update", PLUGIN_UPDATE_PAYLOAD);
        assert_eq!(describe_with(&text, DAEMON, &me, Some(PLUGIN_UPDATE_PAYLOAD)), Ok(update_ask()));
        let text = command(&me, DAEMON, "plugins.install", PLUGIN_DIR_PAYLOAD);
        let ask = describe_with(&text, DAEMON, &me, Some(PLUGIN_DIR_PAYLOAD)).expect("signed");
        assert_eq!(
            ask.command,
            Some(CommandAsk::PluginInstall { plugin: None, dir: Some("/work/plugins/deploy".into()), scope: "user".into() })
        );
    }

    #[test]
    fn a_plugin_payload_that_the_dialog_could_not_show_is_not_signed() {
        let me = own();
        let hash = "a".repeat(64);
        let install = |payload: &str| {
            describe_with(&command(&me, DAEMON, "plugins.install", payload), DAEMON, &me, Some(payload))
        };
        let update = |payload: &str| {
            describe_with(&command(&me, DAEMON, "plugins.update", payload), DAEMON, &me, Some(payload))
        };
        // The reader refuses these before the hash is compared; a refusal by the hash would hide a missing rule,
        // because the cases are not all written in the sorted order the canonical text has.
        let refused_by_rule = |result: Result<_, String>| {
            matches!(result, Err(ref why) if why != "the payload is not the one the text hashes")
        };
        let ok = |extra: &str| format!("{{\"confirmHash\":\"{hash}\",\"plugin\":\"deploy-tools@acme\"{extra}}}");
        for bad in [
            // A field the dialog does not say, no content hash, both a plugin and a folder, neither.
            ok(",\"extra\":1"),
            format!("{{\"plugin\":\"deploy-tools@acme\"}}"),
            ok(",\"dir\":\"/work/p\""),
            format!("{{\"confirmHash\":\"{hash}\"}}"),
            // A scope that is not one of the three, a hash or an accepted command that is not a plain token.
            ok(",\"scope\":\"all\""),
            ok(",\"scope\":7"),
            ok("").replace(&hash, "not a hash"),
            ok("").replace(&hash, ""),
            ok(",\"acceptCommand\":\"x y\""),
            ok(",\"acceptCommand\":\"\""),
            // A plugin name that can pad the text, start an option, or is no text.
            ok("").replace("deploy-tools@acme", "deploy-tools@acme\nAllow everything"),
            ok("").replace("deploy-tools@acme", "deploy tools"),
            ok("").replace("deploy-tools@acme", "\\\"x"),
            ok("").replace("deploy-tools@acme", "--scope"),
            ok("").replace("deploy-tools@acme", "\\u202eevil"),
            ok("").replace("\"deploy-tools@acme\"", "7"),
            // A folder the dialog could not show whole.
            format!("{{\"confirmHash\":\"{hash}\",\"dir\":\"plugins/deploy\"}}"),
            format!("{{\"confirmHash\":\"{hash}\",\"dir\":\"/work/\\u202eevil\"}}"),
            format!("{{\"confirmHash\":\"{hash}\",\"dir\":\"/work/x\\\" harmless\"}}"),
        ] {
            assert!(refused_by_rule(install(&bad)), "signed install: {bad}");
        }
        assert!(install(&ok("")).is_ok());
        assert!(install(&ok(",\"scope\":\"local\"")).is_ok());
        assert!(install(&format!("{{\"confirmHash\":\"{hash}\",\"dir\":\"/work/plugins/deploy\"}}")).is_ok());
        for bad in [
            // An update takes no scope, no folder and no more than its three fields.
            ok(",\"scope\":\"user\""),
            ok(",\"dir\":\"/work/p\""),
            format!("{{\"confirmHash\":\"{hash}\"}}"),
            ok("").replace("deploy-tools@acme", "deploy tools"),
            ok("").replace(&hash, "nope nope"),
        ] {
            assert!(refused_by_rule(update(&bad)), "signed update: {bad}");
        }
        assert!(update(&ok("")).is_ok());
        // The payload is signed in canonical (sorted) form, so the accepted command comes first.
        assert!(update(&ok("").replacen('{', "{\"acceptCommand\":\"cc\",", 1)).is_ok());
    }

    #[test]
    fn the_dialogs_of_a_plugin_name_it_where_it_comes_from_and_that_it_runs_code_and_have_buttons_of_their_own() {
        let (_, en) = confirm_text(&install_ask(), "en");
        assert!(en.starts_with("Install a plugin?"), "{en}");
        assert!(en.contains("deploy-tools@acme") && en.contains("project") && en.contains("runs code") && en.contains(&DAEMON[..8]), "{en}");
        let (_, pt) = confirm_text(&install_ask(), "pt-BR");
        assert!(pt.starts_with("Instalar um plugin?") && pt.contains("deploy-tools@acme") && pt.contains("roda código"), "{pt}");
        let from = Ask {
            command: Some(CommandAsk::PluginInstall { plugin: None, dir: Some("/work/plugins/deploy".into()), scope: "user".into() }),
            ..install_ask()
        };
        let (_, en) = confirm_text(&from, "en");
        assert!(en.starts_with("Install a plugin from a folder?") && en.ends_with("\n\"/work/plugins/deploy\""), "{en}");
        let (_, pt) = confirm_text(&from, "pt-BR");
        assert!(pt.starts_with("Instalar um plugin de uma pasta?") && pt.ends_with("\n\"/work/plugins/deploy\""), "{pt}");
        let (_, en) = confirm_text(&update_ask(), "en");
        assert!(en.starts_with("Update a plugin?") && en.contains("deploy-tools@acme") && en.contains("runs code"), "{en}");
        let (_, pt) = confirm_text(&update_ask(), "pt-BR");
        assert!(pt.starts_with("Atualizar um plugin?") && pt.contains("roda código"), "{pt}");
        assert_eq!(
            [
                confirm_labels(&install_ask(), "en").0,
                confirm_labels(&install_ask(), "pt-BR").0,
                confirm_labels(&update_ask(), "en").0,
                confirm_labels(&update_ask(), "pt-BR").0,
            ],
            ["Install", "Instalar", "Update", "Atualizar"]
        );
    }

    #[test]
    fn the_dialog_of_a_setup_names_the_folder_the_parts_and_the_hooks_and_has_a_button_of_its_own() {
        let (_, en) = confirm_text(&harness_ask(), "en");
        assert!(en.starts_with("Write the Claude Code setup of a project?"), "{en}");
        assert!(en.contains("CLAUDE.md, hooks") && en.contains("\"shop\""), "{en}");
        assert!(en.contains("run as commands") && en.contains("settings file") && en.contains(&DAEMON[..8]), "{en}");
        assert!(en.ends_with("\n\"/work/api\""), "{en}");
        let (_, pt) = confirm_text(&harness_ask(), "pt-BR");
        assert!(pt.starts_with("Gravar a configuração do Claude Code de um projeto?"), "{pt}");
        assert!(pt.contains("CLAUDE.md, hooks") && pt.contains("rodam como comandos") && pt.ends_with("\n\"/work/api\""), "{pt}");
        let plain = Ask {
            command: Some(CommandAsk::HarnessApply {
                path: "/work/api".into(),
                parts: vec!["claudeMd".into()],
                template: None,
                reformat: false,
            }),
            ..harness_ask()
        };
        let (_, bare) = confirm_text(&plain, "en");
        assert!(!bare.contains("run as commands") && !bare.contains("settings file") && !bare.contains("template"), "{bare}");
        assert_eq!(confirm_labels(&harness_ask(), "en").0, "Write setup");
        assert_eq!(confirm_labels(&harness_ask(), "pt-BR").0, "Gravar configuração");
    }
}
