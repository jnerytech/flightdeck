import type { ReleaseNote } from "@flightdeck/protocol";
import { refusalText } from "../../i18n/errors.ts";
import type { AppKernel } from "../../lib/kernel.ts";
import { hasFeature } from "../../lib/version.ts";

/** What reading the app's release notes came to: the releases, no host that can read them, or a refusal. */
export type ReleaseNotesResult =
  | { kind: "ready"; releases: ReleaseNote[] }
  | { kind: "none" }
  | { kind: "error"; message: string };

/** What the notes need to know of a host. */
interface NotesHost {
  id: string;
  status: string;
  hostInfo?: { features?: readonly string[] } | null;
}

/** The app's latest releases, read through the first online host that offers them (issue #125). */
export async function releaseNotes(
  kernel: Pick<AppKernel<{ hosts: NotesHost[] }>, "state" | "hostRequest" | "t">,
): Promise<ReleaseNotesResult> {
  const host = kernel
    .state()
    .hosts.find(
      (h) => h.status === "online" && hasFeature(h.hostInfo?.features, "releases", false),
    );
  if (!host) return { kind: "none" };
  const result = await kernel.hostRequest(host.id, "releases.list", { limit: 8 });
  if (result.ok) return { kind: "ready", releases: result.data.releases };
  return {
    kind: "error",
    message: refusalText(result.code, result.message, kernel.t(), result),
  };
}
