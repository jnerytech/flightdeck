import { afterEach, describe, expect, test } from "bun:test";
import type { AccountState, QuotaWindow } from "@flightdeck/protocol";
import { liveScreen, registerDom } from "./dom.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { cleanup, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { TContext } = await import("../src/i18n/context.tsx");
const { translator } = await import("../src/i18n/index.ts");
const { AccountCard } = await import("../src/ui/AccountCard.tsx");

afterEach(cleanup);

const NOW = Date.UTC(2026, 10, 3, 12, 0, 0);
const MINUTE = 60_000;
const utcTime = (iso: string) => new Date(iso).toISOString().slice(11, 16);

const win = (
  window: string,
  utilization: number,
  hours: number,
  status: QuotaWindow["status"] = "allowed",
): QuotaWindow => ({
  window,
  utilization,
  status,
  resetsAt: new Date(NOW + hours * 60 * MINUTE).toISOString(),
  readAt: new Date(NOW - 2 * MINUTE).toISOString(),
});

const state = (over: Partial<AccountState> = {}): AccountState => ({
  status: "signed_in",
  name: "demo@example.com",
  organization: "Demo Org",
  plan: "max",
  provider: "firstParty",
  windows: [win("five_hour", 0.42, 3), win("seven_day", 0.53, 48)],
  readAt: new Date(NOW - 2 * MINUTE).toISOString(),
  stale: false,
  error: null,
  source: "sdk",
  loginCommand: "claude auth login",
  ...over,
});

const noop = () => {};

function show(
  props: {
    state?: AccountState | undefined;
    online?: boolean;
    refreshing?: boolean;
    copied?: boolean;
  },
  language: "en" | "pt-BR" = "en",
) {
  const merged = { state: undefined, online: true, refreshing: false, copied: false, ...props };
  return render(
    <TContext.Provider value={translator(language)}>
      <AccountCard
        hostName="alfa"
        online={merged.online}
        state={merged.state}
        now={NOW}
        formatTime={utcTime}
        refreshing={merged.refreshing}
        copied={merged.copied}
        onRefresh={noop}
        onCopy={noop}
        onTerminal={noop}
      />
    </TContext.Provider>,
  );
}

const card = () =>
  screen.queryByRole("region", { name: /^(Claude account of|Conta do Claude de) alfa$/ });
const inCard = () => {
  const el = card();
  expect(el).not.toBeNull();
  return within(el as HTMLElement);
};
const bar = (window: string) => card()?.querySelector(`[data-window="${window}"]`) ?? null;
const inBar = (window: string) => {
  const el = bar(window);
  expect(el).not.toBeNull();
  return within(el as HTMLElement);
};

describe("conta-cartao-ui: signed in", () => {
  test("shows the account, the organization and the plan", () => {
    show({ state: state() });
    expect(card()).not.toBeNull();
    expect(inCard().queryByText("demo@example.com")).not.toBeNull();
    expect(inCard().queryByText("Demo Org")).not.toBeNull();
    expect(inCard().queryByText("Max")).not.toBeNull();
  });

  test("two bars with percentage, reset time (exact on hover) and the age of the reading", () => {
    show({ state: state() });
    expect(inBar("five_hour").queryByText("5 hours")).not.toBeNull();
    expect(inBar("five_hour").queryByText("42%")).not.toBeNull();
    expect(inBar("five_hour").queryByText("resets in 3 h")).not.toBeNull();
    expect(inBar("five_hour").queryByText("resets in 3 h")?.getAttribute("title")).toBe(
      "resets at 15:00",
    );
    expect(inBar("seven_day").queryByText("7 days")).not.toBeNull();
    expect(inBar("seven_day").queryByText("53%")).not.toBeNull();
    expect(inCard().queryByText("Last read 2 min ago")).not.toBeNull();
  });

  test("each bar is a meter with its value and a text for the reset", () => {
    show({ state: state() });
    const meter = inCard().queryByRole("meter", { name: "5 hours of alfa" });
    expect(meter).not.toBeNull();
    expect(meter?.getAttribute("value")).toBe("0.42");
    expect(meter?.getAttribute("max")).toBe("1");
    expect(meter?.getAttribute("aria-valuetext")).toBe("42%, resets in 3 h");
    expect(inCard().queryAllByRole("meter").length).toBe(2);
  });

  test("a window with no reset time reads as just its percentage, and shows no reset line", () => {
    show({ state: state({ windows: [{ ...win("five_hour", 0.42, 3), resetsAt: null }] }) });
    const meter = inCard().queryByRole("meter", { name: "5 hours of alfa" });
    expect(meter?.getAttribute("aria-valuetext")).toBe("42%");
    expect(inBar("five_hour").queryByText(/resets in/)).toBeNull();
  });

  test("the Opus and Sonnet bars appear only when the host reports them", () => {
    show({
      state: state({
        windows: [
          win("five_hour", 0.1, 1),
          win("seven_day", 0.2, 48),
          win("seven_day_opus", 0.3, 48),
          win("seven_day_sonnet", 0.4, 48),
        ],
      }),
    });
    expect(inCard().queryAllByRole("meter").length).toBe(4);
    expect(bar("seven_day_opus")).not.toBeNull();
    expect(inBar("seven_day_sonnet").queryByText("7 days · Sonnet")).not.toBeNull();
  });

  test("a warning and a rejected window take their status colours", () => {
    show({
      state: state({
        windows: [
          win("five_hour", 0.85, 1, "allowed_warning"),
          win("seven_day", 1, 48, "rejected"),
        ],
      }),
    });
    expect(bar("five_hour")?.getAttribute("data-status")).toBe("allowed_warning");
    expect(inBar("five_hour").queryByText("85%")?.className).toContain("text-status-needs-you");
    expect(bar("seven_day")?.getAttribute("data-status")).toBe("rejected");
    expect(inBar("seven_day").queryByText("100%")?.className).toContain("text-status-error");
  });

  test("a plan it does not know shows as the host named it; no plan shows none", () => {
    const { unmount } = show({ state: state({ plan: "weird plan" }) });
    expect(inCard().queryByText("weird plan")).not.toBeNull();
    unmount();
    show({ state: state({ plan: null, organization: null }) });
    expect(inCard().queryByText("Max")).toBeNull();
    expect(inCard().queryByText("Demo Org")).toBeNull();
  });

  test("with no windows it says so, instead of empty bars", () => {
    show({ state: state({ windows: [] }) });
    expect(inCard().queryAllByRole("meter").length).toBe(0);
    expect(inCard().queryByText("The host reported no plan windows.")).not.toBeNull();
  });

  test("a stale reading keeps the data and says the refresh failed", () => {
    show({ state: state({ stale: true, error: "account_unavailable" }) });
    expect(inCard().queryByText("demo@example.com")).not.toBeNull();
    expect(inCard().queryAllByRole("meter").length).toBe(2);
    expect(inCard().queryByText("Could not refresh: this is the last reading.")).not.toBeNull();
  });
});

describe("conta-cartao-ui: the other states", () => {
  test("not signed in: the steps and the command, with no form", () => {
    show({
      state: state({
        status: "signed_out",
        name: null,
        organization: null,
        plan: null,
        windows: [],
      }),
    });
    expect(inCard().queryByText("This host is not signed in to Claude.")).not.toBeNull();
    expect(inCard().queryByText("claude auth login")).not.toBeNull();
    expect(inCard().queryByRole("button", { name: "Copy command" })).not.toBeNull();
    expect(inCard().queryByRole("button", { name: "Open terminal" })).not.toBeNull();
    expect(inCard().queryAllByRole("textbox").length).toBe(0);
    expect(card()?.querySelector("input, textarea, a")).toBeNull();
    expect(inCard().queryAllByRole("meter").length).toBe(0);
  });

  test("after copying the button says so", () => {
    show({ state: state({ status: "signed_out", windows: [] }), copied: true });
    expect(inCard().queryByRole("button", { name: "Command copied" })).not.toBeNull();
  });

  test("an API key host: plan limits do not apply", () => {
    show({ state: state({ status: "api_key", name: null, plan: null, windows: [] }) });
    expect(
      inCard().queryByText("This host uses an API key. Plan limits do not apply."),
    ).not.toBeNull();
    expect(inCard().queryAllByRole("meter").length).toBe(0);
  });

  test("a cloud provider host names its provider", () => {
    show({ state: state({ status: "third_party", provider: "bedrock", windows: [] }) });
    expect(
      inCard().queryByText("This host uses bedrock. Plan limits do not apply."),
    ).not.toBeNull();
  });

  test("unavailable: the reason and a retry, no data", () => {
    show({
      state: state({
        status: "unknown",
        name: null,
        organization: null,
        plan: null,
        windows: [],
        readAt: null,
        error: "account_unavailable",
      }),
    });
    expect(inCard().queryByText("The account could not be read.")).not.toBeNull();
    expect(
      inCard().queryByText(
        "This host's Claude account could not be read. Check that `claude` is installed there, then try again.",
      ),
    ).not.toBeNull();
    expect(inCard().queryByRole("button", { name: "Try again" })).not.toBeNull();
  });

  test("a sign-in the app does not know is said as such, not shown as loading", () => {
    show({ state: state({ status: "unknown", name: null, plan: null, windows: [], error: null }) });
    expect(inCard().queryByText("This host's sign-in is not one the app knows.")).not.toBeNull();
    expect(inCard().queryByText("Reading the account…")).toBeNull();
  });

  test("before the first answer it says it is reading", () => {
    show({ state: undefined });
    expect(inCard().queryByText("Reading the account…")).not.toBeNull();
  });

  test("an offline host does not show an old reading as current", () => {
    show({ state: state(), online: false });
    expect(
      inCard().queryByText("alfa is offline: the account shows again when it is back."),
    ).not.toBeNull();
    expect(inCard().queryByText("demo@example.com")).toBeNull();
    expect(inCard().queryAllByRole("meter").length).toBe(0);
  });
});

describe("conta-cartao-ui: the refresh button", () => {
  test("is there when signed in, and disabled while a read runs", () => {
    const { unmount } = show({ state: state() });
    const button = inCard().queryByRole("button", { name: "Refresh the account of alfa" });
    expect(button).not.toBeNull();
    expect((button as HTMLButtonElement).disabled).toBe(false);
    unmount();
    show({ state: state(), refreshing: true });
    const busy = inCard().queryByRole("button", { name: "Refresh the account of alfa" });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("conta-cartao-ui: pt-BR", () => {
  test("the card speaks Portuguese in each state", () => {
    const { unmount } = show({ state: state() }, "pt-BR");
    expect(inCard().queryByText("5 horas")).not.toBeNull();
    expect(inCard().queryByText("reinicia em 3 h")).not.toBeNull();
    expect(inCard().queryByText("Última leitura há 2 min")).not.toBeNull();
    expect(inCard().queryByRole("meter", { name: "5 horas de alfa" })).not.toBeNull();
    unmount();
    const out = show({ state: state({ status: "signed_out", windows: [] }) }, "pt-BR");
    expect(inCard().queryByText("Este host não está conectado ao Claude.")).not.toBeNull();
    expect(inCard().queryByRole("button", { name: "Copiar comando" })).not.toBeNull();
    expect(inCard().queryByRole("button", { name: "Abrir terminal" })).not.toBeNull();
    out.unmount();
    show({ state: state({ status: "api_key", windows: [] }) }, "pt-BR");
    expect(
      inCard().queryByText("Este host usa uma chave de API. Os limites do plano não se aplicam."),
    ).not.toBeNull();
  });
});
