import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { TContext } = await import("../src/i18n/context.tsx");
const { HostForm } = await import("../src/ui/HostForm.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

const SECRET = "s3cret-token-0123456789";
const LINK = `flightdeck://127.0.0.1:46507?name=alfa&token=${SECRET}`;

function setup() {
  const store = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  const submitted: unknown[] = [];
  render(
    <TContext.Provider value={store.i18n.t}>
      <HostForm onSubmit={(draft) => submitted.push(draft)} />
    </TContext.Provider>,
  );
  return { submitted };
}

const linkField = () => screen.queryByLabelText("Pairing link") as HTMLInputElement | null;
const tokenField = () => screen.queryByLabelText("Token") as HTMLInputElement | null;
const paste = (value: string) =>
  act(async () => {
    const field = linkField();
    if (field) fireEvent.change(field, { target: { value } });
  });

/** #1548: the pasted link shows its token as dots, as the Token field does. */
describe("host-form: the pasted pairing link hides its token (#1548)", () => {
  test("once the link is read, the field shows it with the token as dots, and the secret is nowhere in the page", async () => {
    setup();
    await paste(LINK);
    const shown = linkField()?.value ?? "";
    expect([
      shown,
      // The Token field (a password input) holds it; nothing else on the page, in text or in the link field.
      (document.body.textContent ?? "").includes(SECRET) || shown.includes(SECRET),
      tokenField()?.type,
      tokenField()?.value,
    ]).toEqual(["flightdeck://127.0.0.1:46507?name=alfa&token=••••", false, "password", SECRET]);
  });

  test("the form still adds the host with the real token", async () => {
    const { submitted } = setup();
    await paste(LINK);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Test and add" }));
    });
    expect(submitted).toEqual([
      { name: "alfa", address: "127.0.0.1", port: "46507", token: SECRET },
    ]);
  });

  test("editing the masked link keeps the real token: the dots are not taken for it", async () => {
    const { submitted } = setup();
    await paste(LINK);
    await paste("flightdeck://127.0.0.1:46507?name=beta&token=••••");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Test and add" }));
    });
    expect([linkField()?.value, submitted]).toEqual([
      "flightdeck://127.0.0.1:46507?name=beta&token=••••",
      [{ name: "beta", address: "127.0.0.1", port: "46507", token: SECRET }],
    ]);
  });

  test("a link that is not read yet stays as typed, and says why", async () => {
    setup();
    await paste("flightdeck://127.0.0.1:46507?name=alfa");
    expect([linkField()?.value, screen.queryByText("The link has no token.") !== null]).toEqual([
      "flightdeck://127.0.0.1:46507?name=alfa",
      true,
    ]);
  });
});
