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
    /// `project.trust.set` with `trusted: true`: this folder's own hooks and servers run with no prompt.
    TrustProject { path: String },
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
    if kind == Kind::EnrollAdd && !plain(host) {
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
    if payload.len() > MAX_PAYLOAD {
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
        _ => Err("this command is not one this key signs".into()),
    }
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
            Some(CommandAsk::TrustProject { path }) if pt => format!(
                "Confiar em uma pasta de projeto? Os hooks e os servidores dela vão rodar sem pedir confirmação. Continue só se você acabou de apertar Confiar no Flightdeck.\n\"{path}\""
            ),
            Some(CommandAsk::TrustProject { path }) => format!(
                "Trust a project folder? Its hooks and servers will run with no prompt. Continue only if you just pressed Trust in Flightdeck.\n\"{path}\""
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
        (Kind::EnrollAdd, false) => ("Add device", "Cancel"),
        (Kind::EnrollAdd, true) => ("Adicionar dispositivo", "Cancelar"),
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
        assert_eq!(confirm_labels(&trust_ask(), "en").0, "Trust");
        assert_eq!(confirm_labels(&trust_ask(), "pt-BR").0, "Confiar");
    }
}
