import { expect, test } from "bun:test";
import { HOSTS_KEY, loadHosts } from "../../src/features/hosts/hosts.ts";

const planted = (raw: string) => ({
  getItem: (key: string) => (key === HOSTS_KEY ? raw : null),
});

test("a stored host that is not a host is left out and the others stay (#1609)", () => {
  const good = { id: "h1", name: "Pi", url: "ws://pi:7777" };
  expect(loadHosts(planted(JSON.stringify([good, { id: "h2" }, "junk"])))).toEqual([good]);
});

test("stored hosts that are not a list read as none (#1609)", () => {
  expect(loadHosts(planted('{"id":"h1"}'))).toEqual([]);
});
