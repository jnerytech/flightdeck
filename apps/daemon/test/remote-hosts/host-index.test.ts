import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readHostIndex } from "../../src/remote-hosts/host-index.ts";
import { tempDir } from "../support/helpers.ts";

const ID = "0b9f3c2e-4f4a-4c53-9d0b-6a7d1e5c8f10";
const me = process.getuid?.() ?? null;
const INDEX = JSON.stringify({ hosts: [{ id: ID, name: "server" }] });

function indexFile(text = INDEX) {
  const dir = tempDir("fd-hosts-index-");
  const path = join(dir, "hosts.json");
  writeFileSync(path, text);
  chmodSync(path, 0o600);
  return { dir, path };
}

describe("remote hosts: reading the name index (#3429)", () => {
  test("a file of the user's own gives its hosts", async () => {
    expect(await readHostIndex(indexFile().path, me)).toEqual([{ id: ID, name: "server" }]);
  });

  test("a file that is not there is no index", async () => {
    expect(await readHostIndex(join(tempDir("fd-hosts-none-"), "hosts.json"), me)).toBeNull();
  });

  test("a link is refused, even to a good index", async () => {
    const { dir, path } = indexFile();
    const link = join(dir, "link.json");
    symlinkSync(path, link);
    expect(await readHostIndex(link, me)).toBeNull();
  });

  test("a folder where the file should be is refused", async () => {
    const dir = tempDir("fd-hosts-dir-");
    mkdirSync(join(dir, "hosts.json"));
    expect(await readHostIndex(join(dir, "hosts.json"), me)).toBeNull();
  });

  test.skipIf(me === null)("a file owned by another user is refused", async () => {
    expect(await readHostIndex(indexFile().path, (me ?? 0) + 1)).toBeNull();
  });

  test.skipIf(me === null)(
    "a file that group or others can write to is refused: its names could be swapped",
    async () => {
      for (const mode of [0o666, 0o620, 0o602]) {
        const { path } = indexFile();
        chmodSync(path, mode);
        expect({ mode, hosts: await readHostIndex(path, me) }).toEqual({ mode, hosts: null });
      }
    },
  );

  test("text that is not the index is no index", async () => {
    expect(await readHostIndex(indexFile("not json").path, me)).toBeNull();
  });
});
