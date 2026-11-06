import { afterEach, describe, expect, test } from "bun:test";
import { registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
const { cleanup, render, screen } = await import("@testing-library/react");
const { PersonaSwitch } = await import("../src/components/personas/persona-switch.tsx");
const { AppStore } = await import("../src/lib/app-store.ts");
const { TContext } = await import("../src/i18n/context.tsx");

afterEach(cleanup);

// Issue #183 (B10 rest): the session's one persona control says which persona is on, none
// included, so the header reads as the session's state, not as an action.
describe("persona-button: the session's Persona button names the persona it is in", () => {
  const view = (current: { id: string; name: string } | null) => {
    const store = new AppStore(memoryPlatform(false, "en").platform);
    render(
      <TContext.Provider value={store.i18n.t}>
        <PersonaSwitch
          store={store}
          hostId="h"
          target={{ sessionId: "s" }}
          current={current as never}
        />
      </TContext.Provider>,
    );
    return store.i18n.t;
  };

  test("with no persona, the button says Persona: None", () => {
    const t = view(null);
    const name = `${t("personas.apply.trigger")}: ${t("personas.apply.none")}`;
    expect(screen.queryByRole("button", { name })).not.toBeNull();
  });

  test("with one, it names it", () => {
    const t = view({ id: "qa", name: "QA" });
    expect(
      screen.queryByRole("button", { name: `${t("personas.apply.trigger")}: QA` }),
    ).not.toBeNull();
  });
});
