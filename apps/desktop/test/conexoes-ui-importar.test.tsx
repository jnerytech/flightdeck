import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { SshImportEntry } from "@flightdeck/protocol";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform, TOKEN } from "./fixtures.ts";
import { sshDaemon, sshTarget } from "./ssh-daemon.ts";
import { waiter } from "./wait.ts";

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

const settle = waiter(4000);

const entry = (alias: string, exists = false): SshImportEntry => ({
  alias,
  host: `${alias}.example.com`,
  port: 22,
  user: "me",
  identityFile: null,
  proxyJump: null,
  exists,
});

async function open(
  importEntries: SshImportEntry[],
  importSkipped: Array<{
    alias: string;
    reason: string;
    why?: string;
    params?: Record<string, string | number>;
  }> = [],
) {
  const d = sshDaemon(cleanups, {
    targets: [sshTarget({ id: "t1", name: "vps" })],
    importEntries,
    importSkipped,
  });
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

  test("an alias the daemon skipped is explained in the app's language, from the reason", async () => {
    await open(
      [entry("web", false)],
      [
        {
          alias: "web",
          reason: "ProxyJump bastion is not a destination: import it first",
          why: "ssh_import_jump_unknown",
          params: { jump: "bastion" },
        },
      ],
    );
    await click("Importar do SSH config");
    await click("Importar selecionados");
    const lines = Array.from(document.querySelectorAll("li, p")).map((e) => e.textContent ?? "");
    const line = lines.find((text) => text.startsWith("web: ")) ?? "";
    expect(line).toContain("bastion");
    expect(line).not.toContain("is not a destination");
  });

  test("Importar selecionados says why it is closed when nothing is ticked", async () => {
    await open([entry("vps", true)]);
    await click("Importar do SSH config");
    const button = screen.queryByRole("button", {
      name: "Importar selecionados",
    }) as HTMLButtonElement | null;
    const reason = screen.queryByText("Marque ao menos um destino.");
    expect(reason).not.toBeNull();
    expect(button?.getAttribute("aria-describedby")).toBe(reason?.id ?? "?");
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

  test("Cancelar closes the preview without importing anything", async () => {
    const { d } = await open([entry("web")]);
    await click("Importar do SSH config");
    expect(screen.queryByRole("button", { name: "Importar selecionados" })).not.toBeNull();
    await click("Cancelar");
    expect(screen.queryByRole("button", { name: "Importar selecionados" })).toBeNull();
    expect(d.sent("ssh.import.apply")).toEqual([]);
  });
  test("an entry the daemon did not import is listed with its reason", async () => {
    await open([entry("web"), entry("db")], [{ alias: "db", reason: "nome repetido" }]);
    await click("Importar do SSH config");
    await click("Importar selecionados");
    expect(screen.queryByText("db: nome repetido")).not.toBeNull();
  });
});
