/**
 * Issue #3456: `flightdeckd persona list|show|subagents`, the personas from a terminal or a script.
 * It speaks to the local daemon like `flightdeckd card` does (the same `DaemonClient`, the token of
 * the config). Exit codes: 0 done, 1 refused, 2 no daemon.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  type CliResult,
  type DaemonClient,
  failure,
  json,
  runOnLocalDaemon,
  said,
} from "../daemon-client/index.ts";
import {
  hashChanged,
  listLines,
  type PersonaCliArgs,
  personaOf,
  publishRefusal,
  shortHash,
  showLines,
  subagentsLines,
  UNSURE,
} from "./domain/persona-cli-view.ts";

const DEFAULT_TIMEOUT_MS = 15_000;

type Note = { wrote: boolean };

/** The body of a saved persona: the flag's text, or the whole file; null when the file cannot be read. */
async function bodyOf(args: PersonaCliArgs): Promise<string | null> {
  if (args.body !== undefined || args.bodyFile === undefined) return args.body ?? "";
  try {
    return await readFile(args.bodyFile, "utf8");
  } catch {
    return null;
  }
}

async function save(
  args: PersonaCliArgs,
  daemon: DaemonClient,
  note: Note,
  where: { projectPath?: string },
  body: string,
): Promise<CliResult> {
  note.wrote = true;
  const saved = await daemon.call("personas.save", {
    scope: args.scope === "project" ? "project" : "host",
    ...where,
    persona: personaOf(args, body),
  });
  return args.json ? json(saved) : said(`saved ${saved.id} (${args.scope})`);
}

/**
 * Trusting a project persona lets its versioned text into every session of the project, so the person
 * names the start of the hash they were shown and this trusts that exact content: a file that changed
 * since is refused, as the app's button would show the new hash first.
 */
async function trust(
  args: PersonaCliArgs,
  daemon: DaemonClient,
  note: Note,
  projectPath: string,
): Promise<CliResult> {
  const { personas } = await daemon.call("personas.list", { scope: "project", projectPath });
  const found = personas.find((p) => p.scope === "project" && p.id === args.id);
  if (found === undefined) return failure(1, `no project persona ${args.id} in ${projectPath}`);
  const hash = found.hash ?? "";
  if (!hash.startsWith(args.hash ?? ""))
    return failure(1, hashChanged(args.id ?? "", args.hash ?? "", hash));
  if (found.trusted) return said(`${found.id} is already trusted`);
  note.wrote = true;
  const trusted = await daemon.call("personas.trust", { projectPath, id: found.id, hash });
  return args.json ? json(trusted) : said(`trusted ${trusted.id}  ${shortHash(hash)}`);
}

export async function runPersonaCli(
  args: PersonaCliArgs,
  config: { bind: string; port: number; token: string },
  options: { timeoutMs?: number } = {},
): Promise<CliResult> {
  // A relative folder means the one the person is in, which the daemon cannot see.
  const projectPath = args.projectPath === undefined ? undefined : resolve(args.projectPath);
  const where = projectPath === undefined ? {} : { projectPath };
  const language = args.language === undefined ? {} : { language: args.language };
  // Nothing is sent for a body that cannot be read, so the daemon is not even asked.
  const body = args.action === "save" ? await bodyOf(args) : "";
  if (body === null) return failure(1, `cannot read the body file ${args.bodyFile ?? ""}`);
  return runOnLocalDaemon({
    config,
    clientName: "flightdeck-persona",
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    unsure: UNSURE,
    perform: async (daemon, note) => {
      switch (args.action) {
        case "list": {
          const answer = await daemon.call("personas.list", {
            ...(args.scope === undefined ? {} : { scope: args.scope }),
            ...where,
            ...language,
          });
          return args.json ? json(answer) : said(...listLines(answer));
        }
        case "show": {
          const answer = await daemon.call("personas.resolve", {
            ref: { id: args.id ?? "", ...language },
            ...where,
          });
          return args.json ? json(answer) : said(...showLines(answer));
        }
        case "subagents": {
          const answer = await daemon.call("personas.subagents", { ...where, ...language });
          return args.json ? json(answer) : said(...subagentsLines(answer));
        }
        case "save":
          return save(args, daemon, note, where, body);
        case "remove": {
          note.wrote = true;
          const scope = args.scope === "project" ? "project" : "host";
          await daemon.call("personas.remove", { scope, id: args.id ?? "", ...where });
          return args.json
            ? json({ id: args.id, scope, removed: true })
            : said(`removed ${args.id} (${scope})`);
        }
        case "reset": {
          note.wrote = true;
          const reset = await daemon.call("personas.reset", { id: args.id ?? "", ...language });
          return args.json ? json(reset) : said(`reset ${reset.id} to the pack's version`);
        }
        case "publish-agent": {
          if (!args.confirm) return failure(1, publishRefusal(args));
          note.wrote = true;
          const published = await daemon.call("personas.publishAgent", {
            id: args.id ?? "",
            projectPath: projectPath ?? "",
            ...language,
            confirm: true,
          });
          return args.json ? json(published) : said(`wrote ${published.path}`);
        }
        case "trust":
          return trust(args, daemon, note, projectPath ?? "");
      }
    },
  });
}
