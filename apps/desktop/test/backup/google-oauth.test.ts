import { describe, expect, test } from "bun:test";
import { DriveError } from "../../src/features/backup/drive-target.ts";
import { googleSignIn, REFRESH_TOKEN_ID } from "../../src/features/backup/google-oauth.ts";
import { fakeOAuth } from "../fake-google.ts";

/**
 * Issue #1444: the desktop sign-in with Google is a loopback PKCE flow. The refresh token goes only
 * to the vault; the access token lives in memory. Google is a fake here: nothing real is touched.
 */
const HOUR = 3_600_000;

function setup(
  options: {
    redirect?: { code: string; state: string } | null | "echo";
    config?: { clientId: string; clientSecret?: string };
  } = {},
) {
  const oauth = fakeOAuth();
  const keyring = new Map<string, string>();
  const stored = new Map<string, string>();
  const opened: string[] = [];
  const listened: string[] = [];
  let clock = 1_000_000;
  let cancelled = 0;
  const redirect = options.redirect === undefined ? "echo" : options.redirect;
  const sign = googleSignIn({
    config: options.config ?? { clientId: "client-1" },
    fetch: oauth.fetch,
    vault: {
      get: async (id: string) => keyring.get(id) ?? null,
      set: async (id: string, value: string) => {
        keyring.set(id, value);
      },
      delete: async (id: string) => {
        keyring.delete(id);
      },
    } as never,
    loopback: {
      listen: async (state: string) => ({
        ...(listened.push(state), {}),
        port: 4567,
        wait: async () => {
          if (redirect === "echo") {
            const state = new URL(opened.at(-1) ?? "http://x").searchParams.get("state") ?? "";
            return { code: "the-code", state };
          }
          return redirect;
        },
        cancel: () => {
          cancelled += 1;
        },
      }),
    },
    openExternal: async (url) => {
      opened.push(url);
    },
    now: () => clock,
  });
  return {
    sign,
    oauth,
    keyring,
    stored,
    opened,
    listened,
    cancelled: () => cancelled,
    tick: (ms: number) => (clock += ms),
  };
}

async function sha256Url(text: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
  );
  return btoa(String.fromCharCode(...digest))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

describe("googleSignIn.signIn", () => {
  test("asks Google for the app data scope with a PKCE challenge and a loopback redirect", async () => {
    const { sign, opened } = setup();
    await sign.signIn();
    const url = new URL(opened[0] ?? "http://none");
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe("client-1");
    expect(url.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/drive.appdata");
    expect(url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:4567");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect((url.searchParams.get("state") ?? "").length).toBeGreaterThanOrEqual(16);
  });

  test("gives the loopback listener the state that is in the consent URL, before it opens the page", async () => {
    const { sign, opened, listened } = setup();
    await sign.signIn();
    const state = new URL(opened[0] ?? "http://none").searchParams.get("state");
    expect(listened).toEqual([state ?? "no"]);
    expect(listened[0]?.length).toBeGreaterThanOrEqual(16);
  });

  test("exchanges the code with the verifier behind the challenge and keeps only the refresh token in the vault", async () => {
    const { sign, oauth, keyring, opened } = setup();
    expect(await sign.signIn()).toBe("signed-in");
    const exchange = oauth.requests[0] ?? {};
    expect(exchange.grant_type).toBe("authorization_code");
    expect(exchange.code).toBe("the-code");
    expect(exchange.client_id).toBe("client-1");
    expect(exchange.redirect_uri).toBe("http://127.0.0.1:4567");
    expect(exchange.client_secret).toBeUndefined();
    const challenge = new URL(opened[0] ?? "http://none").searchParams.get("code_challenge");
    expect(await sha256Url(exchange.code_verifier ?? "")).toBe(challenge ?? "no");
    expect([...keyring.entries()]).toEqual([[REFRESH_TOKEN_ID, "refresh-1"]]);
    expect(await sign.signedIn()).toBe(true);
  });

  test("sends the client secret when the client has one, in the exchange and in the refresh", async () => {
    const { sign, oauth } = setup({ config: { clientId: "client-1", clientSecret: "shh" } });
    await sign.signIn();
    await sign.auth.token(true);
    expect(oauth.requests.map((form) => form.client_secret)).toEqual(["shh", "shh"]);
  });

  test("refuses a redirect whose state is not the one it sent and asks Google for nothing", async () => {
    const { sign, oauth, keyring } = setup({ redirect: { code: "the-code", state: "forged" } });
    expect(await sign.signIn()).toBe("refused");
    expect(oauth.requests.length).toBe(0);
    expect(keyring.size).toBe(0);
  });

  test("a cancelled or timed-out wait is cancelled and stores nothing", async () => {
    const { sign, oauth, keyring, opened } = setup({ redirect: null });
    expect(await sign.signIn()).toBe("cancelled");
    expect(opened.length).toBe(1);
    expect(oauth.requests.length).toBe(0);
    expect(keyring.size).toBe(0);
  });

  test("a code Google refuses is refused and stores nothing", async () => {
    const { sign, oauth, keyring } = setup();
    oauth.codes.clear();
    expect(await sign.signIn()).toBe("refused");
    expect(keyring.size).toBe(0);
  });
});

describe("googleSignIn: the loopback listener", () => {
  test("is closed once however the sign-in ends: signed in, cancelled, forged state, refused code", async () => {
    const ended = [
      setup(),
      setup({ redirect: null }),
      setup({ redirect: { code: "the-code", state: "forged" } }),
    ];
    const refused = setup();
    refused.oauth.codes.clear();
    ended.push(refused);
    for (const one of ended) {
      await one.sign.signIn();
      expect(one.cancelled()).toBe(1);
    }
  });
});

describe("googleSignIn: scope and sign-out", () => {
  test("a sign-in that did not grant the app data scope is refused and stores nothing", async () => {
    const { sign, oauth, keyring } = setup();
    oauth.scope = "openid email";
    expect(await sign.signIn()).toBe("refused");
    expect(keyring.size).toBe(0);
  });

  test("signing out asks Google to revoke the token, and still signs out if that fails", async () => {
    const { sign, oauth, keyring } = setup();
    await sign.signIn();
    await sign.signOut();
    expect(oauth.revoked).toEqual(["refresh-1"]);
    expect(keyring.size).toBe(0);
    // The fake spends a code once: give it another, so this sign-in really stores a token.
    oauth.codes.add("the-code");
    expect(await sign.signIn()).toBe("signed-in");
    expect(keyring.size).toBe(1);
    oauth.offline = true;
    await sign.signOut();
    expect(keyring.size).toBe(0);
    expect(await sign.signedIn()).toBe(false);
  });
});

describe("googleSignIn.auth", () => {
  test("hands out the access token from the sign-in without asking Google again", async () => {
    const { sign, oauth } = setup();
    await sign.signIn();
    expect(await sign.auth.token()).toBe("access-1");
    expect(oauth.requests.length).toBe(1);
  });

  test("refreshes with the stored token once the access token has expired", async () => {
    const { sign, oauth, tick } = setup();
    await sign.signIn();
    tick(HOUR);
    expect(await sign.auth.token()).toBe("access-2");
    expect(oauth.requests[1]).toEqual({
      grant_type: "refresh_token",
      refresh_token: "refresh-1",
      client_id: "client-1",
    });
  });

  test("refreshes on demand even when the access token looks fresh", async () => {
    const { sign } = setup();
    await sign.signIn();
    expect(await sign.auth.token(true)).toBe("access-2");
  });

  test("a refused refresh token is an auth failure and leaves the vault", async () => {
    const { sign, oauth, keyring } = setup();
    await sign.signIn();
    oauth.refreshTokens.clear();
    const failure = await sign.auth.token(true).catch((e: unknown) => e);
    expect(failure instanceof DriveError && failure.kind).toBe("auth");
    expect(keyring.size).toBe(0);
    expect(await sign.signedIn()).toBe(false);
  });

  test("a Google server error or throttling on refresh keeps the refresh token and is not an auth failure", async () => {
    for (const status of [503, 429]) {
      const { sign, oauth, keyring } = setup();
      await sign.signIn();
      oauth.failWith = status;
      const failure = await sign.auth.token(true).catch((e: unknown) => e);
      expect(failure instanceof DriveError && failure.kind).toBe("http");
      expect(keyring.get(REFRESH_TOKEN_ID)).toBe("refresh-1");
    }
  });

  test("with no sign-in the token is an auth failure and Google is not asked", async () => {
    const { sign, oauth } = setup();
    const failure = await sign.auth.token().catch((e: unknown) => e);
    expect(failure instanceof DriveError && failure.kind).toBe("auth");
    expect(oauth.requests.length).toBe(0);
  });

  test("a network failure on refresh keeps the refresh token for the next try", async () => {
    const { sign, oauth, keyring } = setup();
    await sign.signIn();
    oauth.offline = true;
    const failure = await sign.auth.token(true).catch((e: unknown) => e);
    expect(failure instanceof DriveError).toBe(false);
    expect(failure instanceof Error).toBe(true);
    expect(keyring.get(REFRESH_TOKEN_ID)).toBe("refresh-1");
  });

  test("an error never carries a token", async () => {
    const { sign, oauth } = setup();
    await sign.signIn();
    oauth.offline = true;
    const failure = await sign.auth.token(true).catch((e: unknown) => e);
    expect(failure instanceof Error).toBe(true);
    const message = failure instanceof Error ? failure.message : "";
    expect(message.includes("refresh-1") || message.includes("access-1")).toBe(false);
  });

  test("signing out removes the refresh token", async () => {
    const { sign, keyring } = setup();
    await sign.signIn();
    expect(keyring.size).toBe(1);
    await sign.signOut();
    expect(keyring.size).toBe(0);
    expect(await sign.signedIn()).toBe(false);
  });
});
