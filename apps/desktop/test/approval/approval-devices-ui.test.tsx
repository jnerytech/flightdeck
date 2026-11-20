import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";
import { settleMaybe } from "../wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { ApprovalDevicesPanel } = await import(
  "../../src/features/approval/approval-devices-panel.tsx"
);
const { TContext } = await import("../../src/i18n/context.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

/** The host page's panel of the approving devices (#3439): the status the slice reads and what a person can do. */

type Status = Awaited<ReturnType<InstanceType<typeof AppStore>["approval"]["status"]>>;
const KEY = {
  name: "Ana's phone",
  client: "flightdeck-app",
  address: "100.64.0.7",
  enrolledAt: "2026-11-20T12:00:00.000Z",
};
const OFF: Status = { protectionOff: true, keys: [], thisKeyId: null };
const HERE: Status = {
  protectionOff: false,
  keys: [
    { ...KEY, keyId: "k1" },
    { ...KEY, keyId: "k2", name: "Laptop" },
  ],
  thisKeyId: "k1",
};

/** The panel over a slice whose statuses come one after the other (the last one stays) and whose changes are recorded. */
function panel(
  statuses: Status[],
  language: "en" | "pt-BR" = "en",
  failures: Error[] = [],
  opts: { declined?: boolean; gate?: Promise<void> } = {},
) {
  const store = new AppStore(memoryPlatform(false, language).platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  const calls: string[] = [];
  let read = 0;
  const slice = store.approval as unknown as Record<string, unknown>;
  slice.status = async () => {
    const next = statuses[Math.min(read++, statuses.length - 1)];
    if (!next) throw new Error("no status");
    return next;
  };
  const record =
    (name: string) =>
    async (...args: unknown[]) => {
      calls.push(`${name}:${args.slice(1).join("|")}`);
      const failure = failures.shift();
      if (failure) throw failure;
      await opts.gate;
      return opts.declined ? "declined" : "done";
    };
  slice.enroll = record("enroll");
  slice.revoke = record("revoke");
  slice.removeLocalKey = record("removeLocal");
  let listener: ((heard: unknown) => void) | undefined;
  slice.subscribe = (_host: string, next: (heard: unknown) => void) => {
    listener = next;
    return () => {
      listener = undefined;
    };
  };
  const ui = (id: string) => (
    <TContext.Provider value={store.i18n.t}>
      <ApprovalDevicesPanel
        store={store}
        host={{ id, name: "pi" } as Parameters<typeof ApprovalDevicesPanel>[0]["host"]}
      />
    </TContext.Provider>
  );
  const shown = render(ui("h1"));
  return {
    calls,
    show: (id: string) => shown.rerender(ui(id)),
    /** The host announces a change; the slice hands it to the page that listens. */
    hear: async (heard: unknown) => {
      await act(async () => listener?.(heard));
    },
    listening: () => listener !== undefined,
    reads: () => read,
  };
}

const press = async (name: string) => {
  await act(async () => {
    fireEvent.click(screen.queryByRole("button", { name }) as HTMLElement);
  });
};
const type = (label: string, value: string) =>
  fireEvent.change(screen.queryByLabelText(label) as HTMLElement, { target: { value } });

describe("approval devices panel: enrolling this device (#3439)", () => {
  test("with no device enrolled it says protection is off and enrolls only once the name and the code are typed", async () => {
    const { calls } = panel([OFF, HERE]);
    await settleMaybe(() => screen.queryByText(/Protection is off/) !== null);
    const enroll = screen.queryByRole("button", { name: "Enroll" }) as HTMLButtonElement;
    expect(enroll.disabled).toBe(true);
    type("Name of this device", "  Ana's phone ");
    type("One-time code", " abc-123 ");
    expect((screen.queryByRole("button", { name: "Enroll" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    await press("Enroll");
    await settleMaybe(() => screen.queryByText("This device is enrolled.") !== null);
    expect(calls).toEqual(["enroll:Ana's phone|abc-123"]);
    expect(screen.queryByText("This device is enrolled.")).not.toBeNull();
    expect(screen.queryByLabelText("One-time code")).toBeNull();
  });

  test("a refusal is said where the person is looking, as an alert, and the form stays", async () => {
    panel([OFF], "en", [new Error("The code is wrong or has expired.")]);
    await settleMaybe(() => screen.queryByLabelText("One-time code") !== null);
    type("Name of this device", "phone");
    type("One-time code", "nope");
    await press("Enroll");
    await settleMaybe(() => screen.queryByRole("alert") !== null);
    expect(screen.queryByRole("alert")?.textContent).toBe("The code is wrong or has expired.");
    expect(screen.queryByLabelText("One-time code")).not.toBeNull();
  });
});

describe("approval devices panel: what the person did and what the host said (#3439)", () => {
  test("a declined dialog is not an enrollment: no success is said and the form stays", async () => {
    const { calls } = panel([OFF], "en", [], { declined: true });
    await settleMaybe(() => screen.queryByLabelText("One-time code") !== null);
    type("Name of this device", "phone");
    type("One-time code", "abc");
    await press("Enroll");
    await settleMaybe(() => calls.length > 0);
    expect(calls).toEqual(["enroll:phone|abc"]);
    expect(screen.queryByText("This device is enrolled.") === null).toBe(true);
    expect(screen.queryByLabelText("One-time code") !== null).toBe(true);
  });

  test("a second submit while the first runs sends nothing and the button says it is busy", async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { calls } = panel([OFF, HERE], "en", [], { gate });
    await settleMaybe(() => screen.queryByLabelText("One-time code") !== null);
    type("Name of this device", "phone");
    type("One-time code", "abc");
    await press("Enroll");
    const button = screen.queryByRole("button", { name: "Enroll" }) as HTMLButtonElement;
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.disabled).toBe(true);
    fireEvent.submit(screen.queryByRole("form", { name: "Enroll this device" }) as HTMLElement);
    expect(calls).toEqual(["enroll:phone|abc"]);
    await act(async () => release());
    await settleMaybe(() => screen.queryByText("This device is enrolled.") !== null);
  });

  test("a change that worked is still said when the list cannot be read again", async () => {
    panel([OFF, undefined as never]);
    await settleMaybe(() => screen.queryByLabelText("One-time code") !== null);
    type("Name of this device", "phone");
    type("One-time code", "abc");
    await press("Enroll");
    await settleMaybe(() => screen.queryByText("The host's devices could not be read.") !== null);
    expect(screen.queryByText("This device is enrolled.") !== null).toBe(true);
    expect(screen.queryByRole("button", { name: "Try again" }) !== null).toBe(true);
  });

  test("with protection on and no key here, the panel says what to do, not 'enroll here'", async () => {
    panel([{ ...HERE, thisKeyId: null }]);
    await settleMaybe(() => screen.queryByText(/flightdeckd approvers reset/) !== null);
    expect(screen.queryByText(/flightdeckd approvers reset/) !== null).toBe(true);
    expect(screen.queryByLabelText("One-time code") === null).toBe(true);
  });

  test("a key left on this device that the host does not list can be replaced by enrolling", async () => {
    panel([{ protectionOff: true, keys: [], thisKeyId: "k1" }]);
    await settleMaybe(() => screen.queryByLabelText("One-time code") !== null);
    expect(screen.queryByLabelText("One-time code") !== null).toBe(true);
  });

  test("moving to another host forgets the devices seen on the first one", async () => {
    const { show } = panel([HERE, OFF]);
    await settleMaybe(() => screen.queryByRole("button", { name: "Revoke Laptop" }) !== null);
    show("h2");
    await settleMaybe(() => screen.queryByText(/Protection is off/) !== null);
    expect(screen.queryByText(/someone with access to it did/) === null).toBe(true);
  });
});

describe("approval devices panel: the enrolled devices (#3439)", () => {
  test("each device is listed with where it is, this one is marked, and a revoke names the device", async () => {
    const { calls } = panel([HERE, { ...HERE, keys: HERE.keys.slice(0, 1) }]);
    await settleMaybe(() => screen.queryByRole("list", { name: "Enrolled devices" }) !== null);
    const items = within(
      screen.queryByRole("list", { name: "Enrolled devices" }) as HTMLElement,
    ).queryAllByRole("listitem");
    expect(items.map((li) => li.textContent?.includes("This device"))).toEqual([true, false]);
    expect(items[1]?.textContent).toContain("Another device");
    expect(items[0]?.textContent).toContain("flightdeck-app · 100.64.0.7 · enrolled");
    await press("Revoke Laptop");
    await settleMaybe(() => screen.queryByText("Device revoked.") !== null);
    expect(calls).toEqual(["revoke:k2"]);
    expect(screen.queryByRole("button", { name: "Revoke Laptop" })).toBeNull();
  });

  test("dropping this device's key is offered when it has one, and the list is read again", async () => {
    const { calls } = panel([HERE, { ...HERE, thisKeyId: null }]);
    await settleMaybe(
      () => screen.queryByRole("button", { name: "Remove this device's key" }) !== null,
    );
    await press("Remove this device's key");
    await settleMaybe(() => screen.queryByText("This device's key was removed.") !== null);
    expect(calls).toEqual(["removeLocal:"]);
    expect(screen.queryByRole("button", { name: "Remove this device's key" })).toBeNull();
  });

  test("protection that drops to no device after devices were seen is called out", async () => {
    panel([HERE, OFF]);
    await settleMaybe(() => screen.queryByRole("button", { name: "Revoke Laptop" }) !== null);
    expect(screen.queryByText(/someone with access to it did/)).toBeNull();
    await press("Revoke Laptop");
    await settleMaybe(() => screen.queryByText(/someone with access to it did/) !== null);
    expect(screen.queryByText(/someone with access to it did/)).not.toBeNull();
  });
});

describe("approval devices panel: when the host cannot be read, and in Portuguese (#3439)", () => {
  test("a failed read says so and offers to try again", async () => {
    const store = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 600_000 });
    store.i18n.start();
    let reads = 0;
    (store.approval as unknown as Record<string, unknown>).status = async () => {
      if (reads++ === 0) throw new Error("offline");
      return OFF;
    };
    render(
      <TContext.Provider value={store.i18n.t}>
        <ApprovalDevicesPanel
          store={store}
          host={{ id: "h1", name: "pi" } as Parameters<typeof ApprovalDevicesPanel>[0]["host"]}
        />
      </TContext.Provider>,
    );
    await settleMaybe(() => screen.queryByText("The host's devices could not be read.") !== null);
    await press("Try again");
    await settleMaybe(() => screen.queryByText(/Protection is off/) !== null);
    expect(screen.queryByText(/Protection is off/)).not.toBeNull();
  });

  test("the panel speaks Portuguese", async () => {
    panel([HERE], "pt-BR");
    await settleMaybe(() => screen.queryByText("Dispositivos que aprovam") !== null);
    expect(screen.queryByText("Dispositivos que aprovam")).not.toBeNull();
  });
});

describe("approval devices panel: a change the host announced (#3477)", () => {
  const FOREIGN = { kind: "enrolled", name: "Unknown tablet", own: false };

  test("a device nobody here made is an alert that names it, and the list is read again", async () => {
    const { hear, listening, reads } = panel([HERE]);
    await settleMaybe(() => screen.queryByText("Laptop · Another device") !== null);
    expect(listening()).toBe(true);
    const before = reads();
    await hear(FOREIGN);
    await settleMaybe(() => screen.queryByRole("alert") !== null);
    expect(screen.queryByRole("alert")?.textContent).toContain("Unknown tablet");
    expect(reads()).toBeGreaterThan(before);
  });

  test("a later change does not hide the alert about an earlier device", async () => {
    const { hear } = panel([HERE]);
    await settleMaybe(() => screen.queryByText("Laptop · Another device") !== null);
    await hear(FOREIGN);
    await hear({ kind: "revoked", own: false });
    await settleMaybe(() => screen.queryByText("A device was revoked on pi.") !== null);
    expect(screen.queryByRole("alert")?.textContent).toContain("Unknown tablet");
  });

  test("a name the host sent is quoted, cut at 64 characters and stripped of control characters", async () => {
    const { hear } = panel([HERE]);
    await settleMaybe(() => screen.queryByText("Laptop · Another device") !== null);
    await hear({ kind: "enrolled", name: `\u202Ea${"b".repeat(100)}`, own: false });
    await settleMaybe(() => screen.queryByRole("alert") !== null);
    const text = screen.queryByRole("alert")?.textContent ?? "";
    expect(text.includes(`“a${"b".repeat(63)}”`)).toBe(true);
    expect(text.includes("\u202E")).toBe(false);
  });

  test("the notice is dismissed with its own button, which a keyboard reaches", async () => {
    const { hear } = panel([HERE]);
    await settleMaybe(() => screen.queryByText("Laptop · Another device") !== null);
    await hear(FOREIGN);
    await settleMaybe(() => screen.queryByRole("button", { name: "Dismiss" }) !== null);
    const button = screen.queryByRole("button", { name: "Dismiss" }) as HTMLButtonElement;
    expect(button.tabIndex).toBe(0);
    await press("Dismiss");
    expect(screen.queryByRole("alert") === null).toBe(true);
    expect(screen.queryByRole("button", { name: "Dismiss" }) === null).toBe(true);
  });

  test("this device's own key revoked elsewhere is an alert too: it can no longer approve", async () => {
    const { hear } = panel([HERE]);
    await settleMaybe(() => screen.queryByText("Laptop · Another device") !== null);
    await hear({ kind: "revoked", own: true });
    await settleMaybe(() => screen.queryByRole("alert") !== null);
    expect(screen.queryByRole("alert")?.textContent).toContain(
      "This device's key was revoked on pi",
    );
  });

  test("the notice comes before the list and the form, where the person is already looking", async () => {
    const { hear } = panel([HERE]);
    await settleMaybe(() => screen.queryByText("Laptop · Another device") !== null);
    await hear(FOREIGN);
    await settleMaybe(() => screen.queryByRole("alert") !== null);
    const alert = screen.queryByRole("alert") as HTMLElement;
    const list = screen.queryByRole("list", { name: "Enrolled devices" }) as HTMLElement;
    expect(Boolean(alert.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(
      true,
    );
  });

  test("dismissing leaves the keyboard's focus in the panel, not on the page body", async () => {
    const { hear } = panel([HERE]);
    await settleMaybe(() => screen.queryByText("Laptop · Another device") !== null);
    await hear(FOREIGN);
    await settleMaybe(() => screen.queryByRole("button", { name: "Dismiss" }) !== null);
    const button = screen.queryByRole("button", { name: "Dismiss" }) as HTMLButtonElement;
    button.focus();
    await press("Dismiss");
    expect(document.activeElement === document.body).toBe(false);
  });

  test("another device revoked is told in one quiet line", async () => {
    const { hear } = panel([HERE]);
    await settleMaybe(() => screen.queryByText("Laptop · Another device") !== null);
    await hear({ kind: "revoked", own: false });
    await settleMaybe(() => screen.queryByText("A device was revoked on pi.") !== null);
    expect(screen.queryByRole("alert") === null).toBe(true);
  });

  test("in Portuguese the notice and its button are Portuguese", async () => {
    const { hear } = panel([HERE], "pt-BR");
    await settleMaybe(() => screen.queryByText(/Outro dispositivo/) !== null);
    await hear(FOREIGN);
    await settleMaybe(() => screen.queryByRole("alert") !== null);
    expect(screen.queryByRole("alert")?.textContent).toContain("Unknown tablet");
    expect(screen.queryByRole("alert")?.textContent).toContain("foi cadastrado");
    expect(screen.queryByRole("button", { name: "Dispensar" })).not.toBeNull();
  });

  test("leaving the page stops listening", async () => {
    const { listening } = panel([HERE]);
    await settleMaybe(() => screen.queryByText("Laptop · Another device") !== null);
    expect(listening()).toBe(true);
    cleanup();
    expect(listening()).toBe(false);
  });
});
