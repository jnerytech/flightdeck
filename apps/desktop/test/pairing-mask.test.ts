import { describe, expect, test } from "bun:test";
import { keptToken, maskPairingLink, TOKEN_MASK } from "../src/lib/pairing-mask.ts";

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
      `flightdeck://[::1]:7420?name=a%20b&token=${TOKEN_MASK}`,
    ]);
  });

  test("no form of the token shows: an encoded key, a repeated one, or a # or space inside it", () => {
    const shown = [
      "flightdeck://pc:7420?%74oken=SECRET",
      "flightdeck://pc:7420?name=a?token=FAKE&token=SECRET",
      "flightdeck://pc:7420?token=SEC#RET",
      "flightdeck://pc:7420?token=SEC RET",
      "flightdeck://pc:7420?token=A&token=B",
    ].map(maskPairingLink);
    expect(shown.map((link) => /SECRET|RET|FAKE|=B/.test(link))).toEqual([
      false,
      false,
      false,
      false,
      false,
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

/** The dots in a shown link are not a token: what the form keeps for the token when the link is edited. */
describe("pairing-mask: which token a link edited in the form carries (#1548)", () => {
  const draft = { address: "127.0.0.1", port: "46507", token: "real-token" };
  const same = { address: "127.0.0.1", port: "46507" };

  test("a token typed or pasted in the link is the token", () => {
    expect(keptToken("new-token", same, draft)).toBe("new-token");
    expect(keptToken("new-token", { address: "10.0.0.2", port: "7420" }, draft)).toBe("new-token");
  });

  test("any token with dots in it is the shown mask, edited or not: the real one is kept", () => {
    expect([
      keptToken("••••", same, draft),
      keptToken("•••", same, draft),
      keptToken("••a••", same, draft),
      keptToken("••••x", same, draft),
    ]).toEqual(["real-token", "real-token", "real-token", "real-token"]);
  });

  test("the real token is not carried to another address or port, and none held means none", () => {
    expect([
      keptToken("••••", { address: "10.0.0.2", port: "46507" }, draft),
      keptToken("••••", { address: "127.0.0.1", port: "7420" }, draft),
      keptToken("••••", same, { ...draft, token: "" }),
    ]).toEqual([null, null, null]);
  });
});
