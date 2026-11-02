import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { WebhookSender } from "../../daemon/src/webhook/sender.ts";
import { registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";
import { legacyDaemon } from "./legacy-daemon.ts";
import { waiter } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, screen, within } = await import("@testing-library/react");
const { AppStore } = await import("../src/lib/app-store.ts");
const { WebhooksSection } = await import("../src/ui/WebhooksSection.tsx");
const { TContext } = await import("../src/i18n/context.tsx");

setDefaultTimeout(20_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const settle = waiter(4000);
const SECRET = "https://hooks.slack.com/services/T000/B000/XXXXSECRETXXXX";

async function open(language = "pt-BR", options: { legacy?: boolean } = {}) {
  const mem = memoryPlatform(false, language);
  const store = new AppStore(mem.platform, { baseDelayMs: 60_000 });
  store.i18n.start();
  const sent: string[] = [];
  const server = options.legacy
    ? legacyDaemon(cleanups)
    : makeDaemon(cleanups, {
        webhook: new WebhookSender({
          resolve: async (host) => (host.startsWith("internal") ? ["10.0.0.1"] : ["93.184.216.34"]),
          fetch: (async (url: string) => {
            sent.push(url);
            return new Response("", { status: 200 });
          }) as never,
        }),
      }).listen();
  await act(async () => {
    await store.addHost({ name: "alfa", url: server.url, token: TOKEN });
  });
  await settle(() => store.getState().hosts[0]?.hostInfo !== null || options.legacy === true);
  await settle(() => store.getState().hosts[0]?.status === "online");
  render(
    <TContext.Provider value={store.i18n.t}>
      <WebhooksSection store={store} />
    </TContext.Provider>,
  );
  return { store, mem, sent };
}

const fill = async (label: string | RegExp, value: string) => {
  await act(async () => {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  });
};
const click = async (name: string | RegExp) => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
};

async function addSlack(name = "Team", url = SECRET) {
  await fill("Nome", name);
  await fill("URL do webhook", url);
  await act(async () => {
    fireEvent.click(screen.getByRole("checkbox", { name: "Precisa de você" }));
  });
  await click("Salvar webhook");
}

describe("webhook-ui", () => {
  test("it explains that webhooks go out only while the app runs, in both languages", async () => {
    await open("pt-BR");
    expect(screen.getByRole("heading", { name: "Webhooks" })).not.toBeNull();
    expect(
      screen.queryByText("Os webhooks só são enviados enquanto este app estiver aberto."),
    ).not.toBeNull();
    expect(screen.queryByText("Nenhum webhook ainda.")).not.toBeNull();
    cleanup();
    await open("en");
    expect(screen.queryByText("Webhooks are sent only while this app is running.")).not.toBeNull();
    expect(screen.queryByText("No webhook yet.")).not.toBeNull();
  });

  test("without an online host that can post it says messages wait", async () => {
    await open("en", { legacy: true });
    expect(
      screen.queryByText("No online host can post right now. Messages wait and are retried."),
    ).not.toBeNull();
    cleanup();
    await open("en");
    expect(
      screen.queryByText("No online host can post right now. Messages wait and are retried."),
    ).toBeNull();
  });

  test("a webhook is added with its events and shown by name and host only, never its URL", async () => {
    const { store } = await open();
    await addSlack();
    await settle(() => screen.queryByText("Team") !== null);
    expect(screen.queryByText("envia para hooks.slack.com")).not.toBeNull();
    expect(screen.queryByText("ainda não usado")).not.toBeNull();
    expect(document.body.textContent).not.toContain("XXXXSECRETXXXX");
    expect(store.webhooks.targets.list()).toHaveLength(1);
    // The form is cleared for the next one.
    expect((screen.getByLabelText("Nome") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("URL do webhook") as HTMLInputElement).type).toBe("password");
  });

  test("the form says what is missing and what is wrong with the address", async () => {
    await open("en");
    expect(screen.queryByText("Give it a name, a URL and at least one event.")).not.toBeNull();
    expect(
      (screen.getByRole("button", { name: "Save webhook" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await fill("Name", "Plain");
    await fill("Webhook URL", "http://example.com/h");
    await act(async () => {
      fireEvent.click(screen.getByRole("checkbox", { name: "Needs you" }));
    });
    await click("Save webhook");
    await settle(
      () =>
        screen.queryByText("Use an https:// URL (http:// only works for this machine).") !== null,
    );
    expect(screen.queryByText("Plain")).toBeNull();
  });

  test("Test sends a sample and shows the status and the time; a refused address shows the failure", async () => {
    const { sent } = await open("en");
    await fill("Name", "Team");
    await fill("Webhook URL", SECRET);
    await act(async () => {
      fireEvent.click(screen.getByRole("checkbox", { name: "Needs you" }));
    });
    await click("Save webhook");
    await settle(() => screen.queryByRole("button", { name: "Test Team" }) !== null);
    await click("Test Team");
    await settle(() => screen.queryByText(/^Sent: HTTP 200 at /) !== null);
    expect(sent).toEqual([SECRET]);
    expect(screen.queryByText("working")).not.toBeNull();
    await fill("Name", "Inside");
    await fill("Webhook URL", "https://internal.example/hook");
    await act(async () => {
      fireEvent.click(screen.getByRole("checkbox", { name: "Needs you" }));
    });
    await click("Save webhook");
    await settle(() => screen.queryByRole("button", { name: "Test Inside" }) !== null);
    await click("Test Inside");
    await settle(() => screen.queryByText(/^Failed: 400 at /) !== null);
    expect(screen.queryByText("failing")).not.toBeNull();
  });

  test("a webhook can be disabled and enabled again", async () => {
    const { store } = await open("en");
    await fill("Name", "Team");
    await fill("Webhook URL", SECRET);
    await act(async () => {
      fireEvent.click(screen.getByRole("checkbox", { name: "Needs you" }));
    });
    await click("Save webhook");
    await settle(() => screen.queryByRole("button", { name: "Disable Team" }) !== null);
    await click("Disable Team");
    await settle(() => screen.queryByRole("button", { name: "Enable Team" }) !== null);
    expect(screen.queryByText("disabled")).not.toBeNull();
    expect(store.webhooks.targets.list()[0]?.enabled).toBe(false);
    await click("Enable Team");
    await settle(() => screen.queryByRole("button", { name: "Disable Team" }) !== null);
  });

  test("Edit changes the name and the events and keeps the URL when its field is left empty", async () => {
    const { store } = await open("en");
    await fill("Name", "Team");
    await fill("Webhook URL", SECRET);
    await act(async () => {
      fireEvent.click(screen.getByRole("checkbox", { name: "Needs you" }));
    });
    await click("Save webhook");
    await settle(() => screen.queryByRole("button", { name: "Edit Team" }) !== null);
    await click("Edit Team");
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Team");
    expect((screen.getByLabelText("Webhook URL") as HTMLInputElement).value).toBe("");
    await fill("Name", "Ops");
    await act(async () => {
      fireEvent.click(screen.getByRole("checkbox", { name: "Budget alert" }));
    });
    await click("Save changes");
    await settle(() => screen.queryByText("Ops") !== null);
    const [target] = store.webhooks.targets.list();
    expect(target).toMatchObject({ name: "Ops", kinds: ["needs_you", "budget_alert"] });
    expect(await store.webhooks.targets.secrets(target?.id as string)).toMatchObject({
      url: SECRET,
    });
  });

  test("Remove asks first, then deletes the webhook and its secret", async () => {
    const { store } = await open("en");
    await fill("Name", "Team");
    await fill("Webhook URL", SECRET);
    await act(async () => {
      fireEvent.click(screen.getByRole("checkbox", { name: "Needs you" }));
    });
    await click("Save webhook");
    await settle(() => screen.queryByRole("button", { name: "Remove Team" }) !== null);
    const id = store.webhooks.targets.list()[0]?.id as string;
    await click("Remove Team");
    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).queryByText("Remove Team? Its URL is deleted from the vault."),
    ).not.toBeNull();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    });
    await settle(() => screen.queryByText("Team") === null);
    expect(store.webhooks.targets.list()).toEqual([]);
    expect(await store.webhooks.targets.secrets(id)).toBeNull();
  });

  test("the hosts scope offers all hosts or one host", async () => {
    const { store } = await open("en");
    const select = screen.getByLabelText("Hosts") as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(["All hosts", "alfa"]);
    await fill("Name", "Team");
    await fill("Webhook URL", SECRET);
    await act(async () => {
      fireEvent.change(select, { target: { value: store.getState().hosts[0]?.id } });
      fireEvent.click(screen.getByRole("checkbox", { name: "Needs you" }));
    });
    await click("Save webhook");
    await settle(() => store.webhooks.targets.list().length === 1);
    expect(store.webhooks.targets.list()[0]?.hostScope).toBe(
      store.getState().hosts[0]?.id as string,
    );
  });

  test("a generic webhook asks for a signing secret, an event can be unchecked and Cancel leaves the edit", async () => {
    const { store } = await open("en");
    expect(screen.queryByLabelText("Signing secret")).toBeNull();
    await fill("Name", "Hook");
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Type"), { target: { value: "generic" } });
    });
    await fill("Signing secret", "s3cret");
    await fill("Webhook URL", "https://example.com/in");
    await act(async () => {
      fireEvent.click(screen.getByRole("checkbox", { name: "Needs you" }));
      fireEvent.click(screen.getByRole("checkbox", { name: "Budget alert" }));
      fireEvent.click(screen.getByRole("checkbox", { name: "Budget alert" }));
    });
    await click("Save webhook");
    await settle(() => store.webhooks.targets.list().length === 1);
    const [target] = store.webhooks.targets.list();
    expect(target).toMatchObject({ type: "generic", kinds: ["needs_you"] });
    expect(await store.webhooks.targets.secrets(target?.id as string)).toEqual({
      url: "https://example.com/in",
      signingSecret: "s3cret",
    });
    await click("Edit Hook");
    await click("Cancel");
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("");
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
  });

  test("Cancel in the remove question keeps the webhook", async () => {
    const { store } = await open("en");
    await fill("Name", "Team");
    await fill("Webhook URL", SECRET);
    await act(async () => {
      fireEvent.click(screen.getByRole("checkbox", { name: "Needs you" }));
    });
    await click("Save webhook");
    await settle(() => screen.queryByRole("button", { name: "Remove Team" }) !== null);
    await click("Remove Team");
    const dialog = await screen.findByRole("alertdialog");
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    });
    await settle(() => screen.queryByRole("alertdialog") === null);
    expect(store.webhooks.targets.list()).toHaveLength(1);
  });
});
