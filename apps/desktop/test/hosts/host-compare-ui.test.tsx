import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { settleMaybe } from "../wait.ts";
import {
  act,
  answered,
  cells,
  cleanup,
  type Fixture,
  fireEvent,
  fixNames,
  mount,
  names,
  open,
  panel,
  render,
  screen,
  setup,
  table,
} from "./host-compare-setup.tsx";

setDefaultTimeout(30_000);
afterEach(cleanup);

describe("host-compare-ui: when the panel shows and when the hosts are asked", () => {
  test("a single host has nothing to compare with, so the panel is not shown", () => {
    mount([{ id: "alfa" }]);
    expect(panel() === null).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
    expect(screen.queryByRole("button", { name: names.en.show }) === null).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
  });

  test("two hosts show the panel closed, and nobody is asked until it is opened", async () => {
    const { view, asked, push, hosts } = setup([{ id: "alfa" }, { id: "beta" }]);
    render(view);
    expect(panel() !== null).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
    expect(screen.queryByRole("button", { name: names.en.show }) !== null).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
    expect(table() === null).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
    // Something else in the app changes: still nothing asked.
    await act(async () => push({ hosts: [...hosts] as never }));
    expect(asked).toEqual([]);
  });

  test("opening asks doctor.run of each online host once; Refresh asks again; an offline host is not asked", async () => {
    const { view, asked } = setup([
      { id: "alfa" },
      { id: "beta" },
      { id: "gama", status: "offline" },
    ]);
    render(view);
    await open();
    expect(table() !== null).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
    const doctorAsks = () => asked.filter((a) => a.endsWith(":doctor.run")).sort();
    expect(doctorAsks()).toEqual(["alfa:doctor.run", "beta:doctor.run"]);
    await act(async () => {
      const refresh = screen.queryByRole("button", { name: names.en.refresh });
      if (refresh) fireEvent.click(refresh);
    });
    expect(await settleMaybe(() => doctorAsks().length === 4, 1500)).toBe(true);
    expect(doctorAsks()).toEqual([
      "alfa:doctor.run",
      "alfa:doctor.run",
      "beta:doctor.run",
      "beta:doctor.run",
    ]);
  });

  test("hiding the panel asks nobody and removes the table; showing it again asks again", async () => {
    const { view, asked } = setup([{ id: "alfa" }, { id: "beta" }]);
    render(view);
    await open();
    const doctorAsks = () => asked.filter((a) => a.endsWith(":doctor.run")).length;
    expect([doctorAsks(), table() !== null]).toEqual([2, true]);
    await act(async () => {
      const hide = screen.queryByRole("button", { name: names.en.hide });
      if (hide) fireEvent.click(hide);
    });
    // Closing is not a reason to ask: the count stays, the table is gone, the toggle offers Show.
    await act(async () => {});
    expect([
      doctorAsks(),
      table() === null,
      screen.queryByRole("button", { name: names.en.show })?.getAttribute("aria-expanded"),
    ]).toEqual([2, true, "false"]);
    await open();
    expect(await settleMaybe(() => doctorAsks() === 4, 1500)).toBe(true);
  });
});

describe("host-compare-ui: the table", () => {
  const THREE: Fixture[] = [
    { id: "alfa", daemon: "1.4.0", hooks: "ok", signin: "ok" },
    { id: "beta", daemon: "1.4.0", hooks: "ok", signin: "ok" },
    { id: "gama", daemon: "1.3.0", hooks: "outdated", signin: "missing" },
  ];

  test("one column per host and one row per field, each row named in its header", async () => {
    mount(THREE);
    await open();
    const columns = [...(table()?.querySelectorAll("thead th") ?? [])].map((th) => th.textContent);
    expect(columns).toEqual(["alfa", "beta", "gama"]);
    const fields = [...(table()?.querySelectorAll("tbody th") ?? [])].map((th) => th.textContent);
    expect(fields).toEqual([
      "Operating system",
      "Daemon version",
      "Claude Code version",
      "Hooks",
      "Claude sign-in",
      "GitHub CLI (gh)",
      "Azure CLI (az)",
      "Start at boot",
      "Features",
    ]);
  });

  test("the cell that differs says why in words, and the cells that agree say nothing", async () => {
    const { store } = mount(THREE);
    await open();
    expect(await answered(store, 3)).toBe(true);
    const [alfa, beta, gama] = cells("Daemon version");
    expect(alfa).toBe("1.4.0");
    expect(beta).toBe("1.4.0");
    expect(gama).toContain("1.3.0");
    expect(gama).toContain("Differs from most hosts, which have 1.4.0");
  });

  test("hooks and sign-in are shown as words, and the reason names the majority's word", async () => {
    const { store } = mount(THREE);
    await open();
    expect(await answered(store, 3)).toBe(true);
    expect(cells("Hooks")[0]).toBe("Installed");
    expect(cells("Hooks")[2] ?? "").toContain("Outdated");
    expect(cells("Hooks")[2] ?? "").not.toContain("Warning");
    expect(cells("Hooks")[2] ?? "").toContain("which have Installed");
    expect(await answered(store, 3)).toBe(true);
    expect(cells("Claude sign-in")[0]).toBe("Signed in");
    expect(cells("Claude sign-in")[2] ?? "").toContain("Not signed in");
    expect(cells("Claude sign-in")[2] ?? "").toContain("which have Signed in");
  });

  test("two hosts that differ both say so in words, with no majority named", async () => {
    const { store } = mount([
      { id: "alfa", daemon: "1.4.0" },
      { id: "beta", daemon: "1.3.0" },
    ]);
    await open();
    expect(await answered(store, 2)).toBe(true);
    const [alfa, beta] = cells("Daemon version");
    expect(alfa).toContain("1.4.0");
    expect(alfa).toContain("Differs, with no majority among the hosts");
    expect(beta).toContain("1.3.0");
    expect(beta).toContain("Differs, with no majority among the hosts");
    expect(screen.queryAllByText(/Differs from most hosts/).length).toBe(0); // NOSONAR: a failed length check on DOM elements prints each node
  });

  test("in a tied daemon row only the older host has a Fix button, and the newest has none", async () => {
    const { store } = mount([
      { id: "alfa", daemon: "1.4.0" },
      { id: "beta", daemon: "1.3.0" },
    ]);
    await open();
    expect(await answered(store, 2)).toBe(true);
    expect(screen.queryByRole("button", { name: "Fix Daemon version on alfa" })).toBeNull();
    const fixBeta = screen.queryByRole("button", { name: "Fix Daemon version on beta" });
    expect(fixBeta !== null).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
    expect(screen.queryAllByRole("button", { name: /^Fix .+ on / }).length).toBe(1); // NOSONAR: a failed length check on DOM elements prints each node
  });

  test("two hosts that match say nothing in any row", async () => {
    const { store } = mount([{ id: "alfa" }, { id: "beta" }]);
    await open();
    expect(await answered(store, 2)).toBe(true);
    expect(cells("Daemon version")).toEqual(["1.4.0", "1.4.0"]);
    expect(table()).not.toBeNull();
    expect(table()?.textContent).not.toContain("Differs");
  });

  test("two hosts with different features each name what only it has and what only the other has", async () => {
    const { store } = mount([
      { id: "alfa", features: ["stall"] },
      { id: "beta", features: ["quota"] },
    ]);
    await open();
    expect(await answered(store, 2)).toBe(true);
    const [alfa, beta] = cells("Features");
    expect(alfa).toContain("no quota, has stall");
    expect(beta).toContain("no stall, has quota");
  });

  test("a value the host does not report is a dash with a word for it, and is never marked", async () => {
    const { store } = mount([
      { id: "alfa", claude: "2.1.0" },
      { id: "beta", claude: "2.1.0" },
      { id: "gama", claude: null },
    ]);
    await open();
    expect(await answered(store, 3)).toBe(true);
    const gama = cells("Claude Code version")[2] ?? "";
    expect(gama).toContain("—");
    expect(gama).toContain("Not known");
    expect(gama).not.toContain("Differs");
  });

  test("a host that is absent from the hooks says Absent, not a warning", async () => {
    const { store } = mount([
      { id: "alfa", hooks: "ok" },
      { id: "beta", hooks: "ok" },
      { id: "gama", hooks: "missing" },
    ]);
    await open();
    expect(await answered(store, 3)).toBe(true);
    expect(cells("Hooks")[2] ?? "").toContain("Absent");
    expect(cells("Hooks")[2] ?? "").toContain("which have Installed");
  });

  test("the operating system, gh, az and Start at boot are rows of their own, said in words", async () => {
    const { store } = mount([
      { id: "alfa", os: "linux", gh: "ok", az: "ok", boot: "missing" },
      { id: "beta", os: "linux", gh: "ok", az: "ok", boot: "missing" },
      { id: "gama", os: "win32", gh: "missing", az: "outdated", boot: "ok" },
    ]);
    await open();
    expect(await answered(store, 3)).toBe(true);
    expect(cells("Operating system").map((c) => c.split("Differs")[0])).toEqual([
      "Linux",
      "Linux",
      "Windows",
    ]);
    expect(cells("Operating system")[2] ?? "").toContain("which have Linux");
    expect(cells("GitHub CLI (gh)")[0]).toBe("Installed");
    expect(cells("GitHub CLI (gh)")[2]).toContain("Not installed");
    expect(cells("Azure CLI (az)")[2]).toContain("Outdated");
    expect(cells("Start at boot")[0]).toBe("Off");
    expect(cells("Start at boot")[2] ?? "").toContain("On");
    expect(cells("Start at boot")[2] ?? "").toContain("which have Off");
  });

  test("an offline host says so once, in place of a column of dashes", async () => {
    const known = { hooks: "ok", signin: "ok", gh: "ok", az: "ok", boot: "ok" } as const;
    const { store } = mount([
      { id: "alfa", ...known },
      { id: "beta", ...known },
      { id: "gama", status: "offline" },
    ]);
    await open();
    expect(await answered(store, 2)).toBe(true);
    const rows = [...(table()?.querySelectorAll("tbody tr") ?? [])];
    const first = [...(rows[0]?.querySelectorAll("td") ?? [])];
    expect(first.map((td) => td.textContent).slice(2)).toEqual(["Not compared: offline."]);
    expect(first[2]?.getAttribute("rowspan")).toBe(String(rows.length));
    // The other rows have no cell for it: the first one spans them.
    expect(rows.slice(1).map((row) => row.querySelectorAll("td").length)).toEqual(
      rows.slice(1).map(() => 2),
    );
    expect(table()?.textContent).not.toContain("Not known");
    expect(table()?.textContent).not.toContain("—");
  });

  test("a host being reached again, or refused, says that in the same place", async () => {
    const { store } = mount([
      { id: "alfa" },
      { id: "beta" },
      { id: "gama", status: "connecting" },
      { id: "delta", status: "unauthorized" },
    ]);
    await open();
    expect(await answered(store, 2)).toBe(true);
    const first = [...(table()?.querySelectorAll("tbody tr")[0]?.querySelectorAll("td") ?? [])];
    expect(first.map((td) => td.textContent).slice(2)).toEqual([
      "Not compared: reconnecting.",
      "Not compared: token refused.",
    ]);
  });

  test("a marked cell that is lacking links to the fix on its host, and one with no fix has no link", async () => {
    const { store } = mount([
      { id: "alfa", os: "linux", hooks: "ok", gh: "ok" },
      { id: "beta", os: "linux", hooks: "ok", gh: "ok" },
      { id: "gama", os: "win32", hooks: "missing", gh: "ok" },
    ]);
    await open();
    expect(await answered(store, 3)).toBe(true);
    const link = screen.queryByRole("button", { name: "Fix Hooks on gama" });
    expect(link !== null).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
    // Hooks is the only marked cell with a fix: the OS differs too, and has none.
    expect(screen.queryAllByRole("button", { name: /^Fix .+ on / }).length).toBe(1); // NOSONAR: a failed length check on DOM elements prints each node
    await act(async () => {
      if (link) fireEvent.click(link);
    });
    expect(store.router.current).toEqual({ name: "host", host: "gama", section: "health" });
  });

  test("features show as a count, and the host that differs says which ones it lacks, in words", async () => {
    const { store } = mount([
      { id: "alfa", features: ["account", "central"] },
      { id: "beta", features: ["account", "central"] },
      { id: "gama", features: ["account", "quota"] },
    ]);
    await open();
    expect(await answered(store, 3)).toBe(true);
    const [alfa, beta, gama] = cells("Features");
    expect(alfa).toBe("4");
    expect(beta).toBe("4");
    expect(gama).toContain("4");
    expect(gama).toContain("no central, has quota");
  });

  test("a long list of differing features folds to the first 3 and 'and N more', and opens in one click", async () => {
    const lacking = ["a1", "a2", "a3", "a4", "a5"];
    const { store } = mount([
      { id: "alfa", features: lacking },
      { id: "beta", features: lacking },
      { id: "gama", features: [] },
    ]);
    await open();
    expect(await answered(store, 3)).toBe(true);
    const [alfa, , gama] = cells("Features");
    expect(alfa).toBe("7");
    expect(gama).toContain("no a1, no a2, no a3");
    expect(gama).toContain("and 2 more");
    expect(gama).not.toContain("a4");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "and 2 more" }));
    });
    const opened = cells("Features")[2] ?? "";
    expect(opened).toContain("no a1, no a2, no a3, no a4, no a5");
    expect(opened).not.toContain("and 2 more");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Show fewer" }));
    });
    expect(cells("Features")[2]).not.toContain("a4");
  });

  test("a list of 3 or fewer is shown whole, with nothing to open", async () => {
    const { store } = mount([
      { id: "alfa", features: ["a1", "a2", "a3"] },
      { id: "beta", features: ["a1", "a2", "a3"] },
      { id: "gama", features: [] },
    ]);
    await open();
    expect(await answered(store, 3)).toBe(true);
    expect(cells("Features")[2]).toContain("no a1, no a2, no a3");
    expect(screen.queryByRole("button", { name: /more/ })).toBeNull();
  });
});

describe("host-compare-ui: the Fix buttons name their field (#2651)", () => {
  test("two differing rows of one host give two Fix buttons with different names", async () => {
    const { store } = mount([
      { id: "alfa", hooks: "ok", signin: "ok" },
      { id: "beta", hooks: "ok", signin: "ok" },
      { id: "gama", hooks: "missing", signin: "missing" },
    ]);
    await open();
    expect(await answered(store, 3)).toBe(true);
    expect(fixNames()).toEqual(["Fix Hooks on gama", "Fix Claude sign-in on gama"]);
  });

  test("the name starts with the visible text, so voice control can say what it sees", async () => {
    const { store } = mount([
      { id: "alfa", hooks: "ok", signin: "ok" },
      { id: "beta", hooks: "ok", signin: "ok" },
      { id: "gama", hooks: "missing", signin: "ok" },
    ]);
    await open();
    expect(await answered(store, 3)).toBe(true);
    const button = screen.queryByRole("button", { name: "Fix Hooks on gama" });
    expect(button?.textContent).toBe("Fix Hooks on gama");
  });

  test("in Portuguese the two names differ as well", async () => {
    const { store } = mount(
      [
        { id: "alfa", hooks: "ok", signin: "ok" },
        { id: "beta", hooks: "ok", signin: "ok" },
        { id: "gama", hooks: "missing", signin: "missing" },
      ],
      "pt-BR",
    );
    await open("pt-BR");
    expect(await answered(store, 3)).toBe(true);
    expect(fixNames()).toEqual(["Corrigir Hooks em gama", "Corrigir Login do Claude em gama"]);
  });
});
