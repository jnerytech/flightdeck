import type { GoogleConfig } from "../features/backup/google-oauth.ts";
import type { Platform } from "../platform/types.ts";

/** How the demo's Google answers: the `?google=` of the demo's address. */
type DemoGoogleMode = "files" | "empty" | "refused" | "revoked" | "down";

/** What the store gets from `google`: the client and the fake Google behind its `fetch`. */
export interface DemoGoogle {
  config: GoogleConfig;
  fetch: typeof fetch;
}

const MODES: ReadonlySet<string> = new Set<DemoGoogleMode>([
  "files",
  "empty",
  "refused",
  "revoked",
  "down",
]);

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/drive.appdata";
/** The backups the demo's Drive holds, as the app names them. */
const BACKUPS = [
  "flightdeck-backup-20261122-060000.fdbackup",
  "flightdeck-backup-20261121-060000.fdbackup",
  "flightdeck-backup-20261115-060000.fdbackup",
  "flightdeck-backup-20261101-060000.fdbackup",
];

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

/** The fake Google: the token endpoint and Drive's file list, nothing else. Nothing leaves the page. */
function fakeGoogle(mode: DemoGoogleMode): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.href === TOKEN_URL) {
      const grant = new URLSearchParams(String(init?.body)).get("grant_type");
      if (grant === "authorization_code") {
        return mode === "refused"
          ? reply({ error: "invalid_grant" }, 400)
          : reply({
              access_token: "demo-access",
              expires_in: 3600,
              refresh_token: "demo-refresh",
              scope: SCOPE,
            });
      }
      return mode === "revoked"
        ? reply({ error: "invalid_grant" }, 400)
        : reply({ access_token: "demo-access", expires_in: 3600 });
    }
    if (url.pathname !== "/drive/v3/files") return reply({}, 404);
    if (mode === "revoked") return reply({ error: "unauthorized" }, 401);
    if (mode === "down") return reply({ error: "backend" }, 500);
    const names = mode === "empty" ? [] : BACKUPS;
    return reply({ files: names.map((name, index) => ({ id: `demo-${index}`, name })) });
  }) as typeof fetch;
}

/** The demo's Google for the address's `?google=`; null when the address names none. */
export function demoGoogle(search: string): DemoGoogle | null {
  const mode = new URLSearchParams(search).get("google") ?? "";
  if (!MODES.has(mode)) return null;
  return { config: { clientId: "demo" }, fetch: fakeGoogle(mode as DemoGoogleMode) };
}

/** The platform with the shell's side of the sign-in: a loopback that answers at once and a browser that opens nothing. */
export function withDemoGoogle(platform: Platform, search: string): Platform {
  if (!demoGoogle(search)) return platform;
  return {
    ...platform,
    openExternal: async () => {},
    oauthLoopback: {
      listen: async (state) => ({
        port: 4567,
        wait: async () => ({ code: "demo", state }),
        cancel: () => {},
      }),
    },
  };
}
