import { FlightdeckError, parseJsonOr } from "../../kernel/index.ts";
import { JsonObject } from "./json-reads.ts";
import type { ChangeResult } from "./results.ts";

/**
 * How the plugin manager reads the CLI's answers and checks what it hands the CLI (#1589):
 * `arg` is the guard that keeps a value from reading as an option, and the rest are the readers
 * of loosely shaped JSON.
 */

type Params = Record<string, string | number>;
const bad = (message: string, reason: string, params?: Params) =>
  new FlightdeckError("bad_request", message, reason, params);

/** A value that goes to the CLI as an argument: never one that would read as an option. */
export function arg(value: string): string {
  if (value.startsWith("-")) throw bad(`value refused: ${value}`, "plugin_arg_refused", { value });
  return value;
}

export const invalid = (message: string, reason: string, params?: Params) =>
  new FlightdeckError("invalid_state", message, reason, params);

export type Json = Record<string, unknown>;
export const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
export const text = (value: unknown) => (typeof value === "string" ? value : undefined);
export const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** The id `name@marketplace` split at its last `@`. */
export function split(id: string): { name: string; marketplace: string } {
  const at = id.lastIndexOf("@");
  return at < 0
    ? { name: id, marketplace: "" }
    : { name: id.slice(0, at), marketplace: id.slice(at + 1) };
}

/** The CLI prints its answer as JSON on the last line; null when that line is not an object. */
export function lastJsonLine(stdout: string): Json | null {
  const line = stdout.trim().split(/\r?\n/).at(-1) ?? "";
  return parseJsonOr(JsonObject.nullable(), line, null);
}

/** The command the marketplace wants shown, when it came with a hash to send back. */
export function shownCommandOf(value: unknown): ChangeResult["shownCommand"] | null {
  if (!isObject(value)) return null;
  const sha256 = text(value.sha256);
  if (!sha256) return null;
  const command = text(value.command);
  const plugin = text(value.plugin);
  return { ...(command ? { command } : {}), ...(plugin ? { plugin } : {}), sha256 };
}

/** Where a plugin is installed: for the user, for the project, or local to this checkout. */
export type PluginScope = "user" | "project" | "local";
