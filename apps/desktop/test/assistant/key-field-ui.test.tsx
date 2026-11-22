import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { fakeAssistant, memoryPlatform } from "../fixtures.ts";
import { waiter } from "../wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { KeyField } = await import("../../src/features/assistant/key-field.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);
const settle = waiter(5000);

/** An obviously fake key: no test here ever holds a real one. */
const FAKE_KEY = "sk-ant-aaaabbbb";

/** A call the test lets finish when it chooses. */
function gate() {
  let open: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { done, open };
}

async function mount(script: Parameters<typeof fakeAssistant>[0] = {}, saved = true) {
  const mem = memoryPlatform(false, "en");
  const fake = fakeAssistant(script);
  if (saved) await fake.assistant.setKey("anthropic", FAKE_KEY);
  fake.calls.length = 0;
  mem.platform.assistant = fake.assistant;
  const store = new AppStore(mem.platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  render(<KeyField store={store} t={store.i18n.t} provider="anthropic" name="Anthropic" />);
  return { fake, store };
}

const click = (el: HTMLElement | null) =>
  act(async () => {
    if (el) fireEvent.click(el);
  });
const button = (name: string | RegExp) => screen.queryByRole("button", { name });
const field = () => screen.queryByLabelText("Anthropic key") as HTMLInputElement | null;
const typeKey = (value: string) =>
  act(async () => {
    fireEvent.change(field() as HTMLInputElement, { target: { value } });
  });
const submit = () =>
  act(async () => {
    const form = field()?.closest("form");
    if (form) fireEvent.submit(form);
  });
/**
 * A call nobody catches escapes as an unhandled rejection, which would end a red test by an error
 * instead of its assertion: what must hold is what the person sees.
 */
async function uncaught(run: () => Promise<void>): Promise<void> {
  const ignore = () => {};
  process.on("unhandledRejection", ignore);
  try {
    await run();
  } finally {
    process.off("unhandledRejection", ignore);
  }
}

/** Whether the element is the one with the focus: a boolean, so a failed check never prints a DOM node. */
const focused = (el: Element | null) => el !== null && document.activeElement === el;

describe("key-field-ui: saving", () => {
  test("Enter in the field saves once; an empty field saves nothing", async () => {
    const hold = gate();
    const { fake } = await mount({ setKey: () => hold.done }, false);
    await settle(() => field() !== null);
    await submit();
    expect(fake.calls.filter((c) => c[0] === "setKey")).toEqual([]);
    await typeKey(FAKE_KEY);
    await submit();
    await submit();
    expect(fake.calls.filter((c) => c[0] === "setKey")).toEqual([["setKey", "anthropic"]]);
    hold.open();
    await settle(() => document.body.textContent?.includes("Key saved · …bbbb") === true);
  });

  test("the button says Saving… while the key is being stored", async () => {
    const hold = gate();
    await mount({ setKey: () => hold.done }, false);
    await settle(() => field() !== null);
    await typeKey(FAKE_KEY);
    await click(button("Save key"));
    const saving = button("Saving…");
    expect(saving?.hasAttribute("disabled")).toBe(true);
    hold.open();
    await settle(() => button("Replace") !== null);
    expect(document.body.innerHTML).not.toContain(FAKE_KEY);
  });
});

describe("key-field-ui: testing", () => {
  test("the old result goes at once and the button says Testing… until the new one comes", async () => {
    const hold = gate();
    let n = 0;
    await mount({
      test: async () => {
        if (n++ === 0) return { ok: true };
        await hold.done;
        return { ok: false, detail: "assistant_auth" };
      },
    });
    await settle(() => button("Test") !== null);
    await click(button("Test"));
    await settle(() => screen.queryByRole("status")?.textContent === "The key works.");
    await click(button("Test"));
    expect(screen.queryByRole("status")).toBeNull();
    expect(button("Testing…")?.hasAttribute("disabled")).toBe(true);
    hold.open();
    await settle(() => screen.queryByRole("status") !== null);
    expect(screen.queryByRole("status")?.textContent).toBe(
      "The provider refused the key. Check it in Settings, Assistant.",
    );
  });

  test("a failure that carries no reason of ours does not say the key was refused", async () => {
    await mount({ test: async () => ({ ok: false, detail: "HTTP 500" }) });
    await settle(() => button("Test") !== null);
    await click(button("Test"));
    await settle(() => screen.queryByRole("status") !== null);
    expect(screen.queryByRole("status")?.textContent).toBe("The key could not be tested.");
  });
});

describe("key-field-ui: removing", () => {
  test("the button says Removing… while the key goes", async () => {
    const hold = gate();
    await mount({ deleteKey: () => hold.done });
    await settle(() => button("Remove") !== null);
    await click(button("Remove"));
    await click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Remove" }));
    expect(button("Removing…")?.hasAttribute("disabled")).toBe(true);
    hold.open();
    await settle(() => field() !== null);
  });

  test("a key that cannot be removed says so and stays saved", async () => {
    await uncaught(async () => {
      await mount({
        deleteKey: () => {
          throw { reason: "assistant_key_store" };
        },
      });
      await settle(() => button("Remove") !== null);
      await click(button("Remove"));
      await click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Remove" }));
      await settle(() => screen.queryByRole("alert") !== null);
      expect(screen.queryByRole("alert")).not.toBeNull();
      expect(screen.queryByRole("alert")?.textContent).toContain(
        "The system's credential store could not be reached.",
      );
      expect(document.body.textContent).toContain("Key saved · …bbbb");
    });
  });
});

describe("key-field-ui: the focus follows the button that went away", () => {
  test("Replace moves it to the key field, and Cancel gives it back to Replace", async () => {
    await mount();
    await settle(() => button("Replace") !== null);
    await click(button("Replace"));
    expect(focused(field())).toBe(true);
    await click(button("Cancel"));
    expect(focused(button("Replace"))).toBe(true);
  });

  test("Save moves it to Replace", async () => {
    await mount();
    await settle(() => button("Replace") !== null);
    await click(button("Replace"));
    await typeKey("sk-ant-ccccdddd");
    await click(button("Save key"));
    await settle(() => document.body.textContent?.includes("Key saved · …dddd") === true);
    expect(focused(button("Replace"))).toBe(true);
  });

  test("Remove moves it to the key field", async () => {
    await mount();
    await settle(() => button("Remove") !== null);
    await click(button("Remove"));
    await click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Remove" }));
    await settle(() => field() !== null);
    expect(focused(field())).toBe(true);
  });
});

describe("key-field-ui: a status that cannot be read", () => {
  test("says why and offers Try again, which reads the status again", async () => {
    await uncaught(async () => {
      let attempts = 0;
      await mount({
        keyStatus: () => {
          attempts++;
          if (attempts === 1) throw { reason: "assistant_key_store" };
        },
      });
      await settle(() => screen.queryByRole("alert") !== null);
      expect(screen.queryByRole("alert")).not.toBeNull();
      expect(screen.queryByRole("alert")?.textContent).toContain(
        "The system's credential store could not be reached.",
      );
      await click(button("Try again"));
      await settle(() => document.body.textContent?.includes("Key saved · …bbbb") === true);
      expect(screen.queryByRole("alert")).toBeNull();
    });
  });
});

describe("key-field-ui: what the person was told stays true", () => {
  /**
   * The store reads both providers after a save (two calls); the field's own read is the third one
   * after the person pressed Save. `onFieldRead` is what that third read does.
   */
  async function mountThenSave(onFieldRead: () => void | Promise<void>) {
    let armed = false;
    let readsAfterSave = 0;
    await mount({
      keyStatus: () => {
        if (armed && ++readsAfterSave === 3) return onFieldRead();
      },
    });
    await settle(() => button("Replace") !== null);
    armed = true;
    await click(button("Replace"));
    await typeKey("sk-ant-ccccdddd");
    await click(button("Save key"));
  }

  test("the focus reaches Replace even when the status is slow to read again", async () => {
    const hold = gate();
    let reading = false;
    await mountThenSave(() => {
      reading = true;
      return hold.done;
    });
    await settle(() => reading);
    hold.open();
    await settle(() => document.body.textContent?.includes("Key saved · …dddd") === true);
    expect(focused(button("Replace"))).toBe(true);
  });

  test("a key stored but not read back does not leave the old one on screen", async () => {
    await uncaught(async () => {
      await mountThenSave(() => {
        throw { reason: "assistant_key_store" };
      });
      await settle(() => button("Try again") !== null);
      expect(document.body.textContent).not.toContain("Key saved · …bbbb");
      expect(field()).toBeNull();
      await click(button("Try again"));
      await settle(() => document.body.textContent?.includes("Key saved · …dddd") === true);
    });
  });

  test("a failed removal is not repeated once the person moves on to Replace or Test", async () => {
    await uncaught(async () => {
      await mount({
        deleteKey: () => {
          throw { reason: "assistant_key_store" };
        },
      });
      await settle(() => button("Remove") !== null);
      const remove = async () => {
        await click(button("Remove"));
        await click(
          within(screen.getByRole("alertdialog")).getByRole("button", { name: "Remove" }),
        );
        await settle(() => screen.queryByRole("alert") !== null);
      };
      await remove();
      await click(button("Test"));
      await settle(() => screen.queryByRole("status") !== null);
      expect(screen.queryByRole("alert")).toBeNull();
      await remove();
      await click(button("Replace"));
      expect(screen.queryByRole("alert")).toBeNull();
    });
  });
});
