import type { Platform } from "../platform/types.ts";
import { type DriveAuth, DriveError } from "./drive-target.ts";

/** The Google Cloud OAuth client of the app; none until the maintainer makes one (#57). */
export interface GoogleConfig {
  clientId: string;
  /** Google's "desktop" clients come with a secret that is not one; set only when the client has it. */
  clientSecret?: string;
}

export type SignInResult = "signed-in" | "cancelled" | "refused";

export interface GoogleSignIn {
  /** Opens Google's consent page in the browser and waits for the redirect on the loopback. */
  signIn(): Promise<SignInResult>;
  /** Whether a refresh token is held. */
  signedIn(): Promise<boolean>;
  /** Forgets the sign-in: the refresh token leaves the vault. */
  signOut(): Promise<void>;
  /** The access token for Drive calls. */
  auth: DriveAuth;
}

export interface GoogleDeps {
  config: GoogleConfig;
  fetch: typeof fetch;
  vault: Platform["vault"];
  loopback: NonNullable<Platform["oauthLoopback"]>;
  openExternal: (url: string) => Promise<void>;
  now?: () => number;
}

/** The vault id of the refresh token. It has no vault metadata, so no screen lists it and no backup carries it. */
export const REFRESH_TOKEN_ID = "flightdeck-google-drive-refresh";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/drive.appdata";
/** An access token is renewed this long before it expires. */
const MARGIN_MS = 60_000;

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

const random = (size: number) => base64Url(crypto.getRandomValues(new Uint8Array(size)));

async function challengeOf(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

interface TokenReply {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
}

/**
 * Issue #1444: signing in with Google from a desktop app, by the loopback PKCE flow. The refresh token
 * goes only to the vault; the access token stays in memory. A refresh Google refuses (the person
 * revoked the app) drops the token and reads as an auth failure; a network failure keeps it. Nothing
 * here is logged and no error carries a token.
 */
export function googleSignIn(deps: GoogleDeps): GoogleSignIn {
  const { config, vault } = deps;
  const now = deps.now ?? Date.now;
  let access: { token: string; until: number } | null = null;

  async function ask(form: Record<string, string>): Promise<TokenReply | null> {
    const body = new URLSearchParams({ client_id: config.clientId, ...form });
    if (config.clientSecret) body.set("client_secret", config.clientSecret);
    const response = await deps.fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!response.ok) return null;
    return (await response.json()) as TokenReply;
  }

  function keep(reply: TokenReply): boolean {
    if (!reply.access_token) return false;
    access = { token: reply.access_token, until: now() + (reply.expires_in ?? 0) * 1000 };
    return true;
  }

  async function refreshed(): Promise<string> {
    const stored = await vault.get(REFRESH_TOKEN_ID);
    if (!stored) throw new DriveError("auth");
    const reply = await ask({ grant_type: "refresh_token", refresh_token: stored });
    if (!reply || !keep(reply)) {
      access = null;
      await vault.delete(REFRESH_TOKEN_ID);
      throw new DriveError("auth", 400);
    }
    if (reply.refresh_token && reply.refresh_token !== stored) {
      await vault.set(REFRESH_TOKEN_ID, reply.refresh_token);
    }
    return access?.token ?? "";
  }

  return {
    async signIn() {
      const listener = await deps.loopback.listen();
      const redirect = `http://127.0.0.1:${listener.port}`;
      const verifier = random(32);
      const state = random(16);
      const query = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: redirect,
        response_type: "code",
        scope: SCOPE,
        code_challenge: await challengeOf(verifier),
        code_challenge_method: "S256",
        state,
        access_type: "offline",
        prompt: "consent",
      });
      try {
        await deps.openExternal(`${AUTH_URL}?${query}`);
        const answer = await listener.wait();
        if (!answer) return "cancelled";
        // A redirect that is not the answer to this sign-in (another page hit the port) is not trusted.
        if (answer.state !== state) return "refused";
        const reply = await ask({
          grant_type: "authorization_code",
          code: answer.code,
          code_verifier: verifier,
          redirect_uri: redirect,
        });
        if (!reply?.refresh_token || !keep(reply)) return "refused";
        await vault.set(REFRESH_TOKEN_ID, reply.refresh_token);
        return "signed-in";
      } finally {
        listener.cancel();
      }
    },
    async signedIn() {
      return (await vault.get(REFRESH_TOKEN_ID)) !== null;
    },
    async signOut() {
      access = null;
      await vault.delete(REFRESH_TOKEN_ID);
    },
    auth: {
      async token(refresh = false) {
        if (!refresh && access && access.until - MARGIN_MS > now()) return access.token;
        return refreshed();
      },
    },
  };
}
