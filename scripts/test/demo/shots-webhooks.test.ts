import { describe, expect, test } from "bun:test";
import { WebhookTargets } from "../../../apps/desktop/src/features/webhook/webhook-targets.ts";
import type { DemoIds } from "../../demo-seed.ts";
import { demoWebhooks } from "../../lib/demo/seeds.ts";
import { NARROW_SHOTS } from "../../lib/shots/narrow.ts";
import { webhooksShots } from "../../lib/shots/table-webhooks.ts";

const IDS = {} as DemoIds;
const byName = (name: string) => webhooksShots(IDS).find((shot) => shot.name === name);

/** The targets the app reads back from the stored text the print starts with. */
function stored(text: string) {
  const items = new Map<string, string>([["flightdeck.webhooks", text]]);
  const storage = { getItem: (key: string) => items.get(key) ?? null, setItem: () => {} };
  const vault = { get: async () => null, set: async () => {}, delete: async () => {} };
  return new WebhookTargets({ storage, vault }).list();
}

/** #4405: Settings > Notifications > Webhooks, the states the audit of #168 found no print for. */
describe("the Webhooks section prints (#4405)", () => {
  test("the table prints the empty list, the list, the ntfy form, the edit form, both test results, the no-host notice and the remove confirm", () => {
    expect(webhooksShots(IDS).map((shot) => shot.name)).toEqual([
      "webhooks-vazio",
      "webhooks-lista",
      "webhooks-ntfy",
      "webhooks-editar",
      "webhooks-teste-ok",
      "webhooks-teste-falhou",
      "webhooks-sem-host",
      "webhooks-remover",
    ]);
  });

  test("every print opens Settings on the Webhooks section", () => {
    const routes = webhooksShots(IDS).map((shot) => shot.route);
    expect(routes).toHaveLength(8);
    expect(
      routes.filter((route) => route.name !== "settings" || route.section !== "webhooks"),
    ).toEqual([]);
  });

  test("the prints that need rows start with the demo's webhooks; the others start empty, and a test result adds its own webhook in the page, so the vault holds its address", () => {
    expect(
      webhooksShots(IDS)
        .filter((shot) => shot.webhooks === true)
        .map((shot) => shot.name),
    ).toEqual(["webhooks-lista", "webhooks-editar", "webhooks-sem-host", "webhooks-remover"]);
  });

  test("the demo's webhooks are a healthy row, a failing row and a disabled row, sent to documentation hosts", () => {
    const targets = stored(demoWebhooks());
    expect(targets.map((target) => [target.status, target.enabled])).toEqual([
      ["ok", true],
      ["failing", true],
      ["ok", false],
    ]);
    expect(targets.filter((target) => !target.urlHost.endsWith(".example.test"))).toEqual([]);
    expect(targets.find((target) => target.status === "failing")?.lastHttpStatus).toBe(500);
  });

  test("the demo's webhooks cover more than one type, so the rows differ", () => {
    expect(new Set(stored(demoWebhooks()).map((target) => target.type)).size).toBeGreaterThan(1);
  });

  test("the no-host print takes the webhook feature out of the host's announcement", () => {
    expect(byName("webhooks-sem-host")?.wire).toEqual([
      { command: "host.info", without: { features: ["webhook"] } },
    ]);
  });

  test("the Sent print answers the post with a 200 and the Failed print with a refusal, both in the page", () => {
    const sent = byName("webhooks-teste-ok")?.wire?.find((rule) => rule.command === "webhook.send");
    const failed = byName("webhooks-teste-falhou")?.wire?.find(
      (rule) => rule.command === "webhook.send",
    );
    expect(sent && "reply" in sent ? sent.reply : null).toEqual({
      status: 200,
      retryAfterMs: null,
      refused: null,
    });
    expect(failed && "reject" in failed).toBe(true);
  });

  test("the list, the ntfy form and the edit form are re-measured narrow, where a row's four buttons must wrap", () => {
    expect(
      ["webhooks-lista", "webhooks-ntfy", "webhooks-editar"].filter(
        (name) => !NARROW_SHOTS.includes(name),
      ),
    ).toEqual([]);
  });
});
