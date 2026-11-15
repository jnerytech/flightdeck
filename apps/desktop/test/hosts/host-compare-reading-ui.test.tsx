import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { settleMaybe } from "../wait.ts";
import {
  act,
  answered,
  cells,
  cleanup,
  fireEvent,
  fixNames,
  mount,
  names,
  open,
  panel,
  screen,
  table,
} from "./host-compare-setup.tsx";

setDefaultTimeout(30_000);
afterEach(cleanup);

/** What the polite status lines of the panel say now. */
const statusText = () =>
  screen
    .queryAllByRole("status")
    .map((s) => s.textContent ?? "")
    .join(" ");

describe("host-compare-ui: the panel says it is reading (#2652)", () => {
  const FACTS = { hooks: "ok", signin: "ok" } as const;

  test("while a host has not answered, its cells say Reading and the status line names it", async () => {
    const { store, release } = mount(
      [
        { id: "alfa", ...FACTS },
        { id: "beta", ...FACTS },
        { id: "gama", ...FACTS },
      ],
      "en",
      undefined,
      ["gama"],
    );
    await open();
    expect(await settleMaybe(() => Object.keys(store.getState().healthAt).length === 2, 1500)).toBe(
      true,
    );
    expect(statusText()).toContain("Reading gama");
    expect(cells("Hooks")[2]).toBe("Reading…");
    expect(cells("Hooks")[0]).toContain("Installed");
    expect(table()?.getAttribute("aria-busy")).toBe("true");
    release();
    expect(await answered(store, 3)).toBe(true);
    expect(cells("Hooks")[2]).toContain("Installed");
    expect(table()?.getAttribute("aria-busy")).not.toBe("true");
  });

  test("when every host answered, the status line says it is done", async () => {
    const { store } = mount([
      { id: "alfa", ...FACTS },
      { id: "beta", ...FACTS },
    ]);
    await open();
    expect(await answered(store, 2)).toBe(true);
    expect(statusText()).toBe("Comparison up to date.");
  });

  test("a host that did not answer is named when the read ends", async () => {
    const { store } = mount([
      { id: "alfa", ...FACTS },
      { id: "beta", ...FACTS },
      { id: "gama", refuse: true },
    ]);
    await open();
    expect(await answered(store, 3)).toBe(true);
    expect(statusText()).toBe("Read finished. No answer from gama.");
  });

  test("a host that answered without a hooks fact says Not known, not Reading", async () => {
    const { store } = mount([
      { id: "alfa", ...FACTS },
      { id: "beta", ...FACTS },
      { id: "gama", signin: "ok" },
    ]);
    await open();
    expect(await answered(store, 3)).toBe(true);
    expect(cells("Hooks")[2]).toContain("Not known");
    expect(cells("Hooks")[2]).not.toContain("Reading");
  });

  test("with no host online nothing is read, so the status line says nothing", async () => {
    const { asked } = mount([
      { id: "alfa", status: "offline" },
      { id: "beta", status: "offline" },
    ]);
    await open();
    await act(async () => {});
    expect([asked.length, statusText()]).toEqual([0, ""]);
  });

  test("Refresh reads again and says so again", async () => {
    const { store } = mount([
      { id: "alfa", ...FACTS },
      { id: "beta", ...FACTS },
    ]);
    await open();
    expect(await answered(store, 2)).toBe(true);
    await act(async () => {
      const refresh = screen.queryByRole("button", { name: names.en.refresh });
      if (refresh) fireEvent.click(refresh);
    });
    expect(await settleMaybe(() => statusText() === "Comparison up to date.", 1500)).toBe(true);
  });

  test("in Portuguese the status lines and the cell word come from the dictionary", async () => {
    const { store, release } = mount(
      [
        { id: "alfa", ...FACTS },
        { id: "beta", ...FACTS },
      ],
      "pt-BR",
      undefined,
      ["beta"],
    );
    await open("pt-BR");
    expect(await settleMaybe(() => Object.keys(store.getState().healthAt).length === 1, 1500)).toBe(
      true,
    );
    expect(statusText()).toContain("Lendo beta");
    expect(cells("Hooks", "pt-BR")[1]).toBe("Lendo…");
    release();
    expect(await answered(store, 2)).toBe(true);
    expect(statusText()).toBe("Comparação atualizada.");
  });
});

describe("host-compare-ui: in Portuguese", () => {
  test("the headings, the words and the reason come from the pt-BR dictionary", async () => {
    const { store } = mount(
      [
        { id: "alfa", daemon: "1.4.0", signin: "ok", hooks: "ok", gh: "ok", boot: "missing" },
        { id: "beta", daemon: "1.4.0", signin: "ok", hooks: "ok", gh: "ok", boot: "missing" },
        {
          id: "gama",
          daemon: "1.3.0",
          signin: "missing",
          hooks: "outdated",
          gh: "missing",
          boot: "ok",
          os: "win32",
          claude: null,
        },
        { id: "delta", status: "offline" },
      ],
      "pt-BR",
    );
    expect(panel("pt-BR") !== null).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
    await open("pt-BR");
    expect(await answered(store, 3)).toBe(true);
    expect(cells("Sistema operacional", "pt-BR")[2] ?? "").toContain("Windows");
    expect(cells("Hooks", "pt-BR")[2] ?? "").toContain("Desatualizados");
    expect(cells("GitHub CLI (gh)", "pt-BR")[2]).toContain("Não instalado");
    expect(cells("Iniciar no boot", "pt-BR")[2] ?? "").toContain("Ligado");
    // The daemon, hooks, sign-in and gh of gama are marked and lacking; Start at boot is marked, but on.
    expect(fixNames()).toEqual([
      "Corrigir Versão do daemon em gama",
      "Corrigir Hooks em gama",
      "Corrigir Login do Claude em gama",
      "Corrigir GitHub CLI (gh) em gama",
    ]);
    const first = table("pt-BR")?.querySelectorAll("tbody tr")[0]?.querySelectorAll("td");
    expect(first?.[3]?.textContent).toBe("Não comparado: offline.");
    expect(cells("Versão do daemon", "pt-BR")[2] ?? "").toContain(
      "Difere da maioria dos hosts, que têm 1.4.0",
    );
    expect(cells("Login do Claude", "pt-BR")[2] ?? "").toContain("Sem login");
    expect(cells("Versão do Claude Code", "pt-BR")[2] ?? "").toContain("Desconhecido");
  });

  test("the features that differ and the fold are said in Portuguese", async () => {
    const lacking = ["a1", "a2", "a3", "a4", "a5"];
    const { store } = mount(
      [
        { id: "alfa", features: lacking },
        { id: "beta", features: lacking },
        { id: "gama", features: ["a1", "zeta"] },
      ],
      "pt-BR",
    );
    await open("pt-BR");
    expect(await answered(store, 3)).toBe(true);
    const gama = cells("Recursos", "pt-BR")[2] ?? "";
    expect(gama).toContain("sem a2, sem a3, sem a4");
    expect(gama).toContain("e mais 2");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "e mais 2" }));
    });
    expect(cells("Recursos", "pt-BR")[2]).toContain("sem a5, tem zeta");
  });

  test("two hosts that differ say so in Portuguese, and name their features", async () => {
    const { store } = mount(
      [
        { id: "alfa", daemon: "1.4.0", features: ["stall"] },
        { id: "beta", daemon: "1.3.0", features: ["quota"] },
      ],
      "pt-BR",
    );
    await open("pt-BR");
    expect(await answered(store, 2)).toBe(true);
    for (const cell of cells("Versão do daemon", "pt-BR")) {
      expect(cell).toContain("Difere, sem maioria entre os hosts");
    }
    expect(cells("Recursos", "pt-BR")[0]).toContain("sem quota, tem stall");
    expect(cells("Recursos", "pt-BR")[1]).toContain("sem stall, tem quota");
  });
});
