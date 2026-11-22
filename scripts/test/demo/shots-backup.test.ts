import { describe, expect, test } from "bun:test";
import type { DemoIds } from "../../demo-seed.ts";
import {
  keepSaves,
  type OfferWindow,
  offerBackup,
  type SaveWindow,
} from "../../lib/shots/save-file.ts";
import { hostShots } from "../../lib/shots/table-hosts.ts";

const IDS = {} as DemoIds;
const backupShots = () =>
  hostShots(IDS).filter((shot) => shot.name.startsWith("configuracoes-backup-"));

type Handle = {
  createWritable(): Promise<{ write(text: string): Promise<void>; close(): Promise<void> }>;
};
type Picker = (options: { suggestedName: string }) => Promise<Handle>;

describe("the backup prints (#4001)", () => {
  test("the table prints the schedule, the filled export form and the saved backup, all on Settings > Backup", () => {
    expect(backupShots().map((shot) => shot.name)).toEqual([
      "configuracoes-backup-agenda",
      "configuracoes-backup-exportar",
      "configuracoes-backup-salvo",
      "configuracoes-backup-ler",
      "configuracoes-backup-substituir",
      "configuracoes-backup-restaurado",
      "configuracoes-backup-ler-erro",
    ]);
    expect(
      backupShots().every((shot) => shot.route.name === "settings" && shot.prepare !== undefined),
    ).toBe(true);
  });

  test("a save keeps the name the app suggested and the text it wrote", async () => {
    const win: SaveWindow = {};
    keepSaves(win);
    const picker = win.showSaveFilePicker as Picker;
    const handle = await picker({ suggestedName: "flightdeck-backup.fdbackup" });
    const writable = await handle.createWritable();
    await writable.write("-----BEGIN AGE ENCRYPTED FILE-----");
    await writable.close();
    expect(win.__saved).toEqual({
      name: "flightdeck-backup.fdbackup",
      text: "-----BEGIN AGE ENCRYPTED FILE-----",
    });
  });

  describe("the file offer", () => {
    type Input = {
      files: Array<{ name: string; size: number; text(): Promise<string> }> | null;
      addEventListener(type: string, listener: () => void): void;
      dispatchEvent(event: Event): boolean;
      click(): void;
    };
    const fakeInput = (): Input => {
      const listeners = new Map<string, Array<() => void>>();
      return {
        files: null,
        addEventListener: (type, listener) => listeners.set(type, [listener]),
        dispatchEvent: (event) => {
          for (const listener of listeners.get(event.type) ?? []) listener();
          return true;
        },
        click: () => {},
      };
    };
    const pick = (win: OfferWindow) => {
      const input = win.document.createElement("input") as Input;
      const seen: string[] = [];
      input.addEventListener("change", () => seen.push("change"));
      input.addEventListener("cancel", () => seen.push("cancel"));
      input.click();
      return { input, seen };
    };

    test("an input the page clicks chooses the file the last save kept", async () => {
      const win: OfferWindow = {
        __saved: { name: "b.fdbackup", text: "ENCRYPTED" },
        document: { createElement: () => fakeInput() },
      };
      offerBackup(win);
      const { input, seen } = pick(win);
      expect(seen).toEqual(["change"]);
      expect(input.files?.[0]?.name).toBe("b.fdbackup");
      expect(await input.files?.[0]?.text()).toBe("ENCRYPTED");
    });

    test("with no save kept the dialog is cancelled", () => {
      const win: OfferWindow = { document: { createElement: () => fakeInput() } };
      offerBackup(win);
      expect(pick(win).seen).toEqual(["cancel"]);
    });

    test("an element that is not an input is left as the page made it", () => {
      const div = { tag: "div" };
      const win: OfferWindow = {
        document: { createElement: (tag) => (tag === "div" ? div : fakeInput()) },
      };
      offerBackup(win);
      expect(win.document.createElement("div")).toBe(div);
    });
  });
});
