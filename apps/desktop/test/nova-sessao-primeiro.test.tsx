import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { uiIdle } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { NewSessionForm } = await import("../src/ui/NewSessionForm.tsx");
const { TContext } = await import("../src/i18n/context.tsx");
const { translator } = await import("../src/i18n/index.ts");

setDefaultTimeout(30_000);
const stores: Array<{ dispose(): unknown }> = [];
afterEach(() => {
  cleanup();
  for (const store of stores.splice(0)) store.dispose();
});

type FormHost = Parameters<typeof NewSessionForm>[0]["host"];
const hostOf = (roots: string[], allowBypass = false) =>
  ({
    id: "h1",
    name: "pc",
    info: { allowedRoots: roots },
    hostInfo: { allowBypassPermissions: allowBypass },
  }) as unknown as FormHost;

/** The form with a store (which keeps the last choices) and the sessions it creates. */
function open(host: FormHost, before?: (store: InstanceType<typeof AppStore>) => void) {
  const store = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 60_000 });
  stores.push(store);
  before?.(store);
  const created: Array<Record<string, unknown>> = [];
  render(
    <TContext.Provider value={translator("en")}>
      <NewSessionForm
        host={host}
        store={store}
        onCreate={(payload) => void created.push(payload as Record<string, unknown>)}
      />
    </TContext.Provider>,
  );
  return { store, created };
}

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const fill = async (label: string, value: string) => {
  await act(async () => {
    fireEvent.change(field(label), { target: { value } });
  });
  await uiIdle();
};
const press = async (name: string) => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
};
const moreOptions = () => screen.queryByRole("button", { name: "More options" });

// Issue #1135: New session opens with the task, the last choices already made, the rest folded.
describe("nova-sessao-primeiro: the task comes first", () => {
  test("the first prompt is the first field of the form, and has the focus", () => {
    open(hostOf(["/work"]));
    const prompt = field("First prompt");
    expect(document.activeElement === prompt).toBe(true);
    const fields = [...(prompt.closest("form")?.querySelectorAll("textarea, select, input") ?? [])];
    expect(fields[0] === prompt).toBe(true);
  });

  test("a session starts in one step: the task and Create session", async () => {
    const { created } = open(hostOf(["/work"]));
    await fill("First prompt", "fix the login bug");
    await press("Create session");
    expect(created).toEqual([
      { cwd: "/work", prompt: "fix the login bug", permissionMode: "default" },
    ]);
  });

  test("Ctrl+Enter in the task creates the session", async () => {
    const { created } = open(hostOf(["/work"]));
    await fill("First prompt", "go");
    await act(async () => {
      fireEvent.keyDown(field("First prompt"), { key: "Enter", ctrlKey: true });
    });
    expect(created).toHaveLength(1);
    expect(created[0]?.prompt).toBe("go");
  });

  test("Enter alone in the task only adds a line", async () => {
    const { created } = open(hostOf(["/work"]));
    await fill("First prompt", "go");
    await act(async () => {
      fireEvent.keyDown(field("First prompt"), { key: "Enter" });
    });
    expect(created).toEqual([]);
  });
});

describe("nova-sessao-primeiro: the rest is under More options", () => {
  test("the name and the subfolder are folded at first, and More options shows them", async () => {
    open(hostOf(["/work"]));
    const button = moreOptions();
    expect(button).not.toBeNull();
    expect(button?.getAttribute("aria-expanded")).toBe("false");
    expect(field("Name").closest("[hidden]")).not.toBeNull();
    expect(field("Subfolder").closest("[hidden]")).not.toBeNull();
    await press("More options");
    expect(moreOptions()?.getAttribute("aria-expanded")).toBe("true");
    expect(field("Name").closest("[hidden]")).toBeNull();
    expect(field("Subfolder").closest("[hidden]")).toBeNull();
    await press("More options");
    expect(moreOptions()?.getAttribute("aria-expanded")).toBe("false");
    expect(field("Name").closest("[hidden]")).not.toBeNull();
  });

  test("the folder, the permission mode and the model stay in view", () => {
    open(hostOf(["/work"]));
    for (const label of ["Folder", "Permission mode", "Model"]) {
      expect(field(label).closest("[hidden]")).toBeNull();
    }
  });

  test("what was typed under More options is sent even when it is folded again", async () => {
    const { created } = open(hostOf(["/work"]));
    await press("More options");
    await fill("Name", "login");
    await fill("Subfolder", "api");
    await press("More options");
    await fill("First prompt", "go");
    await press("Create session");
    expect(created).toEqual([
      { cwd: "/work/api", prompt: "go", permissionMode: "default", name: "login" },
    ]);
  });
});

describe("nova-sessao-primeiro: the last choices are already made", () => {
  const remembered = (store: InstanceType<typeof AppStore>) =>
    store.newSessionPrefs.remember("h1", {
      root: "/two",
      sub: "api",
      mode: "plan",
      model: "opus",
    });

  test("the folder, mode and model of the last session are chosen, and a subfolder is in view", async () => {
    const { created } = open(hostOf(["/one", "/two"]), remembered);
    expect(field("Folder").value).toBe("/two");
    expect(field("Permission mode").value).toBe("plan");
    expect(field("Model").value).toBe("opus");
    expect(moreOptions()?.getAttribute("aria-expanded")).toBe("true");
    expect(field("Subfolder").value).toBe("api");
    await fill("First prompt", "go");
    await press("Create session");
    expect(created).toEqual([
      { cwd: "/two/api", prompt: "go", permissionMode: "plan", model: "opus" },
    ]);
  });

  test("a folder the host no longer allows is ignored: the first folder is used", () => {
    open(hostOf(["/one"]), remembered);
    expect(field("Folder").value).toBe("/one");
    expect(field("Subfolder").value).toBe("");
    expect(moreOptions()?.getAttribute("aria-expanded")).toBe("false");
  });

  test("another host does not take this host's folder", () => {
    open({ ...hostOf(["/two"]), id: "h9" } as FormHost, remembered);
    expect(field("Subfolder").value).toBe("");
    expect(field("Permission mode").value).toBe("plan");
  });

  test("starting a session remembers its folder, mode and model for the next one", async () => {
    const { store } = open(hostOf(["/one", "/two"]));
    await fill("Folder", "/two");
    await fill("Permission mode", "acceptEdits");
    await fill("Model", "haiku");
    await fill("First prompt", "go");
    await press("Create session");
    expect(store.newSessionPrefs.folderOf("h1")).toEqual({ root: "/two", sub: "" });
    expect(store.newSessionPrefs.value.mode).toBe("acceptEdits");
    expect(store.newSessionPrefs.value.model).toBe("haiku");
  });

  test("an OpenCode session keeps its folder but not its mode: those are Claude's to remember", async () => {
    const withOpenCode = {
      ...hostOf(["/one", "/two"]),
      hostInfo: { runtimes: [{ kind: "opencode", available: true }] },
    } as unknown as FormHost;
    const { store } = open(withOpenCode, (s) =>
      s.newSessionPrefs.remember("h1", {
        root: "/one",
        sub: "",
        mode: "acceptEdits",
        model: "opus",
      }),
    );
    await fill("Agent", "opencode");
    await fill("Folder", "/two");
    await fill("Permission mode", "plan");
    await fill("First prompt", "go");
    await press("Create session");
    expect(store.newSessionPrefs.folderOf("h1")).toEqual({ root: "/two", sub: "" });
    expect(store.newSessionPrefs.value.mode).toBe("acceptEdits");
    expect(store.newSessionPrefs.value.model).toBe("opus");
  });

  test("bypass is never the starting point: it still asks, and the next form is not in it", async () => {
    const { store, created } = open(hostOf(["/work"], true), (s) =>
      s.newSessionPrefs.remember("h1", { root: "/work", sub: "", mode: "plan", model: "" }),
    );
    await fill("Permission mode", "bypassPermissions");
    await fill("First prompt", "go");
    await press("Create session");
    await act(async () => {
      fireEvent.click(
        within(screen.getByRole("alertdialog")).getByRole("button", {
          name: "Start without prompts",
        }),
      );
    });
    expect(created.map((c) => c.permissionMode)).toEqual(["bypassPermissions"]);
    expect(store.newSessionPrefs.value.mode).toBe("plan");
  });
});
