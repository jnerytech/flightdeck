import { describe, expect, test } from "bun:test";
import { maskPairingLink, TOKEN_MASK } from "../src/lib/pairing-mask.ts";

/** #1548: a pasted pairing link shows its token masked, as the Token field does. */
describe("pairing-mask: the token of a pairing link is shown as dots (#1548)", () => {
  test("the token is replaced and the rest of the link stays as it was", () => {
    expect([
      maskPairingLink("flightdeck://127.0.0.1:46507?name=alfa&token=s3cret-value"),
      maskPairingLink("flightdeck://127.0.0.1:46507?token=s3cret-value&name=alfa"),
      maskPairingLink("flightdeck://[::1]:7420?name=a%20b&token=x%2By#frag"),
    ]).toEqual([
      `flightdeck://127.0.0.1:46507?name=alfa&token=${TOKEN_MASK}`,
      `flightdeck://127.0.0.1:46507?token=${TOKEN_MASK}&name=alfa`,
      `flightdeck://[::1]:7420?name=a%20b&token=${TOKEN_MASK}#frag`,
    ]);
  });

  test("a link with no token, or text that is not a link, is left alone", () => {
    expect([
      maskPairingLink("flightdeck://pc:7420?name=x"),
      maskPairingLink("http://pc:7420?mytoken=abc"),
      maskPairingLink(""),
    ]).toEqual(["flightdeck://pc:7420?name=x", "http://pc:7420?mytoken=abc", ""]);
  });

  test("the mask is dots, never part of a token the app made", () => {
    expect(TOKEN_MASK).toBe("••••");
  });
});
