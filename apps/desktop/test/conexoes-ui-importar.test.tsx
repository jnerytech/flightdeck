import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { SshImportEntry } from "@flightdeck/protocol";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform, TOKEN } from "./fixtures.ts";
import { sshDaemon, sshTarget } from "./ssh-daemon.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(20_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function settle(check: () => boolean, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await act(() => Bun.sleep(10));
}

const entry = (alias: string, exists = false): SshImportEntry => ({
  alias,
  host: `${alias}.example.com`,
  port: 22,
  user: "me",
  identityFile: null,
  proxyJump: null,
  exists,
});

async function open(importEntries: SshImportEntry[]) {
  const d = sshDaemon(cleanups, { targets: [sshTarget({ id: "t1", name: "vps" })], importEntries });
  const store = new AppStore(memoryPlatform(false, "pt-BR").platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  await store.addHost({ name: "pc", url: d.url, token: TOKEN });
  render(<App store={store} />);
  await settle(() => screen.queryByRole("button", { name: "Conexões" }) !== null);
  await act(async () => {
    fireEvent.click(screen.queryByRole("button", { name: "Conexões" }) as HTMLElement);
  });
  await settle(() => screen.queryByRole("button", { name: "Importar do SSH config" }) !== null);
  return { d };
}

const click = async (name: string) => {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
  await act(() => Bun.sleep(30));
};

describe("conexoes-ui: import from the SSH config", () => {
  test("the preview lists the names, marks the registered ones, and applies only the ticked ones", async () => {
    const { d } = await open([entry("web"), entry("db"), entry("vps", true)]);
    await click("Importar do SSH config");
    expect(d.sent("ssh.import.preview")).toHaveLength(1);
    expect(screen.queryByText("me@web.example.com")).not.toBeNull();
    const vps = screen.queryByLabelText("vps") as HTMLInputElement;
    expect(vps.checked).toBe(false);
    expect(vps.disabled).toBe(true);
    expect(screen.queryByText("já cadastrado")).not.toBeNull();
    const web = screen.queryByLabelText("web") as HTMLInputElement;
    expect(web.checked).toBe(true);
    await act(async () => {
      fireEvent.click(screen.queryByLabelText("db") as HTMLElement);
    });
    await click("Importar selecionados");
    expect(d.sent("ssh.import.apply")).toEqual([{ aliases: ["web"] }]);
    expect(screen.queryByText("Criados: 1")).not.toBeNull();
    expect(screen.queryByRole("list", { name: "Destinos" })?.textContent).toContain("web");
  });

  test("Importar selecionados stays closed when nothing is ticked", async () => {
    await open([entry("vps", true)]);
    await click("Importar do SSH config");
    expect(
      (screen.queryByRole("button", { name: "Importar selecionados" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  test("a config with nothing to import says so", async () => {
    const { d } = await open([]);
    await click("Importar do SSH config");
    expect(screen.queryByText("Nada para importar.")).not.toBeNull();
    expect(d.sent("ssh.import.apply")).toEqual([]);
  });
});
