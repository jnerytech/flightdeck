import { describe, expect, test } from "bun:test";
import { keptToken, maskPairingLink, TOKEN_MASK, tokenInText } from "../src/lib/pairing-mask.ts";

/** #1548: a pasted pairing link shows its token masked, as the Token field does. */
describe("pairing-mask: the token of a pairing link is shown as dots (#1548)", () => {
  test("the token is replaced and the rest of the link stays as it was", () => {
    expect([
      maskPairingLink("flightdeck://127.0.0.1:46507?name=alfa&token=s3cret-value"),
      maskPairingLink("flightdeck://127.0.0.1:46507?token=s3cret-value&name=alfa"),
      maskPairingLink("flightdeck://[::1]:7420?name=a%20b&token=x%2By#frag"),
    ]).toEqual([
      `flightdeck://127.0.0.1:46507?name=alfa&token=${TOKEN_MASK}`,
      // Rebuilt from what the parser read: the name first, whatever the order typed.
      `flightdeck://127.0.0.1:46507?name=alfa&token=${TOKEN_MASK}`,
      `flightdeck://[::1]:7420?name=a%20b&token=${TOKEN_MASK}`,
    ]);
  });

  test("no form of the token shows: an encoded key, a repeated one, or a # or space inside it", () => {
    expect(
      [
        "flightdeck://pc:7420?%74oken=SECRET",
        "flightdeck://pc:7420?token=SEC#RET",
        "flightdeck://pc:7420?token=SEC RET",
        "flightdeck://pc:7420?token=A&token=B",
        "flightdeck://pc:7420?name=a?token=FAKE&token=SECRET",
      ].map(maskPairingLink),
    ).toEqual([
      "flightdeck://pc:7420?name=pc&token=••••",
      "flightdeck://pc:7420?name=pc&token=••••",
      "flightdeck://pc:7420?name=pc&token=••••",
      "flightdeck://pc:7420?name=pc&token=••••",
      "flightdeck://pc:7420?name=a%3Ftoken%3DFAKE&token=••••",
    ]);
  });

  test("text that is not a readable link still hides what follows token=, as typed or encoded", () => {
    expect([
      maskPairingLink("flightdeck://pc:abc?name=x&token=SECRET"),
      maskPairingLink("flightdeck://pc:abc?%74oken=SECRET&name=x"),
      maskPairingLink("flightdeck://pc:abc?token=A&token=B&name=x"),
    ]).toEqual([
      "flightdeck://pc:abc?name=x&token=••••",
      "flightdeck://pc:abc?%74oken=••••&name=x",
      "flightdeck://pc:abc?token=••••&token=••••&name=x",
    ]);
  });

  test("the token in text that may not read: the first one, decoded, or none", () => {
    expect([
      tokenInText("flightdeck://pc:abc?name=x&token=SEC%2BRET"),
      tokenInText("flightdeck://pc:abc?token=A&token=B"),
      tokenInText("flightdeck://pc:abc?name=x"),
      tokenInText("http://pc?mytoken=abc"),
      tokenInText("flightdeck://pc:abc?token="),
    ]).toEqual(["SEC+RET", "A", null, null, null]);
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

  test("a token read from text that did not read (no address yet) is kept for the link once it does", () => {
    expect(
      keptToken(
        "••••",
        { address: "pc", port: "7420" },
        { address: "", port: "7420", token: "held" },
      ),
    ).toBe("held");
  });
});
