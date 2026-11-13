import type { BackupTarget } from "./backup-target.ts";

/** What the Drive target needs from the sign-in: an access token, a fresh one when `refresh` is set. */
export interface DriveAuth {
  token(refresh?: boolean): Promise<string>;
}

export type DriveFailure = "auth" | "not-found" | "http" | "upload";

/** A Drive call that failed. The message never carries a token. */
export class DriveError extends Error {
  constructor(
    readonly kind: DriveFailure,
    readonly status = 0,
  ) {
    super(`drive ${kind} ${status}`);
  }
}

const API = "https://www.googleapis.com";
const FILES = `${API}/drive/v3/files`;
const UPLOAD = `${API}/upload/drive/v3/files`;
/** Drive's own folder for the app: the app sees only the files it put there. */
const APP_FOLDER = "appDataFolder";

/**
 * Issue #1444: the backups on Google Drive, in the app's hidden `appDataFolder`, over an injected
 * `fetch`. The bundle is already encrypted before it gets here. A call that Drive refuses with 401 is
 * made once more with a fresh token; a second 401 is an `auth` failure, so a revoked sign-in stops
 * at once instead of retrying.
 */
export function driveTarget(deps: { fetch: typeof fetch; auth: DriveAuth }): BackupTarget {
  const { auth } = deps;

  async function call(url: string, init: RequestInit = {}): Promise<Response> {
    const send = async (refresh: boolean) => {
      const token = await auth.token(refresh);
      return deps.fetch(url, {
        ...init,
        headers: { ...init.headers, authorization: `Bearer ${token}` },
      });
    };
    const first = await send(false);
    if (first.status !== 401) return first;
    const second = await send(true);
    if (second.status === 401) throw new DriveError("auth", 401);
    return second;
  }

  async function ok(url: string, init?: RequestInit): Promise<Response> {
    const response = await call(url, init);
    if (!response.ok) {
      throw new DriveError(response.status === 404 ? "not-found" : "http", response.status);
    }
    return response;
  }

  async function entries(): Promise<Array<{ id: string; name: string }>> {
    const found: Array<{ id: string; name: string }> = [];
    let page: string | undefined;
    do {
      const query = new URLSearchParams({
        spaces: APP_FOLDER,
        q: "trashed = false",
        fields: "nextPageToken,files(id,name)",
        pageSize: "100",
      });
      if (page) query.set("pageToken", page);
      type DrivePage = { files?: Array<{ id: string; name: string }>; nextPageToken?: string };
      const body = (await (await ok(`${FILES}?${query}`)).json()) as DrivePage; // NOSONAR: each Drive page names the next one, so the pages are read in order
      found.push(...(body.files ?? []));
      page = body.nextPageToken;
    } while (page);
    return found;
  }

  async function idOf(name: string): Promise<string> {
    const one = (await entries()).find((entry) => entry.name === name);
    if (!one) throw new DriveError("not-found", 404);
    return one.id;
  }

  return {
    async put(name, text) {
      const started = await ok(`${UPLOAD}?uploadType=resumable`, {
        method: "POST",
        headers: {
          "content-type": "application/json; charset=UTF-8",
          "x-upload-content-type": "text/plain",
        },
        body: JSON.stringify({ name, parents: [APP_FOLDER] }),
      });
      const session = started.headers.get("location") ?? "";
      // The session address comes from the response: only Google's own is used, and without the token.
      if (!session.startsWith(`${UPLOAD}?`)) throw new DriveError("upload");
      const sent = await deps.fetch(session, {
        method: "PUT",
        headers: { "content-type": "text/plain" },
        body: text,
      });
      if (!sent.ok) throw new DriveError("upload", sent.status);
    },
    async list() {
      return (await entries()).map((entry) => entry.name);
    },
    async get(name) {
      const id = await idOf(name);
      return (await ok(`${FILES}/${encodeURIComponent(id)}?alt=media`)).text();
    },
    async remove(name) {
      const id = await idOf(name);
      await ok(`${FILES}/${encodeURIComponent(id)}`, { method: "DELETE" });
    },
  };
}
