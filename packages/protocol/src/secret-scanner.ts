// Secret redaction: the kinds of secret the host catches, the scanner that refuses or masks them, and the home-folder scrub (issue #1589: moved from snippets.ts).
/** A keyword matched in either case, without a flag: the key's own case tells where a word ends (`clientSecret`). */
const anyCase = (pattern: string): string => {
  let out = "";
  let inClass = false;
  for (const ch of pattern) {
    if (ch === "[") inClass = true;
    if (ch === "]") inClass = false;
    out += !inClass && /[a-z]/i.test(ch) ? `[${ch.toLowerCase()}${ch.toUpperCase()}]` : ch;
  }
  return out;
};

/** The words that make a name a secret's: found in it (`DB_PASSWORD`, `clientSecret`, `authToken`), never as part of a plain word (`secrets`, `tokenizer`). */
const SECRET_WORDS =
  "password|passwd|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|credential";
const SECRET_WORD = anyCase(`(?:${SECRET_WORDS})`);
/** What may follow the word in a name: `_KEY`, `.value`, `2`, or a capitalised word (`Hash`). */
const NAME_TAIL = "(?:[A-Z][A-Za-z0-9]*|[_.-][A-Za-z0-9_.-]*|[0-9]+)?";

const AUTHORIZATION_SEPARATOR = String.raw`\\?["']?\s*[:=]\s*\\?["']?`;
const AUTHORIZATION_SCHEMES = "Bearer|Basic|Token|Digest|Negotiate|NTLM|Bot";
// A scheme and its credential, or one long unbroken value: not the word in a sentence.
const AUTHORIZATION_VALUE = String.raw`(?:(?:${AUTHORIZATION_SCHEMES})\s+[^\r\n"'\\]+|[^\s"'\\]{20,})`;
const AUTHORIZATION_HEADER = new RegExp(
  String.raw`\b(?:Proxy-)?Authorization${AUTHORIZATION_SEPARATOR}${AUTHORIZATION_VALUE}`,
  "gi",
);

/** What the scanner can name: stable kinds, named in the person's language by the app. */
export const SECRET_KINDS = [
  "github_token",
  "sk_key",
  "aws_key",
  "private_key",
  "bearer_token",
  "slack_token",
  "password_line",
  "url_credential",
  "password_option",
  "curl_password",
  "authorization_header",
  "cookie",
  "basic_credential",
  "jwt",
  "service_key",
  "webhook",
  "signed_url",
  "url_token",
  "vault_value",
] as const;
export type SecretKind = (typeof SECRET_KINDS)[number];

/** One secret found in a text: where it starts and what it is. */
interface SecretHit {
  index: number;
  text: string;
}

/** Finds the secrets of one kind in a text, in order and without overlap, for a kind a regex cannot match in linear time. */
type SecretFinder = (text: string) => SecretHit[];

/**
 * What decides whether a `-u` or `--user` in a curl command is followed by a password: the word
 * `curl` arms it, a line break, `|`, `;` or `&` disarms it, and the flag (after a whitespace
 * character, before another) is the place to look. One pass, so a long line costs what it is.
 */
const CURL_EVENT = /(\s)(?:-u|--user)(?=\s)|\bcurl\b|[\n|;&]/g;
const CURL_CREDENTIAL = /\s+([^\s:]+:\S+)/y;

/** The `user:password` after `-u` or `--user` of a curl command, for as long as no separator ended the command. */
const curlCredentials: SecretFinder = (text) => {
  const hits: SecretHit[] = [];
  let armed = false;
  for (const event of text.matchAll(CURL_EVENT)) {
    const [word, space] = event;
    if (space === undefined) {
      armed = word === "curl";
      continue;
    }
    if (armed) {
      CURL_CREDENTIAL.lastIndex = event.index + word.length;
      const credential = CURL_CREDENTIAL.exec(text)?.[1];
      if (credential !== undefined) {
        hits.push({ index: CURL_CREDENTIAL.lastIndex - credential.length, text: credential });
      }
    }
    if (space === "\n") armed = false;
  }
  return hits;
};

const SECRET_PATTERNS: Array<[SecretKind, RegExp | SecretFinder]> = [
  ["github_token", /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_\w{20,})/g],
  ["sk_key", /\bsk-[A-Za-z0-9_-]{16,}/g],
  ["aws_key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  // The whole block, body and END line; a block cut short (a capped message) goes to the end.
  [
    "private_key",
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  ],
  ["bearer_token", /\bBearer\s+[a-z0-9._~+/=-]{16,}/gi],
  ["slack_token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/g],
  // A name with the word anywhere in it, quoted or not (JSON, escaped JSON), then `=` or `:` and the value.
  [
    "password_line",
    new RegExp(
      String.raw`(?:\b${anyCase("pass")}|(?<![A-Za-z0-9])[A-Za-z0-9_.-]*?${SECRET_WORD}${NAME_TAIL})\\?["']?\s*[=:]\s*\\?["']?[^\s"'\\&;,}]{3,}`,
      "g",
    ),
  ],
  ["url_credential", /:\/\/[^\s/:@]+:[^\s/@]+@/g],
  ["password_option", new RegExp(String.raw`--(?:${SECRET_WORDS})(?:=|\s+)[^\s]+`, "gi")],
  ["curl_password", curlCredentials],
  ["authorization_header", AUTHORIZATION_HEADER],
  ["cookie", /\b(?:Set-)?Cookie\s*:\s*[^\r\n]+/gi],
  ["basic_credential", /\bBasic\s+[A-Za-z0-9+/=]{8,}/g],
  ["jwt", /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g],
  [
    "service_key",
    /\b(?:AIza[0-9A-Za-z_-]{30,}|[sr]k_(?:live|test)_[0-9A-Za-z]{16,}|npm_[A-Za-z0-9]{30,}|glpat-[A-Za-z0-9_-]{16,})/g,
  ],
  [
    "webhook",
    /\b(?:hooks\.slack\.com\/services\/[A-Za-z0-9/]+|discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+)/g,
  ],
  ["signed_url", /[?&](?:sig|signature|x-amz-signature|x-goog-signature)=[^\s&]+/gi],
  ["url_token", /:\/\/[A-Za-z0-9_-]{20,}@/g],
];

/** Every hit of a pattern in a text, whether it is a regex or a finder. */
const hitsOf = (pattern: RegExp | SecretFinder, text: string): SecretHit[] =>
  typeof pattern === "function"
    ? pattern(text)
    : Array.from(text.matchAll(pattern), (match) => ({ index: match.index, text: match[0] }));

/** The text with each hit replaced by `[redacted]`; a hit with a `{{variable}}` stays when `keepPlaceholders`. */
function redactHits(text: string, hits: SecretHit[], keepPlaceholders: boolean): string {
  let clean = "";
  let from = 0;
  for (const hit of hits) {
    const kept = keepPlaceholders && hit.text.includes("{{");
    clean += text.slice(from, hit.index) + (kept ? hit.text : "[redacted]");
    from = hit.index + hit.text.length;
  }
  return clean + text.slice(from);
}

/** Vault values shorter than this are not told apart from ordinary text. */
const MIN_VAULT_VALUE = 6;

/**
 * Looks for secrets in text: token shapes, private keys, passwords typed on the line and, when
 * the vault is connected (phase 16), its values. It names what it found and never repeats it.
 * A `{{variable}}` is not a secret: it is where the value will be put when the snippet is used.
 */
export class SecretScanner {
  constructor(private readonly vaultValues: () => string[] = () => []) {}

  scan(text: string): string[] {
    const found: SecretKind[] = [];
    for (const [kind, pattern] of SECRET_PATTERNS) {
      const hit = hitsOf(pattern, text).some((hit) => !hit.text.includes("{{"));
      if (hit) found.push(kind);
    }
    if (
      this.vaultValues().some((value) => value.length >= MIN_VAULT_VALUE && text.includes(value))
    ) {
      found.push("vault_value");
    }
    return found;
  }

  /**
   * The text with every secret it holds replaced by `[redacted]`: what a log line goes through so
   * that no token, key, link or vault value is ever written. A `{{variable}}` stays (it is a place
   * for a value, not a value), unless `keepPlaceholders` is false: a log has no such places.
   */
  redact(text: string, keepPlaceholders = true): string {
    let clean = text;
    for (const [, pattern] of SECRET_PATTERNS) {
      clean = redactHits(clean, hitsOf(pattern, clean), keepPlaceholders);
    }
    for (const value of this.vaultValues()) {
      if (value.length >= MIN_VAULT_VALUE) clean = clean.split(value).join("[redacted]");
    }
    return clean;
  }
}

/** `/home/<name>`, `/Users/<name>` and `C:\\Users\\<name>` (also with the backslashes doubled, as in JSON). */
const HOME_FOLDER = /(?:\/(?:home|Users)\/|[a-z]:\\{1,2}Users\\{1,2})[^/\\\s"']+/gi;

function withoutTrailingSeparators(path: string): string {
  let end = path.length;
  while (end > 0 && (path[end - 1] === "/" || path[end - 1] === "\\")) end--;
  return path.slice(0, end);
}

/**
 * The text with the user's home folder as `~`: a log is pasted in public issues, and the user's
 * name is in every path under it. `home`, when known, is replaced whatever it looks like (a name
 * with spaces, a folder that is not under /home); the usual folders of Linux, macOS and Windows
 * are replaced either way.
 */
export function scrubHome(text: string, home?: string): string {
  let clean = text;
  const known = withoutTrailingSeparators(home ?? "");
  if (known.length >= 3) {
    for (const spelling of new Set([known, known.replaceAll("\\", "\\\\")])) {
      clean = clean.split(spelling).join("~");
    }
  }
  return clean.replace(HOME_FOLDER, "~");
}
