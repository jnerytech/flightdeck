import { describe, expect, test } from "bun:test";
import { plain } from "../../src/daemon-client/cli-view.ts";

/** Each hidden range of the scrub: where it starts and ends (code points, both inside). */
const RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0000, 0x001f], // C0 controls
  [0x007f, 0x009f], // DEL and C1 controls
  [0x200b, 0x200f], // zero-width and direction marks
  [0x2028, 0x202e], // line and paragraph separators, direction embeddings
  [0x2060, 0x2064],
  [0x2066, 0x206f],
  [0x061c, 0x061c], // Arabic mark
  [0x00ad, 0x00ad], // soft hyphen
  [0x034f, 0x034f], // grapheme joiner
  [0x180e, 0x180e], // Mongolian separator
  [0xfe00, 0xfe0f], // variation selectors
  [0xfeff, 0xfeff],
  [0xfff9, 0xfffb],
  [0xe0000, 0xe007f], // tag characters
];

const char = (code: number) => String.fromCodePoint(code);

describe("plain: terminal-control and direction characters in daemon text (#3522)", () => {
  test("every code point of every hidden range becomes a space", () => {
    for (const [from, to] of RANGES) {
      for (const code of [from, Math.floor((from + to) / 2), to]) {
        expect(plain(`a${char(code)}b`)).toBe("a b");
      }
    }
  });

  test("the code points next to each range, and plain text, stay as they are", () => {
    for (const [from, to] of RANGES) {
      for (const code of [from - 1, to + 1]) {
        // below zero there is no neighbour; one inside another range is that range's case
        if (code < 0) continue;
        if (RANGES.some(([a, b]) => code >= a && code <= b)) continue;
        expect(plain(`a${char(code)}b`)).toBe(`a${char(code)}b`);
      }
    }
    expect(plain("Ação: 日本語 — ok ‐")).toBe("Ação: 日本語 — ok ‐");
  });

  test("an escape sequence and a bidi override are defused, the printable rest is kept", () => {
    expect(plain("evil\u001b[2Jrepo‮")).toBe("evil [2Jrepo ");
  });
});
