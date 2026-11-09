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
        const all = [...files.entries()]
          .filter(([, file]) => file.parents.includes("appDataFolder"))
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
        return new Response(file.text, { status: 200 });
      }
      return json({}, 404);
    }) as typeof fetch,
  };
  return drive;
}
