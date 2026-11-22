import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { RequestError } from "../../src/features/hosts/host-connection.ts";
import { interceptWire } from "../fake-host.ts";
import { click, runCleanups, screen, settle, setup, state } from "./page-setup.tsx";

setDefaultTimeout(30_000);
afterEach(runCleanups);

/** An alert is named by its author, not its content: look at what it says. */
const alertSays = (text: string) =>
  screen.queryAllByRole("alert").some((node) => node.textContent?.includes(text));

/** The host refuses `terminal.close`; the returned function lets it through again. */
const refuseClose = (d: Awaited<ReturnType<typeof setup>>) =>
  interceptWire(d.store, d.hostId, (type, _payload, next) =>
    type === "terminal.close"
      ? Promise.reject(new RequestError("bad_thing", "No room left"))
      : next(),
  );

// Issue #3949: a close the host refuses keeps the person on the screen with the reason, so End process
// is never taken for done while the process still runs.
describe("terminal-ui: a close the host refuses", () => {
  test("Encerrar processo refused stays on the screen and says the host's reason", async () => {
    const d = await setup();
    await settle(() => state("Ao vivo"));
    refuseClose(d);
    await click("Fechar terminal");
    await click("Encerrar processo");
    await settle(() => alertSays("No room left"));
    expect(alertSays("No room left")).toBe(true);
    expect(d.closed).toEqual([]);
    expect(d.ptys.spawned[0]?.killed).toBe(false);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  test("Desanexar refused stays too, and Fechar terminal can be pressed again", async () => {
    const d = await setup();
    await settle(() => state("Ao vivo"));
    refuseClose(d);
    await click("Fechar terminal");
    await click("Desanexar");
    await settle(() => alertSays("No room left"));
    expect(d.closed).toEqual([]);
    await click("Fechar terminal");
    expect(screen.queryByRole("alertdialog")).not.toBeNull();
  });

  test("a terminal the host no longer has is already closed: the screen leaves", async () => {
    const d = await setup();
    await settle(() => state("Ao vivo"));
    interceptWire(d.store, d.hostId, (type, _payload, next) =>
      type === "terminal.close"
        ? Promise.reject(new RequestError("not_found", "terminal t1 does not exist"))
        : next(),
    );
    await click("Fechar terminal");
    await click("Desanexar");
    await settle(() => d.closed.length === 1);
    expect(d.closed).toEqual([1]);
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
  });

  test("a failure that is not a host refusal says its message, without the error name", async () => {
    const d = await setup();
    await settle(() => state("Ao vivo"));
    interceptWire(d.store, d.hostId, (type, _payload, next) =>
      type === "terminal.close" ? Promise.reject(new Error("socket closed")) : next(),
    );
    await click("Fechar terminal");
    await click("Desanexar");
    await settle(() => alertSays("socket closed"));
    expect(alertSays("Error:")).toBe(false);
    expect(d.closed).toEqual([]);
  });

  test("a retry the host accepts leaves the screen and the reason is gone", async () => {
    const d = await setup();
    await settle(() => state("Ao vivo"));
    const allow = refuseClose(d);
    await click("Fechar terminal");
    await click("Encerrar processo");
    await settle(() => alertSays("No room left"));
    allow();
    await click("Fechar terminal");
    await click("Encerrar processo");
    await settle(() => d.closed.length === 1);
    expect(d.closed).toEqual([1]);
    expect(d.ptys.spawned[0]?.killed).toBe(true);
    expect(alertSays("No room left")).toBe(false);
  });
});
