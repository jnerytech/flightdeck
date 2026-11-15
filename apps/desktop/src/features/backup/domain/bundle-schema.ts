import { z } from "zod";
import { Item } from "./restore-judgement.ts";

/** The shape of a backup bundle: which preference keys it carries and what each list holds. */
export const VERSION = 1;
export const PREFIX = "flightdeck.";
export const PERSONAS_KEY = `${PREFIX}personas`;
export const SNIPPETS_KEY = `${PREFIX}snippets`;

/**
 * The preference keys a backup carries, by name. A key outside this list is window state, a log, a
 * cache or something of this machine only (a path): it is never written by a restore, whatever
 * the file says.
 */
export const BACKUP_SETTING_KEYS = [
  "theme",
  "lang",
  "density",
  "notifyPrefs",
  "newSessionPrefs",
  "uiMode",
  "roi",
  "cacheTimer",
  "cacheTtl",
  "clients",
  "clientBudgetAlerts",
  "assistant",
  "vaultRules",
].map((name) => `${PREFIX}${name}`);

const Host = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  token: z.string().nullable(),
});
export type BackupHost = z.infer<typeof Host>;

const Entry = z.object({
  meta: z.object({
    id: z.string(),
    name: z.string(),
    type: z.enum(["ssh-key", "password", "token", "env"]),
    description: z.string(),
    tags: z.array(z.string()),
    createdAt: z.number(),
    lastUsedAt: z.number().nullable(),
    allowedHosts: z.array(z.string()),
  }),
  value: z.string(),
});

export const Bundle = z.object({
  kind: z.literal("flightdeck-backup"),
  version: z.literal(VERSION),
  createdAt: z.string(),
  settings: z.record(z.string(), z.string()),
  personas: z.array(Item),
  snippets: z.array(Item),
  hosts: z.array(Host),
  vault: z.array(Entry),
});
export type Bundle = z.infer<typeof Bundle>;
