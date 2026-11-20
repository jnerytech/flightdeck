import { describe, expect, test } from "bun:test";
import {
  HOST_ID,
  parseHostIndex,
  pickHost,
  remoteAddressRefusal,
} from "../../src/remote-hosts/domain/rules.ts";

const ID_A = "0b9f3c2e-4f4a-4c53-9d0b-6a7d1e5c8f10";
const ID_B = "7d2a1c9e-1b3f-4e6a-8c5d-2f9b0a4e6d31";

describe("remote hosts: which host a name means (#3429)", () => {
  const hosts = [
    { id: ID_A, name: "server" },
    { id: ID_B, name: "laptop" },
  ];

  test("an exact name gives that host's id", () => {
    expect(pickHost(hosts, "laptop")).toEqual({ ok: true, id: ID_B });
  });

  test("a name nobody has lists the names that exist, sorted", () => {
    expect(pickHost(hosts, "nas")).toEqual({
      ok: false,
      reason: "unknown_host",
      names: ["laptop", "server"],
    });
  });

  test("the match is exact: another case, a part of a name or an address is not a host", () => {
    for (const name of ["Server", "serv", "server ", "10.0.0.5", ID_A, ""]) {
      expect({ name, ...pickHost(hosts, name) }).toMatchObject({
        name,
        ok: false,
        reason: "unknown_host",
      });
    }
  });

  test("a name two hosts share is ambiguous and lists each name once", () => {
    const twice = [...hosts, { id: "3c1d2e3f-0a1b-4c2d-8e3f-4a5b6c7d8e9f", name: "server" }];
    expect(pickHost(twice, "server")).toEqual({
      ok: false,
      reason: "ambiguous_host",
      names: ["laptop", "server"],
    });
  });

  test("a match whose id is not a UUID is unknown: it never reaches the helper", () => {
    const odd = [{ id: `${ID_A}:url`, name: "server" }];
    expect(pickHost(odd, "server")).toMatchObject({ ok: false, reason: "unknown_host" });
  });

  test("the id pattern takes a lowercase UUID and nothing around it", () => {
    expect([ID_A, ID_B].every((id) => HOST_ID.test(id))).toBe(true);
    for (const bad of [
      `${ID_A}\n`,
      ` ${ID_A}`,
      ID_A.toUpperCase(),
      `${ID_A}:url`,
      "--version",
      "",
    ]) {
      expect({ bad, ok: HOST_ID.test(bad) }).toEqual({ bad, ok: false });
    }
  });
});

describe("remote hosts: the index of names the app writes (#3429)", () => {
  test("it reads each host's id and name, and keeps no other field", () => {
    const text = JSON.stringify({
      hosts: [{ id: ID_A, name: "server", token: "secret-in-the-file", address: "ws://x" }],
    });
    expect(parseHostIndex(text)).toEqual([{ id: ID_A, name: "server" }]);
  });

  test("text that is not that index is null, never a throw", () => {
    for (const text of [
      "",
      "not json",
      "[]",
      "{}",
      '{"hosts":"x"}',
      '{"hosts":[{"id":1,"name":"a"}]}',
    ]) {
      expect({ text, got: parseHostIndex(text) }).toEqual({ text, got: null });
    }
  });

  test("an empty list is an index with no host", () => {
    expect(parseHostIndex('{"hosts":[]}')).toEqual([]);
  });
});

describe("remote hosts: which addresses may carry the token (#3429)", () => {
  const path = "/v1/ws";
  const allowed = [
    `wss://example.com:7420${path}`,
    `ws://127.0.0.1:7420${path}`,
    `ws://127.8.9.10:7420${path}`,
    `ws://localhost:7420${path}`,
    `ws://10.1.2.3:7420${path}`,
    `ws://172.16.0.1:7420${path}`,
    `ws://172.31.255.255:7420${path}`,
    `ws://192.168.1.5:7420${path}`,
    `ws://100.64.0.1:7420${path}`,
    `ws://100.127.255.255:7420${path}`,
    `ws://[::1]:7420${path}`,
    `ws://[fd00::1]:7420${path}`,
    `ws://[fe80::1]:7420${path}`,
    `ws://[fd7a:115c:a1e0::1]:7420${path}`,
    `ws://pi.tail1234.ts.net:7420${path}`,
    // the URL parser turns these into the IPv4 address they stand for
    `ws://2130706433:7420${path}`,
    `ws://0x7f.1:7420${path}`,
    `ws://[::ffff:192.168.1.5]:7420${path}`,
  ];
  const cleartext = [
    `ws://example.com:7420${path}`,
    `ws://8.8.8.8:7420${path}`,
    `ws://172.32.0.1:7420${path}`,
    `ws://172.15.255.255:7420${path}`,
    `ws://100.128.0.1:7420${path}`,
    `ws://100.63.255.255:7420${path}`,
    `ws://[2001:db8::1]:7420${path}`,
    `ws://[::ffff:8.8.8.8]:7420${path}`,
    `ws://localhost.evil.com:7420${path}`,
    `ws://pi.ts.net.evil.com:7420${path}`,
    `ws://ts.net:7420${path}`,
    `ws://pi.ts.net.:7420${path}`,
    `ws://localhost.:7420${path}`,
  ];
  const bad = [
    "not a url",
    `http://127.0.0.1:7420${path}`,
    `https://example.com${path}`,
    `ws://user:pw@10.0.0.1:7420${path}`,
    "ws://10.0.0.1:7420/other",
    `ws://10.0.0.1:7420${path}?x=1`,
    `ws://10.0.0.1:7420${path}#frag`,
    `wss://example.com:7420/other`,
  ];

  test("wss:// is always allowed, and ws:// over a private path", () => {
    for (const address of allowed)
      expect({ address, refusal: remoteAddressRefusal(address) }).toEqual({
        address,
        refusal: null,
      });
  });

  test("ws:// to any other address is cleartext_remote: the token would cross the network in the clear", () => {
    for (const address of cleartext)
      expect({ address, refusal: remoteAddressRefusal(address) }).toEqual({
        address,
        refusal: "cleartext_remote",
      });
  });

  test("an address that is not a ws or wss URL of the daemon's path is bad_address", () => {
    for (const address of bad)
      expect({ address, refusal: remoteAddressRefusal(address) }).toEqual({
        address,
        refusal: "bad_address",
      });
  });
});
