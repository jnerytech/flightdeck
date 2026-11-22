import type { HostDraft } from "../../../lib/router.ts";
import { draftUrl } from "./host-draft.ts";

/** What the host list holds of each host: the name it shows and the address it connects to. */
export interface ListedHost {
  name: string;
  url: string;
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** `host:port` as the URL parser writes it, so `FD7A::1` and `fd7a:0:0::1` are one address; null for a URL that is none. */
function endpoint(url: string): string | null {
  try {
    const parsed = new URL(url.replace(/^ws:/, "http:"));
    return `${parsed.hostname}:${parsed.port}`;
  } catch {
    return null;
  }
}

/** The fields of a draft that another host already has, each with the name of that host. */
export function hostDuplicates(
  draft: HostDraft,
  hosts: readonly ListedHost[],
): Partial<Record<"name" | "address", string>> {
  const taken: Partial<Record<"name" | "address", string>> = {};
  const byName = hosts.find((h) => sameName(h.name, draft.name));
  if (byName) taken.name = byName.name;
  const mine = endpoint(draftUrl(draft));
  const byAddress = mine === null ? undefined : hosts.find((h) => endpoint(h.url) === mine);
  if (byAddress) taken.address = byAddress.name;
  return taken;
}
