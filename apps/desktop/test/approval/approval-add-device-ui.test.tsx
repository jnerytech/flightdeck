import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";
import { settle, settleMaybe } from "../wait.ts";

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

/** Adding a second approving device from the host's page (#3478): both roles, and what each says. */

type Status = Awaited<ReturnType<InstanceType<typeof AppStore>["approval"]["status"]>>;
const INFO = {
  client: "flightdeck-app",
  address: "100.64.0.7",
  enrolledAt: "2026-11-20T12:00:00.000Z",
};
const ENROLLED: Status = {
  protectionOff: false,
  keys: [{ ...INFO, keyId: "k1", name: "Ana's phone" }],
  thisKeyId: "k1",
};
/** Protection is on and this device has no key: it is the new one. */
const NEW_HERE: Status = { ...ENROLLED, thisKeyId: null };
/** The new device after it made its key: the host does not list it yet. */
const WAITING: Status = { ...ENROLLED, thisKeyId: "k2" };
/** The host lists it now. */
const ADDED: Status = {
  ...ENROLLED,
  keys: [...ENROLLED.keys, { ...INFO, keyId: "k2", name: "Laptop" }],
  thisKeyId: "k2",
};
const OFFER = {
  name: "Laptop",
  publicKey: "pk",
  fingerprint: "3f2a-91bc-07de-44a1",
  host: "daemon-1",
};

function panel(
  statuses: Status[],
  opts: {
    language?: "en" | "pt-BR";
    readFails?: Error;
    confirm?: "done" | "declined" | Error;
  } = {},
) {
  const store = new AppStore(memoryPlatform(false, opts.language ?? "en").platform, {
    baseDelayMs: 600_000,
  });
  store.i18n.start();
  const calls: string[] = [];
  let read = 0;
  const slice = store.approval as unknown as Record<string, unknown>;
  slice.status = async () => statuses[Math.min(read++, statuses.length - 1)];
  slice.requestAdd = async (_id: string, name: string) => {
    calls.push(`requestAdd:${name}`);
    return { text: "flightdeck-add:abc", fingerprint: OFFER.fingerprint };
  };
  slice.readAdd = async (_id: string, text: string) => {
    calls.push(`readAdd:${text}`);
    if (opts.readFails) throw opts.readFails;
    return OFFER;
  };
  slice.confirmAdd = async (_id: string, offer: typeof OFFER) => {
    calls.push(`confirmAdd:${offer.publicKey}`);
    if (opts.confirm instanceof Error) throw opts.confirm;
    return opts.confirm ?? "done";
  };
  slice.removeLocalKey = async () => {
    calls.push("removeLocal");
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
  return { calls, show: (id: string) => shown.rerender(ui(id)) };
}

const press = async (name: string) => {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
};
const type = (label: string, value: string) => {
  const field = screen.queryByLabelText(label);
  expect(field).not.toBeNull();
  fireEvent.change(field as HTMLElement, { target: { value } });
};
const ready = (text: RegExp | string) => settle(() => screen.queryByText(text) !== null);

describe("adding a device: the enrolled device's side (#3478)", () => {
  test("a pasted text is read and shows the name, the code and the host before anything is signed", async () => {
    const { calls } = panel([ENROLLED]);
    await settle(() => screen.queryByLabelText("Text from the new device") !== null);
    expect((screen.queryByRole("button", { name: "Read" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    type("Text from the new device", " flightdeck-add:abc ");
    await press("Read");
    await ready("3f2a-91bc-07de-44a1");
    expect(calls).toEqual(["readAdd:flightdeck-add:abc"]);
    expect(screen.queryByText(/Laptop/)).not.toBeNull();
    expect(screen.queryByText(/daemon-1/)).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Add this device" })).not.toBeNull();
  });

  test("agreeing signs and sends the add, and the panel says it was added", async () => {
    const { calls } = panel([ENROLLED, ADDED]);
    await settle(() => screen.queryByLabelText("Text from the new device") !== null);
    type("Text from the new device", "flightdeck-add:abc");
    await press("Read");
    await ready("3f2a-91bc-07de-44a1");
    await press("Add this device");
    await ready("The device was added.");
    expect(calls).toEqual(["readAdd:flightdeck-add:abc", "confirmAdd:pk"]);
    expect(screen.queryByRole("button", { name: "Add this device" })).toBeNull();
    expect(screen.queryByText("3f2a-91bc-07de-44a1")).toBeNull();
  });

  test("a text that cannot be added says why, as an alert, and offers nothing to sign", async () => {
    const { calls } = panel([ENROLLED], {
      readFails: new Error("That device is already enrolled on this host."),
    });
    await settle(() => screen.queryByLabelText("Text from the new device") !== null);
    type("Text from the new device", "nope");
    await press("Read");
    await settle(() => screen.queryByRole("alert") !== null);
    expect(screen.queryByRole("alert")?.textContent).toBe(
      "That device is already enrolled on this host.",
    );
    expect(screen.queryByRole("button", { name: "Add this device" })).toBeNull();
    expect(calls).toEqual(["readAdd:nope"]);
  });

  test("a declined dialog says nothing was changed, not that the device was added", async () => {
    panel([ENROLLED], { confirm: "declined" });
    await settle(() => screen.queryByLabelText("Text from the new device") !== null);
    type("Text from the new device", "flightdeck-add:abc");
    await press("Read");
    await ready("3f2a-91bc-07de-44a1");
    await press("Add this device");
    await ready("Nothing was changed.");
    expect(screen.queryByText("The device was added.")).toBeNull();
  });

  test("a refusal of the host is an alert and the offer stays, to try again", async () => {
    const { calls } = panel([ENROLLED], { confirm: new Error("The proof expired.") });
    await settle(() => screen.queryByLabelText("Text from the new device") !== null);
    type("Text from the new device", "flightdeck-add:abc");
    await press("Read");
    await ready("3f2a-91bc-07de-44a1");
    await press("Add this device");
    await settle(() => screen.queryByRole("alert") !== null);
    expect(screen.queryByRole("alert")?.textContent).toBe("The proof expired.");
    expect(screen.queryByRole("button", { name: "Add this device" })).not.toBeNull();
    expect(calls.filter((c) => c.startsWith("confirmAdd"))).toHaveLength(1);
  });

  test("cancelling drops the offer and signs nothing", async () => {
    const { calls } = panel([ENROLLED]);
    await settle(() => screen.queryByLabelText("Text from the new device") !== null);
    type("Text from the new device", "flightdeck-add:abc");
    await press("Read");
    await ready("3f2a-91bc-07de-44a1");
    await press("Cancel");
    expect(screen.queryByText("3f2a-91bc-07de-44a1")).toBeNull();
    expect(calls).toEqual(["readAdd:flightdeck-add:abc"]);
  });

  test("moving to another host drops what was read", async () => {
    const { show } = panel([ENROLLED]);
    await settle(() => screen.queryByLabelText("Text from the new device") !== null);
    type("Text from the new device", "flightdeck-add:abc");
    await press("Read");
    await ready("3f2a-91bc-07de-44a1");
    show("h2");
    await settle(() => screen.queryByText("3f2a-91bc-07de-44a1") === null);
    expect(screen.queryByText("3f2a-91bc-07de-44a1")).toBeNull();
  });
});

describe("adding a device: the new device's side (#3478)", () => {
  test("a device with no key makes the text, shows it with its code, and says it is waiting", async () => {
    const { calls } = panel([NEW_HERE, WAITING]);
    await settle(() => screen.queryByLabelText("Name of this device") !== null);
    expect(
      (screen.queryByRole("button", { name: "Show the text" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    type("Name of this device", "  Laptop ");
    await press("Show the text");
    await settle(() => screen.queryByLabelText("Text for the enrolled device") !== null);
    expect(calls).toEqual(["requestAdd:Laptop"]);
    expect(
      (screen.queryByLabelText("Text for the enrolled device") as HTMLInputElement).value,
    ).toBe("flightdeck-add:abc");
    expect(screen.queryByText(/3f2a-91bc-07de-44a1/)).not.toBeNull();
    expect(screen.queryByText(/Waiting for the other device/)).not.toBeNull();
  });

  test("once the host lists this device the text goes and the panel says it is enrolled", async () => {
    panel([NEW_HERE, WAITING, ADDED]);
    await settle(() => screen.queryByLabelText("Name of this device") !== null);
    type("Name of this device", "Laptop");
    await press("Show the text");
    await settle(() => screen.queryByLabelText("Text for the enrolled device") !== null);
    await press("Check again");
    await ready("This device is enrolled.");
    expect(screen.queryByLabelText("Text for the enrolled device")).toBeNull();
  });

  test("a check that finds the device still not listed says so, and the text stays", async () => {
    panel([NEW_HERE, WAITING, WAITING]);
    await settle(() => screen.queryByLabelText("Name of this device") !== null);
    type("Name of this device", "Laptop");
    await press("Show the text");
    await settle(() => screen.queryByLabelText("Text for the enrolled device") !== null);
    expect(screen.queryByText("This device is not listed yet.")).toBeNull();
    await press("Check again");
    await settleMaybe(() => screen.queryByText("This device is not listed yet.") !== null);
    expect(screen.queryByText("This device is not listed yet.")).not.toBeNull();
    expect(screen.queryByLabelText("Text for the enrolled device")).not.toBeNull();
  });

  test("the not-listed-yet line is Portuguese in Portuguese", async () => {
    panel([NEW_HERE, WAITING, WAITING], { language: "pt-BR" });
    await settle(() => screen.queryByLabelText("Nome deste dispositivo") !== null);
    type("Nome deste dispositivo", "Laptop");
    await press("Mostrar o texto");
    await settle(() => screen.queryByLabelText("Texto para o dispositivo já cadastrado") !== null);
    await press("Verificar de novo");
    await settleMaybe(
      () => screen.queryByText("Este dispositivo ainda não está na lista.") !== null,
    );
    expect(screen.queryByText("Este dispositivo ainda não está na lista.")).not.toBeNull();
  });

  test("cancelling removes this device's key and the text", async () => {
    const { calls } = panel([NEW_HERE, WAITING, NEW_HERE]);
    await settle(() => screen.queryByLabelText("Name of this device") !== null);
    type("Name of this device", "Laptop");
    await press("Show the text");
    await settle(() => screen.queryByLabelText("Text for the enrolled device") !== null);
    await press("Cancel");
    await settle(() => screen.queryByLabelText("Text for the enrolled device") === null);
    expect(calls).toEqual(["requestAdd:Laptop", "removeLocal"]);
  });
});

describe("adding a device: review findings (#3478)", () => {
  test("a device waiting to be added cannot revoke the others, and has one way to drop its key", async () => {
    panel([NEW_HERE, WAITING]);
    await settle(() => screen.queryByLabelText("Name of this device") !== null);
    type("Name of this device", "Laptop");
    await press("Show the text");
    await settle(() => screen.queryByLabelText("Text for the enrolled device") !== null);
    expect(screen.queryByRole("button", { name: /^Revoke/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove this device's key" })).toBeNull();
  });

  test("the pasted text is emptied once the device was added", async () => {
    panel([ENROLLED, ADDED]);
    await settle(() => screen.queryByLabelText("Text from the new device") !== null);
    type("Text from the new device", "flightdeck-add:abc");
    await press("Read");
    await ready("3f2a-91bc-07de-44a1");
    await press("Add this device");
    await ready("The device was added.");
    expect((screen.queryByLabelText("Text from the new device") as HTMLInputElement).value).toBe(
      "",
    );
  });

  test("focus moves to the new part when the form is swapped, so a keyboard person is not sent to the top", async () => {
    panel([ENROLLED]);
    await settle(() => screen.queryByLabelText("Text from the new device") !== null);
    type("Text from the new device", "flightdeck-add:abc");
    await press("Read");
    await ready("3f2a-91bc-07de-44a1");
    const inside = screen.queryByRole("button", { name: "Add this device" }) as HTMLElement;
    expect(inside.closest("[data-add-box]")?.contains(document.activeElement)).toBe(true);
  });
});

describe("adding a device in Portuguese (#3478)", () => {
  test("both roles speak Portuguese", async () => {
    panel([ENROLLED], { language: "pt-BR" });
    await settle(() => screen.queryByLabelText("Texto do novo dispositivo") !== null);
    expect(screen.queryByRole("button", { name: "Ler" })).not.toBeNull();
    cleanup();
    panel([NEW_HERE], { language: "pt-BR" });
    await settle(() => screen.queryByRole("button", { name: "Mostrar o texto" }) !== null);
    expect(screen.queryByRole("button", { name: "Mostrar o texto" })).not.toBeNull();
  });
});
