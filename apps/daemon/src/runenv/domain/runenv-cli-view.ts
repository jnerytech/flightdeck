/**
 * Issue #3621: what `flightdeckd runenv` prints, as pure rules over the daemon's answers. A `--json`
 * value keeps every key: `null` where an older daemon sends none. The environment values of a process
 * are never printed as text: only their names, since a run.yaml may hold one a person would not paste.
 */
import type { RunConfigInfo, RunProcessState, RunState } from "@flightdeck/protocol";

/** The run.yaml as the protocol returns it, with the fields a project with no file leaves out as `null`. */
export const configJson = (info: RunConfigInfo) => ({
  ...info,
  hash: info.hash ?? null,
  config: info.config ?? null,
});

/** The project's run.yaml: the hash a later `runenv trust` repeats, the errors, then the setup and each process. */
export function configLines(project: string, info: RunConfigInfo): string[] {
  if (!info.exists) return [`${project}: no run.yaml`];
  const trust = info.trusted ? "trusted" : "not trusted";
  const lines = [
    `${project}: run.yaml, hash ${info.hash ?? "none"}, ${trust}`,
    ...info.errors.map((error) => `error: ${error}`),
  ];
  const file = info.config;
  if (!file) return lines;
  lines.push(`exclusive: ${file.exclusive ? "yes" : "no"}`);
  lines.push(`ports: ${file.ports.length === 0 ? "none" : file.ports.join(", ")}`);
  lines.push(
    ...(file.setup && file.setup.length > 0
      ? ["setup:", ...file.setup.map((c) => `  ${c}`)]
      : ["setup: none"]),
  );
  if (file.run.length === 0) return lines;
  lines.push("processes:");
  for (const process of file.run) {
    const ready = process.ready ? `, ready ${process.ready.http}` : "";
    const names = Object.keys(process.env);
    const env = names.length > 0 ? `, env ${names.join(", ")}` : "";
    lines.push(`  ${process.name}: ${process.cmd.join(" ")}${ready}${env}`);
  }
  return lines;
}

/** The state as the protocol returns it, with the fields an older daemon leaves out as `null`. */
export const stateJson = (state: RunState) => ({
  ...state,
  setupTerminalId: state.setupTerminalId ?? null,
  error: state.error ?? null,
  processes: state.processes.map((process) => ({
    ...process,
    exitCode: process.exitCode ?? null,
    url: process.url ?? null,
  })),
});

const READY = { none: "no ready check", waiting: "waiting", ready: "ready", timeout: "timeout" };

function processLine(process: RunProcessState): string {
  const status =
    process.status === "running"
      ? "running"
      : `exited${process.exitCode == null ? "" : ` with code ${process.exitCode}`}`;
  const url = process.url ? `, ${process.url}` : "";
  return `  ${process.name} (${process.terminalId}): ${status}, ${READY[process.ready]}${url}`;
}

/** The card's run: its state, its ports, one line a process with the terminal it runs in, and what went wrong. */
export function stateLines(state: RunState): string[] {
  const ports = Object.entries(state.ports);
  return [
    `${state.cardId}: ${state.status}, setup ${state.setup}`,
    ...(ports.length > 0
      ? [`ports: ${ports.map(([name, port]) => `${name} ${port}`).join(", ")}`]
      : []),
    ...state.processes.map(processLine),
    ...(state.error ? [`error: ${state.error}`] : []),
  ];
}

/** One update of a stream is one line: the stream flattens a line break, so the lines are joined with `; `. */
export const streamLine = (state: RunState): string =>
  stateLines(state)
    .map((line) => line.trim())
    .join("; ");
