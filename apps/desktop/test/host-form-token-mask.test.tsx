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

  test("backspacing a dot, typing inside them or after them still keeps the real token", async () => {
    const { submitted } = setup();
    await paste(LINK);
    for (const edited of ["token=•••", "token=••a••", "token=••••x"]) {
      await paste(`flightdeck://127.0.0.1:46507?name=alfa&${edited}`);
    }
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Test and add" }));
    });
    expect([tokenField()?.value, submitted]).toEqual([
      SECRET,
      [{ name: "alfa", address: "127.0.0.1", port: "46507", token: SECRET }],
    ]);
  });

  test("a dotted link pasted with no real token held says the link has no token", async () => {
    setup();
    await paste("flightdeck://127.0.0.1:46507?name=alfa&token=••••");
    expect([
      screen.queryByText("The link has no token.") !== null,
      tokenField()?.value ?? null,
    ]).toEqual([true, ""]);
  });

  test("the dotted link edited to another address does not carry the token there", async () => {
    setup();
    await paste(LINK);
    await paste("flightdeck://10.0.0.9:46507?name=alfa&token=••••");
    expect([
      screen.queryByText("The token is not carried to another address: paste that host's link.") !==
        null,
      tokenField()?.value,
      (document.body.textContent ?? "").includes(SECRET),
    ]).toEqual([true, SECRET, false]);
  });

  test("typing the link by hand, one character at a time, keeps the whole token", async () => {
    const { submitted } = setup();
    const typed = "flightdeck://127.0.0.1:46507?name=alfa&token=abc";
    for (let i = typed.length - 12; i <= typed.length; i++) await paste(typed.slice(0, i));
    const during = linkField()?.value;
    await act(async () => {
      if (linkField()) fireEvent.blur(linkField() as HTMLElement);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Test and add" }));
    });
    expect([during, linkField()?.value, tokenField()?.value, submitted]).toEqual([
      typed,
      "flightdeck://127.0.0.1:46507?name=alfa&token=••••",
      "abc",
      [{ name: "alfa", address: "127.0.0.1", port: "46507", token: "abc" }],
    ]);
  });

  test("a pasted link with a real token and a bad part shows no token, and fixing the part keeps it", async () => {
    const { submitted } = setup();
    await paste("flightdeck://127.0.0.1:abc?name=alfa&token=SECRET");
    const shown = linkField()?.value;
    const refused = screen.queryByText("The link's port is not valid.") !== null;
    await paste("flightdeck://127.0.0.1:46507?name=alfa&token=••••");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Test and add" }));
    });
    expect([
      shown,
      refused,
      (document.body.textContent ?? "").includes("SECRET"),
      submitted,
    ]).toEqual([
      "flightdeck://127.0.0.1:abc?name=alfa&token=••••",
      true,
      false,
      [{ name: "alfa", address: "127.0.0.1", port: "46507", token: "SECRET" }],
    ]);
  });

  test("taking the token out of the link takes it out of the form too", async () => {
    setup();
    await paste(LINK);
    await paste("flightdeck://127.0.0.1:46507?name=alfa");
    expect([screen.queryByText("The link has no token.") !== null, tokenField()?.value]).toEqual([
      true,
      "",
    ]);
  });
});
