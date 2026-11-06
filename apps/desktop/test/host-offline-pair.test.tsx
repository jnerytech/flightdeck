import { afterEach, describe, expect, test } from "bun:test";
import { translator } from "../src/i18n/index.ts";
import { liveScreen, registerDom } from "./dom.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { TContext } = await import("../src/i18n/context.tsx");
const { HostOfflineBanner } = await import("../src/components/hosts/host-offline-banner.tsx");

afterEach(() => cleanup());

/** A host that refused its token, as the banner is given it. */
const REFUSED = {
  id: "h",
  name: "pc",
  url: "ws://10.0.0.5:7878/v1/ws",
  status: "unauthorized",
  retry: null,
  hostInfo: null,
} as never;

function banner(onPairAgain: (input: string) => Promise<string | null>) {
  render(
    <TContext.Provider value={translator("en")}>
      <HostOfflineBanner host={REFUSED} onReconnect={() => undefined} onPairAgain={onPairAgain} />
    </TContext.Provider>,
  );
  return screen.queryByLabelText("New pairing link or token") as HTMLInputElement | null;
}

async function pair(field: HTMLInputElement, text: string) {
  await act(async () => {
    fireEvent.change(field, { target: { value: text } });
  });
  await act(async () => {
    fireEvent.click(screen.queryByRole("button", { name: "Pair again" }) as HTMLElement);
  });
}

describe("host-offline-pair: Pair again on the banner of a host that refused its token", () => {
  test("a refused try says why and keeps what was typed; one that works empties the field", async () => {
    const tried: string[] = [];
    const answers: Array<string | null> = ["The host refused this token.", null];
    const field = banner(async (input) => {
      tried.push(input);
      return answers.shift() ?? null;
    });
    expect(field).not.toBeNull();
    await pair(field as HTMLInputElement, "tok-1");
    expect(screen.queryByRole("alert")?.textContent).toBe("The host refused this token.");
    expect((field as HTMLInputElement).value).toBe("tok-1");
    await pair(field as HTMLInputElement, "tok-2");
    expect(tried).toEqual(["tok-1", "tok-2"]);
    expect(screen.queryByRole("alert")).toBeNull();
    expect((field as HTMLInputElement).value).toBe("");
  });

  test("a try that throws shows its message", async () => {
    const field = banner(async () => {
      throw new Error("socket closed");
    });
    expect(field).not.toBeNull();
    await pair(field as HTMLInputElement, "tok");
    expect(screen.queryByRole("alert")?.textContent).toBe("socket closed");
  });
});
