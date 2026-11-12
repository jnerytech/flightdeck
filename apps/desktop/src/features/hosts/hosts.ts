import { z } from "zod";
import { readStored, validItems } from "@/shared/lib/index.ts";

export const HOSTS_KEY = "flightdeck.hosts";

/** What is stored in plain settings; the token is kept by the platform's credential store. */
export const HostConfig = z.object({ id: z.string(), name: z.string(), url: z.string() });
export type HostConfig = z.infer<typeof HostConfig>;

/** The kept hosts; one that is not a host is left out, the others stay (#1609). */
export function loadHosts(storage: { getItem(key: string): string | null }): HostConfig[] {
  return readStored(storage, HOSTS_KEY, validItems(HostConfig), []);
}

export function saveHosts(
  storage: { setItem(key: string, value: string): void },
  hosts: HostConfig[],
): void {
  storage.setItem(HOSTS_KEY, JSON.stringify(hosts));
}
