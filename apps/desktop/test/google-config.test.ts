import { describe, expect, test } from "bun:test";
import { googleConfig } from "../src/lib/google-config.ts";

/** Issue #1444: the Google client id comes from the build's config; with none, Drive stays hidden. */
describe("googleConfig", () => {
  test("no client id, or a blank one, is no config", () => {
    expect([
      googleConfig({}),
      googleConfig({ VITE_GOOGLE_CLIENT_ID: "" }),
      googleConfig({ VITE_GOOGLE_CLIENT_ID: "   " }),
    ]).toEqual([null, null, null]);
  });

  test("a client id is trimmed and kept; the secret only when given", () => {
    expect(googleConfig({ VITE_GOOGLE_CLIENT_ID: " abc.apps.googleusercontent.com " })).toEqual({
      clientId: "abc.apps.googleusercontent.com",
    });
    expect(
      googleConfig({ VITE_GOOGLE_CLIENT_ID: "abc", VITE_GOOGLE_CLIENT_SECRET: "shh" }),
    ).toEqual({ clientId: "abc", clientSecret: "shh" });
    expect(googleConfig({ VITE_GOOGLE_CLIENT_ID: "abc", VITE_GOOGLE_CLIENT_SECRET: " " })).toEqual({
      clientId: "abc",
    });
  });
});
