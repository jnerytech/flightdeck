import type { Key, T } from "../../../i18n/index.ts";
import type { CompareField } from "./host-compare-model.ts";

const HOOK_WORDS: Record<string, Key> = {
  ok: "hostCompare.hooks.ok",
  outdated: "hostCompare.hooks.outdated",
  missing: "hostCompare.hooks.missing",
};
const SIGNIN_WORDS: Record<string, Key> = {
  ok: "hostCompare.signin.ok",
  outdated: "hostCompare.signin.outdated",
  missing: "hostCompare.signin.missing",
  na: "hostCompare.signin.na",
};
const TOOL_WORDS: Record<string, Key> = {
  ok: "hostCompare.tool.ok",
  outdated: "hostCompare.tool.outdated",
  missing: "hostCompare.tool.missing",
  na: "hostCompare.tool.na",
};
const BOOT_WORDS: Record<string, Key> = {
  ok: "hostCompare.boot.ok",
  outdated: "hostCompare.boot.outdated",
  missing: "hostCompare.boot.missing",
  na: "hostCompare.boot.na",
};
const OS_WORDS: Record<string, Key> = {
  linux: "hostCompare.os.linux",
  darwin: "hostCompare.os.darwin",
  win32: "hostCompare.os.win32",
};
/** The words of the fields whose value is a status; an unknown one reads as not known. */
const WORDS: Partial<Record<CompareField, Record<string, Key>>> = {
  hooks: HOOK_WORDS,
  signin: SIGNIN_WORDS,
  gh: TOOL_WORDS,
  az: TOOL_WORDS,
  boot: BOOT_WORDS,
};

/** A value as the person reads it: the word for a status, the count of a feature set, a version as is. */
export function shown(field: CompareField, value: string, t: T): string {
  if (field === "features") return String(value === "" ? 0 : value.split(",").length);
  if (field === "os") return t(OS_WORDS[value] ?? "hostCompare.unknown");
  const words = WORDS[field];
  return words ? t(words[value] ?? "hostCompare.unknown") : value;
}
