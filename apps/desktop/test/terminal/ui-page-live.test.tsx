import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { RequestError } from "../../src/features/hosts/host-connection.ts";
import { interceptWire } from "../fake-host.ts";
import { act, button, click, runCleanups, screen, settle, setup, state } from "./page-setup.tsx";

setDefaultTimeout(30_000);
afterEach(runCleanups);

/** A line is named by its author, not its content: look at what the alerts or statuses say. */
const says = (role: "alert" | "status", text: string) =>
  screen.queryAllByRole(role).some((node) => node.textContent?.includes(text));

// Issue #3950: a terminal that is not live says so over the area, a failed attach keeps its reason,
// Reopen is busy while the attach is out, and a refused write is said instead of dropped.
describe("terminal-ui: a terminal that does not take keys says so", () => {
  test("a detached terminal says its keys are not sent, and a live one does not", async () => {
    const { server } = await setup();
    await settle(() => state("Ao vivo"));
    expect(says("status", "não é enviado")).toBe(false);
    void server.stop();
    await settle(() => state("Desanexado"));
    await settle(() => says("status", "não é enviado"));
    expect(says("status", "Use Reabrir")).toBe(true);
  });

  test("an ended terminal says its keys are not sent", async () => {
    const { ptys } = await setup();
    await settle(() => state("Ao vivo"));
    ptys.spawned[0]?.exit(2);
    await settle(() => says("status", "O processo terminou"));
    expect(says("status", "não é enviado")).toBe(true);
  });

  test("Reabrir is busy while the attach is out, and the line is gone once it is live", async () => {
    const d = await setup();
    await settle(() => state("Ao vivo"));
    d.ptys.spawned[0]?.exit(2);
    await settle(() => state("Encerrado (código 2)"));
    const wait: { release: () => void } = { release: () => {} };
    const restore = interceptWire(d.store, d.hostId, (type, _payload, next) =>
      type === "terminal.attach"
        ? new Promise<never>((_resolve, reject) => {
            wait.release = () => reject(new RequestError("bad_thing", "No room left"));
          })
        : next(),
    );
    await click("Reabrir");
    await settle(() => button("Reabrir")?.getAttribute("aria-busy") === "true");
    expect(button("Reabrir")?.getAttribute("aria-busy")).toBe("true");
    await act(async () => wait.release());
    await settle(() => says("alert", "No room left"));
    expect(button("Reabrir")?.getAttribute("aria-busy")).toBeNull();
    restore();
    await click("Reabrir");
    await settle(() => state("Encerrado (código 2)"));
    expect(says("alert", "No room left")).toBe(false);
  });

  test("a failed attach says why it did not open", async () => {
    const d = await setup();
    await settle(() => state("Ao vivo"));
    d.ptys.spawned[0]?.exit(2);
    await settle(() => state("Encerrado (código 2)"));
    interceptWire(d.store, d.hostId, (type, _payload, next) =>
      type === "terminal.attach"
        ? Promise.reject(new RequestError("bad_thing", "No room left"))
        : next(),
    );
    await click("Reabrir");
    await settle(() => says("alert", "No room left"));
    expect(says("alert", "Não foi possível abrir o terminal")).toBe(true);
    // The alert already says what happened: the generic line would only say it twice.
    expect(says("status", "não é enviado")).toBe(false);
    expect(state("Desanexado")).not.toBeNull();
  });

  test("a write the host refuses is said, and the next accepted write clears it", async () => {
    const d = await setup();
    await settle(() => state("Ao vivo"));
    const allow = interceptWire(d.store, d.hostId, (type, _payload, next) =>
      type === "terminal.write"
        ? Promise.reject(new RequestError("bad_thing", "No room left"))
        : next(),
    );
    act(() => d.x.type("a"));
    await settle(() => says("alert", "No room left"));
    expect(says("alert", "O host não recebeu o que você digitou")).toBe(true);
    allow();
    act(() => d.x.type("b"));
    await settle(() => !says("alert", "No room left"));
    expect(says("alert", "No room left")).toBe(false);
  });

  test("a refused write is not kept once the terminal attaches again", async () => {
    const d = await setup();
    await settle(() => state("Ao vivo"));
    interceptWire(d.store, d.hostId, (type, _payload, next) =>
      type === "terminal.write"
        ? Promise.reject(new RequestError("bad_thing", "No room left"))
        : next(),
    );
    act(() => d.x.type("a"));
    await settle(() => says("alert", "No room left"));
    d.ptys.spawned[0]?.exit(2);
    await settle(() => state("Encerrado (código 2)"));
    await click("Reabrir");
    await settle(() => !says("alert", "No room left"));
    expect(says("alert", "No room left")).toBe(false);
  });
});
