import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { Settings } = await import("../../src/features/settings/page.tsx");
const { UpdateBanner } = await import("../../src/features/appupdate/update-banner.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

const CHECK = "Procurar atualização agora";
const UP_TO_DATE = "Você está na versão mais recente";

function setup(appUpdate: object, onCheckUpdate: () => Promise<void> | void) {
  const mem = memoryPlatform(false, "pt-BR");
  const store = new AppStore(mem.platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  const settings = { ...store.getState().settings, updaterSupported: true };
  render(
    <Settings
      store={store}
      settings={settings}
      onCloseToTray={() => {}}
      onAutostart={() => {}}
      onGlobalShortcut={() => {}}
      appUpdate={appUpdate as never}
      onCheckUpdate={onCheckUpdate as never}
      onNotifyUpdates={() => {}}
      onAutoUpdate={() => {}}
      theme="system"
      onTheme={() => {}}
      density="comfortable"
      onDensity={() => {}}
      lang="pt-BR"
      onLang={() => {}}
      t={store.i18n.t}
    />,
  );
  return { store, mem };
}

const button = () => screen.getByRole("button", { name: CHECK }) as HTMLButtonElement;
const click = (el: Element) =>
  act(async () => {
    fireEvent.click(el);
  });

describe("check for updates: the answer is at the button (#2597)", () => {
  test("the button is busy while the check runs and a second press starts no second check", async () => {
    let checks = 0;
    let finish: () => void = () => {};
    const running = new Promise<void>((resolve) => {
      finish = resolve;
    });
    setup({ upToDate: false, error: null }, () => {
      checks += 1;
      return running;
    });
    await click(button());
    expect(button().disabled).toBe(true);
    expect(button().getAttribute("aria-busy")).toBe("true");
    await click(button());
    expect(checks).toBe(1);
    await act(async () => {
      finish();
    });
    expect(button().disabled).toBe(false);
  });

  test("the up to date line is a status, an <output> element (Sonar S6819)", () => {
    setup({ upToDate: true, error: null }, () => {});
    const line = screen.queryByText(UP_TO_DATE);
    expect(line).not.toBeNull();
    expect([line?.tagName, screen.queryByRole("status")?.textContent]).toEqual([
      "OUTPUT",
      line?.textContent,
    ]);
  });

  test("a failed check is shown beside the button as an alert", () => {
    setup({ upToDate: false, error: "Falha ao procurar atualização: sem rede" }, () => {});
    const alert = screen.queryByRole("alert");
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toContain("sem rede");
    // Beside the button: the same panel as the check button.
    expect(alert?.parentElement?.contains(button())).toBe(true);
  });

  test("no error, no alert", () => {
    setup({ upToDate: false, error: null }, () => {});
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("the banner at the top still shows the failed check", async () => {
    const mem = memoryPlatform(false, "pt-BR");
    mem.platform.updater.check = async () => {
      throw new Error("sem rede");
    };
    const store = new AppStore(mem.platform, { baseDelayMs: 600_000 });
    store.i18n.start();
    render(<UpdateBanner store={store} />);
    await act(async () => {
      await store.appUpdates.check();
    });
    expect(screen.queryByText(/sem rede/)).not.toBeNull();
  });
});
