import type { AlertsUnavailable, RepoAlert } from "@flightdeck/protocol";
import type { GhResult } from "./gh.ts";

/** Runs `gh` in the project's folder, so `{owner}` and `{repo}` come from its own remote; `null` when `gh` is missing. */
export type GhIn = (args: string[], cwd: string) => Promise<GhResult | null>;

/** Open alerts asked of each source, at most. */
export const PER_SOURCE = 30;
/** Alerts returned in all. */
export const ALERTS_MAX = 50;
export const TITLE_MAX = 200;
export const TEXT_MAX = 600;
/** A response longer than this is not read. */
export const RESPONSE_MAX = 2 * 1024 * 1024;

export interface AlertList {
  alerts: RepoAlert[];
  unavailable: AlertsUnavailable[];
}

type Kind = RepoAlert["kind"];
type Severity = RepoAlert["severity"];

const SEVERITIES: ReadonlySet<string> = new Set(["critical", "high", "medium", "low"]);
const RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3, unknown: 4 };
/** A code-scanning rule with no security level only has the tool's own word for it. */
const RULE_LEVEL: Record<string, Severity> = { error: "high", warning: "medium", note: "low" };

/**
 * What a person must not be shown, or a prompt carry: controls, invisible formatting, private-use,
 * unassigned and lone-surrogate code points, variation selectors and the blanks that look empty.
 */
const NOT_SHOWN =
  /[\p{Cc}\p{Cf}\p{Co}\p{Cn}\p{Cs}\p{Zl}\p{Zp}\u00A0\u3164\u2800]|[\uFE00-\uFE0F]|[\u{E0100}-\u{E01EF}]|[\u180B-\u180D]|\u034F|[\u115F\u1160\uFFA0]/u;

/** A line that reads as a fence or a heading: it could close the block the alert sits in. */
const FENCE_LINE = /^\s*(?:-{3,}|`{3,}|~{3,}|#)/;
const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/**
 * A string with its controls and invisible characters gone (the newlines too, unless kept), cut to
 * `max`. Third-party text sits between markers in a prompt, so a run of three dashes is shortened
 * and, with the lines kept, a line that looks like a fence or a heading is dropped.
 */
function clean(value: unknown, max: number, keepLines = false): string {
  if (typeof value !== "string") return "";
  const kept = keepLines ? value.replace(/\r\n?/g, "\n") : value.replace(/\s+/g, " ");
  const visible = [...kept]
    .filter((char) => (keepLines && char === "\n") || !NOT_SHOWN.test(char))
    .join("");
  const lines = keepLines
    ? visible
        .split("\n")
        .filter((line) => !FENCE_LINE.test(line))
        .join("\n")
    : visible;
  return [...lines.replace(/-{3,}/g, "--").trim()].slice(0, max).join("");
}

const severityOf = (level: unknown, fallback?: unknown): Severity => {
  if (typeof level === "string" && SEVERITIES.has(level)) return level as Severity;
  return (typeof fallback === "string" ? RULE_LEVEL[fallback] : undefined) ?? "unknown";
};

/** A link to the alert's page, only when it is https. */
const linkOf = (value: unknown): string =>
  typeof value === "string" && value.startsWith("https://") ? clean(value, 300) : "";

const integer = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;

function entry(
  kind: Kind,
  number: number,
  severity: Severity,
  title: string,
  location: string | null,
  url: string,
  lines: string[],
): RepoAlert {
  const label = kind === "code-scanning" ? "Code scanning" : "Dependabot";
  const text = [
    ...[`${label} alert #${number} (${severity}): ${title}`, ...lines]
      .filter((line) => line !== "")
      .join("\n"),
  ]
    .slice(0, TEXT_MAX)
    .join("");
  return { id: `${kind}:${number}`, kind, number, severity, title, location, url, text };
}

function codeScanning(raw: unknown): RepoAlert | null {
  const alert = record(raw);
  const rule = record(alert?.rule);
  const number = integer(alert?.number);
  const title = clean(rule?.description, TITLE_MAX);
  if (!alert || !rule || number === null || title === "") return null;
  const where = record(record(alert.most_recent_instance)?.location);
  const path = clean(where?.path, 300);
  const line = integer(where?.start_line);
  const withLine = line === null ? path : `${path}:${line}`;
  const location = path === "" ? null : withLine;
  const id = clean(rule.id, 100);
  const url = linkOf(alert.html_url);
  const message = clean(record(record(alert.most_recent_instance)?.message)?.text, TEXT_MAX, true);
  return entry(
    "code-scanning",
    number,
    severityOf(rule.security_severity_level, rule.severity),
    title,
    location,
    url,
    [id && `Rule: ${id}`, location && `Where: ${location}`, url, message].map((line) => line || ""),
  );
}

function dependabot(raw: unknown): RepoAlert | null {
  const alert = record(raw);
  const advisory = record(alert?.security_advisory);
  const number = integer(alert?.number);
  const title = clean(advisory?.summary, TITLE_MAX);
  if (!alert || !advisory || number === null || title === "") return null;
  const dependency = record(alert.dependency);
  const manifest = clean(dependency?.manifest_path, 300);
  const name = clean(record(dependency?.package)?.name, 100);
  const url = linkOf(alert.html_url);
  const detail = clean(advisory.description, TEXT_MAX, true);
  return entry(
    "dependabot",
    number,
    severityOf(advisory.severity),
    title,
    manifest || null,
    url,
    [name && `Package: ${name}${manifest ? ` (${manifest})` : ""}`, url, detail].map(
      (line) => line || "",
    ),
  );
}

const SOURCES: Array<{ kind: Kind; path: string; read(raw: unknown): RepoAlert | null }> = [
  {
    kind: "code-scanning",
    path: `repos/{owner}/{repo}/code-scanning/alerts?state=open&per_page=${PER_SOURCE}`,
    read: codeScanning,
  },
  {
    kind: "dependabot",
    path: `repos/{owner}/{repo}/dependabot/alerts?state=open&per_page=${PER_SOURCE}`,
    read: dependabot,
  },
];

/** Why `gh api` failed, from the HTTP status it prints; its own text goes no further. */
function reasonOf(stderr: string): AlertsUnavailable["reason"] {
  const status = /HTTP (\d{3})/.exec(stderr)?.[1];
  if (status === "401" || stderr.includes("gh auth login")) return "not_signed_in";
  return status === "403" || status === "404" ? "unavailable" : "failed";
}

type Read = { alerts: RepoAlert[] } | { unavailable: AlertsUnavailable["reason"] };

async function readSource(gh: GhIn, cwd: string, source: (typeof SOURCES)[number]): Promise<Read> {
  let result: GhResult | null;
  try {
    result = await gh(["api", source.path], cwd);
  } catch {
    return { unavailable: "failed" };
  }
  if (result === null) return { unavailable: "gh_missing" };
  if (result.timedOut) return { unavailable: "failed" };
  if (result.code !== 0) return { unavailable: reasonOf(result.stderr) };
  if (result.stdout.length > RESPONSE_MAX) return { unavailable: "failed" };
  let list: unknown;
  try {
    list = JSON.parse(result.stdout);
  } catch {
    return { unavailable: "failed" };
  }
  if (!Array.isArray(list)) return { unavailable: "failed" };
  return { alerts: list.map(source.read).filter((alert) => alert !== null) };
}

/**
 * Issue #79: the open code-scanning and Dependabot alerts of the repository in `cwd`, read-only
 * (`gh api` with a plain GET). The host holds no token and builds no URL: `gh` fills the repo in
 * from the folder's remote. A source that cannot be read is named, without `gh`'s text. The worst
 * come first, then the newest, at most `ALERTS_MAX`.
 */
export async function listAlerts(gh: GhIn, cwd: string): Promise<AlertList> {
  const reads = await Promise.all(SOURCES.map((source) => readSource(gh, cwd, source)));
  const alerts: RepoAlert[] = [];
  const unavailable: AlertsUnavailable[] = [];
  reads.forEach((read, i) => {
    const kind = (SOURCES[i] as (typeof SOURCES)[number]).kind;
    if ("alerts" in read) alerts.push(...read.alerts);
    else unavailable.push({ kind, reason: read.unavailable });
  });
  alerts.sort((a, b) => RANK[a.severity] - RANK[b.severity] || b.number - a.number);
  return { alerts: alerts.slice(0, ALERTS_MAX), unavailable };
}
