import { z } from "zod";
import { parseJsonText } from "../../shared/lib/stored-json.ts";

/** What a new device shows and an enrolled one reads to add it as an approver (#3478). */
export interface AddText {
  daemonId: string;
  publicKey: string;
  name: string;
}

const FIELDS = z.object({ d: z.string(), k: z.string(), n: z.string() }).nullable();
const PREFIX = "flightdeck-add:";
const MAX_TEXT = 1024;
/** The SPKI of a P-256 key, in the uncompressed form the app and the host make. */
const KEY_BYTES = 91;
const MAX_NAME = 64;
/** Control, format (bidi, zero-width), private-use, unassigned, separator and non-space blank characters: none can be in a name. */
const HIDDEN = /[\p{Cc}\p{Cf}\p{Co}\p{Cn}\p{Zl}\p{Zp}]|[^\S ]/u;
/** A name with two groups of hex characters in it: it could pass for, or hide beside, the fingerprint the person compares. */
const LOOKS_LIKE_CODE = /[0-9a-f]{4}[\s.\-_/]*[0-9a-f]{4}/i;

/** Whether `name` may label a device: 1 to 64 characters, nothing hidden, not a code. */
export function isDeviceName(name: string): boolean {
  const trimmed = name.trim();
  return (
    trimmed !== "" &&
    trimmed.length <= MAX_NAME &&
    !HIDDEN.test(trimmed) &&
    !LOOKS_LIKE_CODE.test(trimmed)
  );
}

function bytesOf(publicKey: string): Uint8Array<ArrayBuffer> | null {
  try {
    return Uint8Array.from(atob(publicKey), (c) => c.codePointAt(0) ?? 0);
  } catch {
    return null;
  }
}

/** The short text the new device shows, for the person to carry to an enrolled device. */
export function encodeAdd(text: AddText): string {
  const json = JSON.stringify({ d: text.daemonId, k: text.publicKey, n: text.name });
  const binary = Array.from(new TextEncoder().encode(json), (b) => String.fromCodePoint(b)).join(
    "",
  );
  return PREFIX + btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

/** The text read back, or null when it is not one this app made or its fields are not fit to sign. */
export function decodeAdd(text: string): AddText | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith(PREFIX) || trimmed.length > MAX_TEXT) return null;
  let json: string;
  try {
    const b64 = trimmed.slice(PREFIX.length).replaceAll("-", "+").replaceAll("_", "/");
    const binary = atob(b64);
    json = new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(binary, (c) => c.codePointAt(0) ?? 0),
    );
  } catch {
    return null;
  }
  const fields = parseJsonText(json, FIELDS, null);
  if (!fields) return null;
  const { d, k, n } = fields;
  const bytes = bytesOf(k);
  // The canonical form only: another spelling of the same bytes is not the key the host would list.
  if (d === "" || bytes?.length !== KEY_BYTES || btoa(String.fromCodePoint(...bytes)) !== k)
    return null;
  if (!isDeviceName(n)) return null;
  return { daemonId: d, publicKey: k, name: n.trim() };
}

/** The id the host lists a key under: the SHA-256 of its public form, in hex. */
export async function keyIdOf(publicKey: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytesOf(publicKey) ?? new Uint8Array());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Sixteen characters of the key's id in groups of four: what the person compares on both devices. */
export async function fingerprintOf(publicKey: string): Promise<string> {
  return (await keyIdOf(publicKey)).slice(0, 16).replace(/(.{4})(?=.)/g, "$1-");
}
