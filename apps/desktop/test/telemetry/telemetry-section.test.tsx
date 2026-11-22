import { afterEach, describe, expect, test } from "bun:test";
import type { TelemetryOptInStatus } from "@flightdeck/protocol";
import { liveScreen, registerDom } from "../dom.ts";
import { settle } from "../wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { TContext } = await import("../../src/i18n/context.tsx");
const { translator } = await import("../../src/i18n/index.ts");
const { TelemetrySection } = await import("../../src/features/telemetry/telemetry-section.tsx");

afterEach(cleanup);

const info = (status: TelemetryOptInStatus["status"]): TelemetryOptInStatus => ({
  status,
  settingsPath: "/home/x/.claude/settings.json",
  receiverUrl: null,
  conflicts: status === "conflict" ? ["OTEL_METRICS_EXPORTER"] : [],
});

/** A host that answers each command from a queue; the last answer repeats. `null` is a refusal. */
function host(answers: Record<string, Array<TelemetryOptInStatus | null>>) {
  const calls: string[] = [];
  const store = {
    hostCommand: async (_hostId: string, type: string) => {
      calls.push(type);
      const queue = answers[type] ?? [];
      return queue.length > 1 ? queue.shift() : queue[0];
    },
  } as never;
  return { store, calls };
}

function show(store: never, lang: "en" | "pt-BR") {
  render(
    <TContext.Provider value={translator(lang)}>
      <TelemetrySection store={store} hostId="h1" />
    </TContext.Provider>,
  );
}

const LANGS = [
  {
    lang: "en",
    asking: "Asking…",
    notInstalled: "Not installed",
    installed: "Installed",
    conflict: "Conflict",
    install: "Install telemetry",
    uninstall: "Remove telemetry",
    retry: "Try again",
    failed: "Could not read the telemetry status of this host.",
    already: "Already installed.",
    nothing: "Nothing to remove.",
  },
  {
    lang: "pt-BR",
    asking: "Consultando…",
    notInstalled: "Não instalada",
    installed: "Instalada",
    conflict: "Conflito",
    install: "Instalar telemetria",
    uninstall: "Remover telemetria",
    retry: "Tentar de novo",
    failed: "Não foi possível ler o estado da telemetria deste host.",
    already: "Já instalada.",
    nothing: "Nada para remover.",
  },
] as const;

const button = (name: string) => {
  const found = screen.queryByRole("button", { name });
  expect(found).not.toBeNull();
  return found as HTMLElement;
};
const status = () => screen.queryByRole("status")?.textContent ?? "";
const press = async (name: string) => {
  await act(async () => {
    fireEvent.click(button(name));
  });
};

for (const w of LANGS) {
  describe(`TelemetrySection (issue #4070), ${w.lang}`, () => {
    test("a refused status shows an error and Try again instead of Asking…, and only a retry that works shows the status", async () => {
      const { store } = host({ "telemetry.status": [null, info("absent")] });
      show(store, w.lang);
      await settle(() => screen.queryByRole("alert") !== null);
      expect(screen.queryByRole("alert")?.textContent).toContain(w.failed);
      expect(screen.queryByText(w.asking)).toBeNull();
      expect(button(w.install).getAttribute("aria-disabled")).toBe("true");
      expect(button(w.uninstall).getAttribute("aria-disabled")).toBe("true");
      await press(w.retry);
      await settle(() => status() === w.notInstalled);
      expect(screen.queryByRole("alert")).toBeNull();
    });

    test("a conflict is named Conflict, not Not installed, and nothing can be installed or removed", async () => {
      const { store } = host({ "telemetry.status": [info("conflict")] });
      show(store, w.lang);
      await settle(() => status() === w.conflict);
      expect(screen.queryByText(w.notInstalled)).toBeNull();
      expect(button(w.install).getAttribute("aria-disabled")).toBe("true");
      expect(button(w.uninstall).getAttribute("aria-disabled")).toBe("true");
    });

    test("installed: Install is off with its reason and does nothing, Remove opens its confirmation", async () => {
      const { store } = host({ "telemetry.status": [info("installed")] });
      show(store, w.lang);
      await settle(() => status() === w.installed);
      const install = button(w.install);
      expect(install.getAttribute("aria-disabled")).toBe("true");
      const reason = install.getAttribute("aria-describedby");
      expect(reason).not.toBeNull();
      expect(document.getElementById(reason as string)?.textContent).toBe(w.already);
      await press(w.install);
      expect(screen.queryByRole("alertdialog")).toBeNull();
      expect(button(w.uninstall).getAttribute("aria-disabled")).toBeNull();
      await press(w.uninstall);
      expect(screen.queryByRole("alertdialog")).not.toBeNull();
    });

    test("absent: Remove is off with its reason and does nothing, Install opens its confirmation", async () => {
      const { store } = host({ "telemetry.status": [info("absent")] });
      show(store, w.lang);
      await settle(() => status() === w.notInstalled);
      const remove = button(w.uninstall);
      expect(remove.getAttribute("aria-disabled")).toBe("true");
      const reason = remove.getAttribute("aria-describedby");
      expect(reason).not.toBeNull();
      expect(document.getElementById(reason as string)?.textContent).toBe(w.nothing);
      await press(w.uninstall);
      expect(screen.queryByRole("alertdialog")).toBeNull();
      await press(w.install);
      expect(screen.queryByRole("alertdialog")).not.toBeNull();
    });

    test("out of date keeps both buttons usable", async () => {
      const { store } = host({ "telemetry.status": [info("outdated")] });
      show(store, w.lang);
      await settle(() => button(w.install) !== null && status() !== w.asking);
      expect(button(w.install).getAttribute("aria-disabled")).toBeNull();
      expect(button(w.uninstall).getAttribute("aria-disabled")).toBeNull();
    });

    test("the new status after an install is said in the status region", async () => {
      const { store, calls } = host({
        "telemetry.status": [info("absent")],
        "telemetry.install": [info("installed")],
      });
      show(store, w.lang);
      await settle(() => status() === w.notInstalled);
      await press(w.install);
      await act(async () => {
        fireEvent.click(
          within(screen.queryByRole("alertdialog") as HTMLElement).getByRole("button", {
            name: w.install,
          }),
        );
      });
      await settle(() => status() === w.installed);
      expect(calls).toContain("telemetry.install");
    });
  });
}
