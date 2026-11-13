import { describe, expect, test } from "bun:test";
import {
  keptToken,
  maskPairingLink,
  readLinkEdit,
  TOKEN_MASK,
  tokenInText,
} from "../../src/features/hosts/pairing-mask.ts";

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

  test("text that is not a readable link hides every value but the name, however the key is spelled", () => {
    expect([
      maskPairingLink("flightdeck://pc:abc?name=x&token=SECRET"),
      maskPairingLink("flightdeck://pc:abc?%74oken=SECRET&name=x"),
      maskPairingLink("flightdeck://pc:abc?%54oken=SECRET&t%6Fken=SECRET2&name=x"),
      maskPairingLink("flightdeck://pc:abc?token=AAA BBB#CCC&name=x"),
      maskPairingLink("flightdeck://pc:abc?token=A&token=B&name=x"),
    ]).toEqual([
      "flightdeck://pc:abc?name=x&token=••••",
      "flightdeck://pc:abc?%74oken=••••&name=x",
      "flightdeck://pc:abc?%54oken=••••&t%6Fken=••••&name=x",
      "flightdeck://pc:abc?token=••••&name=x",
      "flightdeck://pc:abc?token=••••&token=••••&name=x",
    ]);
  });

  test("the token in text that may not read: the first one, as the parser decodes it, or none", () => {
    expect([
      tokenInText("flightdeck://pc:abc?name=x&token=SEC%2BRET"),
      tokenInText("flightdeck://pc:abc?token=A&token=B"),
      tokenInText("flightdeck://pc:abc?t%6Fken=SPELLED"),
      tokenInText("flightdeck://pc:abc?name=x"),
      tokenInText("http://pc?mytoken=abc"),
      tokenInText("flightdeck://pc:abc?token="),
    ]).toEqual(["SEC+RET", "A", "SPELLED", null, null, null]);
  });

  test("a link with no token, or text with no parameters, is left alone; a stray URL's values are hidden", () => {
    expect([
      maskPairingLink("flightdeck://pc:7420?name=x"),
      maskPairingLink("http://pc:7420"),
      maskPairingLink(""),
      // Not a pairing link, but a person may paste one with a secret in it by mistake.
      maskPairingLink("http://pc:7420?mytoken=abc"),
    ]).toEqual([
      "flightdeck://pc:7420?name=x",
      "http://pc:7420",
      "",
      "http://pc:7420?mytoken=••••",
    ]);
  });

  test("the mask is dots, never part of a token the app made", () => {
    expect(TOKEN_MASK).toBe("••••");
  });
});

/** The dots in a shown link are not a token: what the form keeps for the token when the link is edited. */
describe("pairing-mask: which token a link edited in the form carries (#1548)", () => {
  const bound = { address: "127.0.0.1", port: "46507", token: "real-token" };
  const same = { address: "127.0.0.1", port: "46507" };

  test("a token typed or pasted in the link is the token, for any host", () => {
    expect(keptToken("new-token", same, bound)).toBe("new-token");
    expect(keptToken("new-token", { address: "10.0.0.2", port: "7420" }, null)).toBe("new-token");
  });

  test("any token with dots in it is the shown mask, edited or not: the token read with this host is kept", () => {
    expect([
      keptToken("••••", same, bound),
      keptToken("•••", same, bound),
      keptToken("••a••", same, bound),
      keptToken("••••x", same, bound),
    ]).toEqual(["real-token", "real-token", "real-token", "real-token"]);
  });

  test("the token is not carried to another address or port, and a link read with none has none", () => {
    expect([
      keptToken("••••", { address: "10.0.0.2", port: "46507" }, bound),
      keptToken("••••", { address: "127.0.0.1", port: "7420" }, bound),
      keptToken("••••", same, null),
    ]).toEqual([null, null, null]);
  });
});

/** The edit of the link field: typed as typed, anything else masked, a token bound to its host. */
describe("pairing-mask: what an edit of the link field shows and keeps (#1548)", () => {
  const LINK = "flightdeck://pc:7420?name=alfa&token=SECRET";
  const DOTS = "flightdeck://pc:7420?name=alfa&token=••••";
  const shown = (value: string, previous: string, inputType?: string) =>
    readLinkEdit(value, previous, null, inputType).shown;

  test("a link that is typed stays as typed; one that arrives any other way is masked", () => {
    expect([
      shown(LINK, LINK.slice(0, -1), "insertText"),
      shown(LINK, "", "insertFromPaste"),
      shown(LINK, "", "insertFromDrop"),
      shown(LINK, LINK.slice(0, -1), "insertReplacementText"),
      // No input type (a change event with none): a jump of more than one character is a paste.
      shown(LINK, ""),
      shown(LINK, LINK.slice(0, -1)),
    ]).toEqual([LINK, DOTS, DOTS, DOTS, DOTS, LINK]);
  });

  test("a composition (an IME, a dead key) is typing: the field is not rewritten under it", () => {
    expect(shown(LINK, LINK.slice(0, -1), "insertCompositionText")).toBe(LINK);
  });

  test("a percent-encoded dot in a pasted token is the mask, and with no token bound there is none", () => {
    expect(
      readLinkEdit("flightdeck://pc:7420?token=%E2%80%A2%E2%80%A2", "", null, "insertFromPaste")
        .problem,
    ).toBe("token");
  });

  test("one typed event that carries many characters is not typing", () => {
    expect(shown(LINK, "", "insertText")).toBe(DOTS);
  });

  test("a bare token or token=… pasted in the field is shown as dots, not as text", () => {
    expect([
      shown("SECRET-VALUE", "", "insertFromPaste"),
      shown("token=SECRET", "", "insertFromPaste"),
      shown("http://pc:7420?x=SECRET", "", "insertFromPaste"),
    ]).toEqual(["••••", "••••", "http://pc:7420?x=••••"]);
  });

  test("a link with a space before it that loses its token drops the token it held", () => {
    const bound = { address: "pc", port: "7420", token: "SECRET" };
    expect([
      readLinkEdit(" flightdeck://pc:7420?name=alfa", "", bound, "insertText").bound,
      readLinkEdit("flightdeck://pc:7420?name=alfa", "", bound, "insertText").bound,
      readLinkEdit(LINK, "", bound, "insertText").bound,
    ]).toEqual([null, null, { address: "pc", port: "7420", token: "SECRET" }]);
  });
});
