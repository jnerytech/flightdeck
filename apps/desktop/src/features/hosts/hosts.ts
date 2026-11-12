import { z } from "zod";

export const HOSTS_KEY = "flightdeck.hosts";

/** What is stored in plain settings; the token is kept by the platform's credential store. */
export const HostConfig = z.object({ id: z.string(), name: z.string(), url: z.string() });
export type HostConfig = z.infer<typeof HostConfig>;

export function loadHosts(storage: { getItem(key: string): string | null }): HostConfig[] {
  try {
    return z.array(HostConfig).parse(JSON.parse(storage.getItem(HOSTS_KEY) ?? "[]"));
  } catch {
    return [];
  }
}

export function saveHosts(
  storage: { setItem(key: string, value: string): void },
  hosts: HostConfig[],
): void {
  storage.setItem(HOSTS_KEY, JSON.stringify(hosts));
}
