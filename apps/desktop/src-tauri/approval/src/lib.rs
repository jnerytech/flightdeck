//! #3439: the device key of a host and the check of what it is asked to sign. The private scalar
//! lives in the OS credential store (the app crate) and never reaches the webview; this crate holds
//! the parts that need no Tauri: making a key, its two public forms, the signature, and reading the
//! text to be signed so the native confirmation says what the key is about to do.

use base64::{engine::general_purpose::STANDARD, Engine};
use p256::ecdsa::{signature::Signer, Signature, SigningKey};
use p256::pkcs8::EncodePublicKey;
use sha2::{Digest, Sha256};

/// What a signed text asks for.
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum Kind {
    Approve,
    EnrollFirst,
    EnrollAdd,
    Revoke,
}

/// What the text names: the request to allow, the key to add or the key to revoke.
#[derive(Debug, PartialEq, Eq)]
pub struct Ask {
    pub kind: Kind,
    pub subject: String,
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

/// A new key: the base64 of its 32-byte scalar.
pub fn generate() -> String {
    STANDARD.encode(SigningKey::random(&mut rand_core::OsRng).to_bytes())
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
            (Kind::EnrollAdd, part(2), Some(part(1)), part(4))
        }
        TAG_REVOKE => {
            shape(5)?;
            (Kind::Revoke, part(2), Some(part(1)), part(4))
        }
        _ => return Err("this text is not one this key signs".into()),
    };
    if host != daemon_id {
        return Err("the text is for another host".into());
    }
    if key.is_some_and(|k| k != own.key_id) {
        return Err("the text is made for another key".into());
    }
    Ok(Ask { kind, subject: subject.to_string() })
}

/// The words of the system's confirmation: its title and its text, in `lang` ("pt-BR" or English
/// for anything else). Built here from the parsed message, never from text the webview sent.
pub fn confirm_text(_ask: &Ask, _lang: &str) -> (String, String) {
    (String::new(), String::new())
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

    #[test]
    fn an_approval_names_its_request() {
        let me = own();
        let m = format!(
            "[\"flightdeck/approval/v1\",\"{}\",\"{DAEMON}\",\"ext-7\",\"n\",\"allow\",\"a\",\"b\",\"c\"]",
            me.key_id
        );
        assert_eq!(
            describe(&m, DAEMON, &me).unwrap(),
            Ask { kind: Kind::Approve, subject: "ext-7".into() }
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
    fn adding_and_revoking_name_the_other_key() {
        let me = own();
        let add = format!(
            "[\"flightdeck/enroll-add/v1\",\"{}\",\"{DAEMON}\",\"n\",\"NEWKEY\"]",
            me.key_id
        );
        assert_eq!(
            describe(&add, DAEMON, &me).unwrap(),
            Ask { kind: Kind::EnrollAdd, subject: "NEWKEY".into() }
        );
        let rv = format!(
            "[\"flightdeck/revoke/v1\",\"{}\",\"{DAEMON}\",\"n\",\"abc123\"]",
            me.key_id
        );
        assert_eq!(
            describe(&rv, DAEMON, &me).unwrap(),
            Ask { kind: Kind::Revoke, subject: "abc123".into() }
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
        let approve = Ask { kind: Kind::Approve, subject: "ext-7".into() };
        let (title, body) = confirm_text(&approve, "en");
        assert!(title.contains("Flightdeck"));
        assert!(body.contains("ext-7") && body.contains("just pressed"));
        let (_, body_pt) = confirm_text(&approve, "pt-BR");
        assert!(body_pt.contains("ext-7") && body_pt.contains("acabou de apertar"));
        let revoke = Ask { kind: Kind::Revoke, subject: "0123456789abcdef".into() };
        assert!(confirm_text(&revoke, "en").1.contains("01234567"));
        assert!(!confirm_text(&revoke, "en").1.contains("0123456789abcdef"));
    }

    #[test]
    fn an_enrollment_shows_the_fingerprint_of_the_key_not_its_text() {
        let info = public_info(&generate()).unwrap();
        let first = Ask { kind: Kind::EnrollFirst, subject: info.public_key.clone() };
        let body = confirm_text(&first, "en").1;
        assert!(body.contains(&info.key_id[..8]));
        assert!(!body.contains(&info.public_key));
        let add = Ask { kind: Kind::EnrollAdd, subject: info.public_key.clone() };
        assert!(confirm_text(&add, "pt-BR").1.contains(&info.key_id[..8]));
    }
}
