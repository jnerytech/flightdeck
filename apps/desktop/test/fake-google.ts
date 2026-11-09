/**
 * A fake Google for the backup tests (#1444): the Drive v3 routes the Drive target uses, over an
 * injected `fetch`. Nothing leaves the process.
 */
export interface FakeDrive {
  fetch: typeof fetch;
  /** The files held: id → name, parents and text. */
  files: Map<string, { name: string; parents: string[]; text: string }>;
  /** Every request made: method, url and the Authorization header (or null). */
  calls: Array<{ method: string; url: string; auth: string | null }>;
  /** Tokens the fake accepts; a request with another gets 401. */
  accept: Set<string>;
  /** The page size of a listing, to test paging. */
  pageSize: number;
}

const API = "https://www.googleapis.com";

export function fakeDrive(options: { sessionHost?: string } = {}): FakeDrive {
  const files: FakeDrive["files"] = new Map();
  const sessions = new Map<string, { name: string; parents: string[] }>();
  const calls: FakeDrive["calls"] = [];
  const drive: FakeDrive = {
    files,
    calls,
    accept: new Set(["good"]),
    pageSize: 100,
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      const method = init?.method ?? "GET";
      const headers = new Headers(init?.headers);
      const auth = headers.get("authorization");
      calls.push({ method, url: url.toString(), auth });
      const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
        new Response(JSON.stringify(body), { status, headers: extra });
      if (
        url.origin === API &&
        !url.pathname.startsWith("/upload/") &&
        !drive.accept.has(auth?.replace("Bearer ", "") ?? "")
      )
        return json({ error: "unauthorized" }, 401);
      if (url.pathname === "/upload/drive/v3/files" && method === "POST") {
        if (!drive.accept.has(auth?.replace("Bearer ", "") ?? "")) return json({}, 401);
        const meta = JSON.parse(String(init?.body)) as { name: string; parents: string[] };
        const id = `up${sessions.size + 1}`;
        sessions.set(id, meta);
        const host = options.sessionHost ?? API;
        return json({}, 200, { location: `${host}/upload/drive/v3/files?upload_id=${id}` });
      }
      if (url.pathname === "/upload/drive/v3/files" && method === "PUT") {
        const session = sessions.get(url.searchParams.get("upload_id") ?? "");
        if (!session) return json({}, 404);
        const id = `f${files.size + 1}`;
        files.set(id, { ...session, text: String(init?.body) });
        return json({ id, name: session.name });
      }
      if (url.pathname === "/drive/v3/files" && method === "GET") {
        // As Google does: without `spaces=appDataFolder` the list is the person's Drive, not the app's.
        const inApp = url.searchParams.get("spaces") === "appDataFolder";
        const all = [...files.entries()]
          .filter(([, file]) => inApp && file.parents.includes("appDataFolder"))
          .map(([id, file]) => ({ id, name: file.name }));
        const from = Number(url.searchParams.get("pageToken") ?? 0);
        const page = all.slice(from, from + drive.pageSize);
        const more = from + drive.pageSize < all.length;
        return json({
          files: page,
          ...(more ? { nextPageToken: String(from + drive.pageSize) } : {}),
        });
      }
      const one = /^\/drive\/v3\/files\/([^/]+)$/.exec(url.pathname);
      if (one) {
        const file = files.get(one[1] ?? "");
        if (!file) return json({}, 404);
        if (method === "DELETE") {
          files.delete(one[1] ?? "");
          return new Response(null, { status: 204 });
        }
        // Without `alt=media` Google answers with the file's metadata, not its content.
        if (url.searchParams.get("alt") !== "media") {
          return json({ id: one[1], name: file.name });
        }
        return new Response(file.text, { status: 200 });
      }
      return json({}, 404);
    }) as typeof fetch,
  };
  return drive;
}

/** The fake token endpoint of Google's OAuth: a code is exchanged once, a refresh token is checked. */
export interface FakeOAuth {
  fetch: typeof fetch;
  /** The form of every request made to the token endpoint. */
  requests: Array<Record<string, string>>;
  /** The codes the fake will exchange. */
  codes: Set<string>;
  /** The refresh tokens it still honours. */
  refreshTokens: Set<string>;
  /** Makes the next requests fail as the network would. */
  offline: boolean;
  /** Counts access tokens handed out: `access-1`, `access-2`... */
  issued: number;
  /** When set, the token endpoint answers every request with this status and `{error: "server"}`. */
  failWith: number | null;
  /** The scope the fake says it granted. */
  scope: string;
  /** The tokens sent to the revoke endpoint. */
  revoked: string[];
}

export function fakeOAuth(): FakeOAuth {
  const oauth: FakeOAuth = {
    requests: [],
    codes: new Set(["the-code"]),
    refreshTokens: new Set(["refresh-1"]),
    offline: false,
    issued: 0,
    failWith: null,
    scope: "https://www.googleapis.com/auth/drive.appdata",
    revoked: [],
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (oauth.offline) throw new TypeError("network down");
      const form = Object.fromEntries(new URLSearchParams(String(init?.body)));
      if (url === "https://oauth2.googleapis.com/revoke") {
        oauth.revoked.push(form.token ?? "");
        return new Response("{}");
      }
      if (url !== "https://oauth2.googleapis.com/token") return new Response("{}", { status: 404 });
      if (oauth.failWith !== null) {
        return new Response(JSON.stringify({ error: "server" }), { status: oauth.failWith });
      }
      oauth.requests.push(form);
      const refused = () =>
        new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
      const access = () => `access-${++oauth.issued}`;
      if (form.grant_type === "authorization_code") {
        if (!oauth.codes.has(form.code ?? "")) return refused();
        oauth.codes.delete(form.code ?? "");
        return new Response(
          JSON.stringify({
            access_token: access(),
            expires_in: 3600,
            refresh_token: "refresh-1",
            scope: oauth.scope,
          }),
        );
      }
      if (form.grant_type === "refresh_token") {
        if (!oauth.refreshTokens.has(form.refresh_token ?? "")) return refused();
        return new Response(JSON.stringify({ access_token: access(), expires_in: 3600 }));
      }
      return refused();
    }) as typeof fetch,
  };
  return oauth;
}

/** Both fakes behind one `fetch`, as the app sees Google: sign-in at oauth2, files at www.googleapis. */
export function fakeGoogle() {
  const drive = fakeDrive();
  const oauth = fakeOAuth();
  drive.accept = new Set(Array.from({ length: 9 }, (_, i) => `access-${i + 1}`));
  const route = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    return url.startsWith("https://oauth2.googleapis.com/")
      ? oauth.fetch(input, init)
      : drive.fetch(input, init);
  }) as typeof fetch;
  return { drive, oauth, fetch: route };
}
