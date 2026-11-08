import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { createBackup } from "../src/lib/backup-bundle.ts";
import { registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { settleMaybe } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { AppStore } = await import("../src/lib/app-store.ts");
const { TContext } = await import("../src/i18n/context.tsx");
const { BackupAllPanel } = await import("../src/components/backup/backup-all-panel.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

/**
 * Issue #1241: Settings > Backup. One encrypted file with everything is saved where the person
 * chooses; a restore reads a file, previews what it would do, and changes nothing until confirmed.
 */
const PASS = "correct horse battery";
const persona = (id: string, name: string, body = `be ${name}`) => ({ id, name, body });

/** A backup file made from a profile with a theme, two personas and a host. */
async function backupText(): Promise<string> {
  const { platform } = memoryPlatform(false, "en");
  platform.storage.setItem("flightdeck.theme", "dark");
  platform.storage.setItem(
    "flightdeck.personas",
    JSON.stringify([persona("p1", "Reviewer"), persona("p2", "Writer")]),
  );
  platform.storage.setItem(
    "flightdeck.hosts",
    JSON.stringify([{ id: "h1", name: "Workstation", url: "ws://10.0.0.1:7777" }]),
  );
  await platform.secrets.set("h1", "host-token-ONE");
  return createBackup(platform, PASS, PASS, { workFactor: 4 });
}

function open(options: { language?: "en" | "pt-BR"; picked?: string | null } = {}) {
  const { platform } = memoryPlatform(false, options.language ?? "en");
  const saved: Array<{ name: string; text: string }> = [];
  platform.saveFile = async (name, text) => {
    saved.push({ name, text });
    return true;
  };
  platform.vault.pickFile = async () =>
    options.picked == null ? null : { path: "backup.fdbackup", text: options.picked };
  const store = new AppStore(platform, { baseDelayMs: 600_000, vaultWorkFactor: 4 });
  store.i18n.start();
  render(
    <TContext.Provider value={store.i18n.t}>
      <BackupAllPanel store={store} />
    </TContext.Provider>,
  );
  return { platform, store, saved };
}

const field = (label: string) => screen.queryByLabelText(label) as HTMLInputElement | null;
async function type(label: string, value: string) {
  const input = field(label);
  if (input) await act(async () => fireEvent.change(input, { target: { value } }));
  return input !== null;
}
async function click(name: string) {
  const button = screen.queryByRole("button", { name });
  if (button) await act(async () => fireEvent.click(button));
  return button !== null;
}
const said = (text: string) =>
  screen.queryAllByRole("status").some((box) => (box.textContent ?? "").includes(text)) ||
  screen.queryAllByRole("alert").some((box) => (box.textContent ?? "").includes(text));

describe("backup-all-ui: Settings > Backup (#1241)", () => {
  test("Back up now saves one armored encrypted file and says so, without the passphrase in it", async () => {
    const { saved } = open();
    await type("Passphrase", PASS);
    await type("Confirm passphrase", PASS);
    await click("Back up now");
    const done = await settleMaybe(() => saved.length === 1 && said("Backup saved"), 3000);
    expect([
      done,
      saved[0]?.name,
      saved[0]?.text.startsWith("-----BEGIN AGE ENCRYPTED FILE-----"),
      field("Passphrase")?.value,
    ]).toEqual([true, "flightdeck-backup.fdbackup", true, ""]);
  });

  test("a passphrase that does not match is refused in place and nothing is saved", async () => {
    const { saved } = open();
    await type("Passphrase", PASS);
    await type("Confirm passphrase", `${PASS}x`);
    await click("Back up now");
    const refused = await settleMaybe(() => said("do not match"), 3000);
    expect([refused, saved.length]).toEqual([true, 0]);
  });

  test("Restore reads the file, previews it by kind with nothing changed, then applies on the confirm", async () => {
    const text = await backupText();
    const { platform } = open({ picked: text });
    await type("File passphrase", PASS);
    await click("Read backup");
    const shown = await settleMaybe(
      () => (document.body.textContent ?? "").includes("Personas: 2 new"),
      3000,
    );
    const before = [
      platform.storage.getItem("flightdeck.theme"),
      platform.storage.getItem("flightdeck.personas"),
    ];
    await click("Restore");
    const done = await settleMaybe(() => said("Close and reopen Flightdeck"), 3000);
    expect([
      shown,
      before,
      done,
      platform.storage.getItem("flightdeck.theme"),
      JSON.parse(platform.storage.getItem("flightdeck.personas") ?? "[]").length,
      await platform.secrets.get("h1"),
    ]).toEqual([true, [null, null], true, "dark", 2, "host-token-ONE"]);
  });

  test("a wrong passphrase says the file could not be read and changes nothing", async () => {
    const text = await backupText();
    const { platform } = open({ picked: text });
    await type("File passphrase", "another passphrase");
    await click("Read backup");
    const refused = await settleMaybe(() => said("could not be read"), 3000);
    expect([
      refused,
      screen.queryByRole("button", { name: "Restore" }) === null,
      platform.storage.getItem("flightdeck.theme"),
    ]).toEqual([true, true, null]);
  });

  test("a difference is listed by name, kept unless the person chooses to replace it, and replacing is confirmed", async () => {
    const text = await backupText();
    const { platform } = open({ picked: text });
    platform.storage.setItem("flightdeck.theme", "light");
    await type("File passphrase", PASS);
    await click("Read backup");
    const listed = await settleMaybe(
      () =>
        (screen.queryByRole("list", { name: "Different here" })?.textContent ?? "").includes(
          "theme",
        ),
      3000,
    );
    await click("Restore");
    await settleMaybe(() => said("Close and reopen Flightdeck"), 3000);
    const kept = platform.storage.getItem("flightdeck.theme");
    cleanup();
    const again = open({ picked: text });
    again.platform.storage.setItem("flightdeck.theme", "light");
    await type("File passphrase", PASS);
    await click("Read backup");
    await settleMaybe(() => screen.queryByLabelText("Replace with the backup") !== null, 3000);
    const radio = screen.queryByLabelText("Replace with the backup");
    if (radio) await act(async () => fireEvent.click(radio));
    await click("Restore");
    const asked = await settleMaybe(() => screen.queryByRole("alertdialog") !== null, 3000);
    const before = again.platform.storage.getItem("flightdeck.theme");
    await click("Replace");
    await settleMaybe(() => again.platform.storage.getItem("flightdeck.theme") === "dark", 3000);
    expect([
      listed,
      kept,
      asked,
      before,
      again.platform.storage.getItem("flightdeck.theme"),
    ]).toEqual([true, "light", true, "light", "dark"]);
  });

  test("a backup that holds nothing new here cannot be restored, and the radios have a group name", async () => {
    const text = await backupText();
    const { platform } = open({ picked: text });
    platform.storage.setItem("flightdeck.theme", "dark");
    platform.storage.setItem(
      "flightdeck.personas",
      JSON.stringify([persona("p1", "Reviewer"), persona("p2", "Writer")]),
    );
    platform.storage.setItem(
      "flightdeck.hosts",
      JSON.stringify([{ id: "h1", name: "Workstation", url: "ws://10.0.0.1:7777" }]),
    );
    await platform.secrets.set("h1", "host-token-ONE");
    await type("File passphrase", PASS);
    await click("Read backup");
    const shown = await settleMaybe(
      () => (document.body.textContent ?? "").includes("Personas: 0 new, 2 the same"),
      3000,
    );
    const restore = screen.queryByRole("button", { name: "Restore" }) as HTMLButtonElement | null;
    expect([shown, restore?.disabled, screen.queryByRole("group") === null]).toEqual([
      true,
      true,
      true,
    ]);
  });

  test("with only a difference, Restore waits until the person chooses to replace it, under a named group", async () => {
    const text = await backupText();
    const { platform } = open({ picked: text });
    platform.storage.setItem("flightdeck.theme", "dark");
    platform.storage.setItem(
      "flightdeck.personas",
      JSON.stringify([persona("p1", "Reviewer", "a different body"), persona("p2", "Writer")]),
    );
    platform.storage.setItem(
      "flightdeck.hosts",
      JSON.stringify([{ id: "h1", name: "Workstation", url: "ws://10.0.0.1:7777" }]),
    );
    await platform.secrets.set("h1", "host-token-ONE");
    await type("File passphrase", PASS);
    await click("Read backup");
    const named = await settleMaybe(
      () => screen.queryByRole("group", { name: "When it differs" }) !== null,
      3000,
    );
    const restore = () => screen.queryByRole("button", { name: "Restore" }) as HTMLButtonElement;
    const waiting = restore()?.disabled;
    const replace = screen.queryByLabelText("Replace with the backup") as HTMLInputElement | null;
    if (replace) await act(async () => fireEvent.click(replace));
    expect([named, waiting, restore()?.disabled]).toEqual([true, true, false]);
  });

  test("the pt-BR panel is in Portuguese", async () => {
    open({ language: "pt-BR" });
    const shown = await settleMaybe(
      () => screen.queryByRole("button", { name: "Fazer backup agora" }) !== null,
      3000,
    );
    expect(shown).toBe(true);
  });
});
