import { afterEach, describe, expect, test } from "bun:test";
import { registerDom } from "./dom.ts";

registerDom();
const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
const { RulesEditor } = await import("../src/components/vault/rules-editor.tsx");
const { MessagingRulesSection } = await import("../src/ui/MessagingRulesSection.tsx");

import type { AppStore } from "../src/lib/app-store.ts";

afterEach(cleanup);

const REFUSED = { ok: false, code: "invalid_state", message: "sessão em uso" };
const TEXT = "Não dá para fazer isso agora.";

const press = async (view: ReturnType<typeof render>, name: string) => {
  const button = [...view.container.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === name,
  );
  expect(button).not.toBeUndefined();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
  await act(() => Bun.sleep(10));
};

describe("erros-com-solucao: refusals shown by forms", () => {
  test("the vault rules editor says what the code means, then the daemon's message", async () => {
    const store = {
      vaultRules: () => [],
      setVaultRules: async () => REFUSED,
    } as unknown as AppStore;
    const secret = { id: "s1", name: "token", rules: [] } as never;
    const view = render(<RulesEditor store={store} secret={secret} onClose={() => {}} />);
    await press(view, "Salvar regras");
    expect(view.container.textContent).toContain(`${TEXT} sessão em uso`);
  });

  test("the messaging rules section says what the code means, then the daemon's message", async () => {
    const store = {
      hostCommand: async () => ({ policy: { exceptions: [], retentionDays: 30 }, paused: [] }),
      hostRequest: async () => REFUSED,
      i18n: { t: (key: string) => key },
    } as unknown as AppStore;
    const view = render(<MessagingRulesSection store={store} hostId="h" />);
    await act(() => Bun.sleep(10));
    await press(view, "Salvar retenção");
    expect(view.container.textContent).toContain(`${TEXT} sessão em uso`);
  });
});
