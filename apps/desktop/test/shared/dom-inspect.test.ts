import { describe, expect, test } from "bun:test";
import { registerDom } from "../dom.ts";

registerDom();

/**
 * Issue #3854: a failed assertion on a happy-dom node printed the whole node (its window, its prototypes, its
 * event classes): 1.87 GB and 26 s for one failure, and 10 GB once. The test DOM now prints a node as its
 * opening tag. These tests compare booleans and short strings, never the node, so a regression fails fast.
 * A failed `toEqual` against a plain object does not go through it: Bun diffs the node's own properties (3.7 MB for an
 * empty div), so a node still never goes into `toEqual`.
 */
const printed = (node: unknown) => Bun.inspect(node);
const short = (text: string) => text.length < 300;

describe("a DOM node in a test failure (#3854)", () => {
  test("an element prints as its opening tag with its classes", () => {
    const el = document.createElement("dt");
    el.className = "text-muted-foreground";
    el.textContent = "Sessions";
    expect(printed(el)).toBe('<dt class="text-muted-foreground">');
  });

  test("an element with no class prints as a bare tag, and its children do not print", () => {
    const el = document.createElement("section");
    el.append(document.createElement("div"), document.createElement("p"));
    expect(printed(el)).toBe("<section>");
  });

  test("a text node prints its text, quoted, with accents and emoji intact", () => {
    expect(printed(document.createTextNode("Configuração 🙂"))).toBe('#text "Configuração 🙂"');
  });

  test("a long text is cut, so a big text node stays short", () => {
    const out = printed(document.createTextNode("x".repeat(5000)));
    expect({ short: short(out), cut: out.includes("…") }).toEqual({ short: true, cut: true });
  });

  test("a failed toBeNull on a node throws a short message", () => {
    const el = document.createElement("div");
    const message = (() => {
      try {
        expect(el).toBeNull();
        return "";
      } catch (error) {
        return String((error as Error).message);
      }
    })();
    expect({
      failed: message !== "",
      short: short(message),
      names: message.includes("<div>"),
    }).toEqual({
      failed: true,
      short: true,
      names: true,
    });
  });

  test("the document and its body print as short names", () => {
    expect([printed(document), printed(document.body)]).toEqual(["#document", "<body>"]);
  });

  test("a fragment and a comment print as what they are, not as an empty tag", () => {
    expect([
      printed(document.createDocumentFragment()),
      printed(document.createComment("note")),
    ]).toEqual(["#document-fragment", "<!-- note -->"]);
  });

  test("a text with a line break or a quote stays on one line and keeps its meaning", () => {
    expect(printed(document.createTextNode('say "hi"\nthen go'))).toBe(
      '#text "say \\"hi\\"\\nthen go"',
    );
  });

  test("a class with a quote does not break the tag", () => {
    const el = document.createElement("p");
    el.className = 'a"b';
    expect(printed(el)).toBe('<p class="a\\"b">');
  });

  test("a cut never splits an emoji", () => {
    const out = printed(document.createTextNode(`${"x".repeat(39)}🙂🙂`));
    expect({
      whole: !out.includes("\uFFFD") && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(out),
      cut: out.endsWith('🙂…"'),
    }).toEqual({
      whole: true,
      cut: true,
    });
  });
});
