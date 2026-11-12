import { expect, test } from "bun:test";
import { WebhookTargets } from "../../src/features/webhook/webhook-targets.ts";

const TARGET = {
  id: "t1",
  name: "Team channel",
  type: "slack",
  hostScope: null,
  kinds: ["needs_you"],
  clientId: null,
  enabled: true,
  urlHost: "hooks.slack.com",
  status: "new",
  lastHttpStatus: null,
  lastAt: null,
};

const planted = (raw: string) =>
  new WebhookTargets({
    storage: {
      getItem: (key: string) => (key === "flightdeck.webhooks" ? raw : null),
      setItem: () => {},
    },
    vault: {},
  } as never);

test("a stored target that does not fit is left out and the others stay (#1609)", () => {
  const raw = JSON.stringify([
    TARGET,
    { ...TARGET, id: "t2", type: "carrier-pigeon" },
    { ...TARGET, id: "t3", enabled: "yes" },
    "junk",
  ]);
  expect(
    planted(raw)
      .list()
      .map((t) => t.id),
  ).toEqual(["t1"]);
});

test("a kind this app does not know is left out of its target, which stays (#1609)", () => {
  const raw = JSON.stringify([{ ...TARGET, kinds: ["needs_you", "from_the_future"] }]);
  expect(
    planted(raw)
      .list()
      .map((t) => t.kinds),
  ).toEqual([["needs_you"]]);
});

test("stored targets that are not a list, or not JSON, read as none (#1609)", () => {
  expect(planted('{"id":"t1"}').list()).toEqual([]);
  expect(planted("not json").list()).toEqual([]);
});
