import { SecretScanner, scrubHome } from "@flightdeck/protocol";

/** "Copy diagnostics" carries this many of the last lines. */
const DIAGNOSTIC_LINES = 50;

export interface DiagnosticsInput {
  appVersion: string;
  os: string;
  hosts: Array<{ name: string; version: string | null; features: string[]; status: string }>;
  lines: string[];
  /** Values to remove besides the shapes of secrets (host tokens, vault values). */
  values?: () => string[];
}

/**
 * What a person pastes in a message when something broke: the app's version and system, each
 * host's name, state, version and features (never a URL or a token), and the last 50 log lines,
 * redacted once more. It is meant for whoever helps, so it is in English whatever the app's language.
 */
export function diagnosticsText(input: DiagnosticsInput): string {
  const scanner = new SecretScanner(input.values ? () => input.values?.() ?? [] : () => []);
  const hosts = input.hosts.map(
    (host) =>
      `  ${host.name}: ${host.status}, flightdeckd ${host.version ?? "unknown"}, features: ${
        host.features.length === 0 ? "none" : host.features.join(", ")
      }`,
  );
  // The whole text goes through the scanner: host names and the system string are copied too.
  const text = [
    `Flightdeck ${input.appVersion}`,
    `System: ${input.os}`,
    "Hosts:",
    ...(hosts.length === 0 ? ["  none"] : hosts),
    "Last log lines:",
    ...input.lines.slice(-DIAGNOSTIC_LINES).map((line) => `  ${line}`),
  ].join("\n");
  return scrubHome(scanner.redact(text, false));
}
