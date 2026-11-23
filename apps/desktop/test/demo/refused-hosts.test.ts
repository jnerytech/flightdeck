import { describe, expect, test } from "bun:test";
import { parseDemoHosts } from "../../src/demo/boot.ts";

const TOKEN = "t".repeat(32);
const host = (id: string) => ({ id, name: id, url: `ws://127.0.0.1:7777/${id}`, token: TOKEN });
const json = JSON.stringify([host("demo-alfa"), host("demo-beta")]);
const tokens = (search: string) =>
  Object.fromEntries(parseDemoHosts(json, search).map((h) => [h.id, h.token]));

// #4413: the Hosts prints need a host whose daemon answers `unauthorized`; the demo's hosts all hold the right token.
describe("?refused=<ids> in the demo's address", () => {
  test("a host it names gets a token its daemon refuses, and the others keep theirs", () => {
    const refused = tokens("?refused=demo-alfa");
    expect(refused["demo-alfa"]).toBe("r".repeat(32));
    expect(refused["demo-beta"]).toBe(TOKEN);
  });

  test("without it, or naming nobody, every host keeps its token", () => {
    expect([tokens(""), tokens("?refused=demo-nobody")]).toEqual([
      { "demo-alfa": TOKEN, "demo-beta": TOKEN },
      { "demo-alfa": TOKEN, "demo-beta": TOKEN },
    ]);
  });

  test("it only changes the token, so the address and the name stay", () => {
    const [alfa] = parseDemoHosts(json, "?refused=demo-alfa&hosts=demo-alfa");
    expect([alfa?.id, alfa?.name, alfa?.url]).toEqual([
      "demo-alfa",
      "demo-alfa",
      "ws://127.0.0.1:7777/demo-alfa",
    ]);
  });
});
