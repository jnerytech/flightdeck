import { describe, expect, test } from "bun:test";
import { registerDom } from "../dom.ts";

registerDom();

/**
 * Issue #3854: a failed assertion on a happy-dom node printed the whole node (its window, its prototypes, its
 * event classes): 1.87 GB and 26 s for one failure, and 10 GB once. The test DOM now prints a node as its
 * opening tag. These tests compare booleans and short strings, never the node, so a regression fails fast.
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
    expect({ failed: message !== "", short: short(message) }).toEqual({
      failed: true,
      short: true,
    });
  });

  test("a failed toEqual on a node throws a short message", () => {
    const el = document.createElement("div");
    const message = (() => {
      try {
        expect(el).toEqual({});
        return "";
      } catch (error) {
        return String((error as Error).message);
      }
    })();
    expect({ failed: message !== "", short: short(message) }).toEqual({
      failed: true,
      short: true,
    });
  });

  test("the whole document prints short too", () => {
    expect(short(printed(document.body))).toBe(true);
  });
});
