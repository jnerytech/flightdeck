/** Part of the print table (scripts/demo-shots.ts), in print order: the AI assistant's settings and its wand (#4168). */
import type { Page } from "playwright-core";
import type { DemoIds } from "../../demo-seed.ts";
import type { AssistantMode } from "./assistant-frames.ts";
import { ALFA, type Shot } from "./shot.ts";

const WAIT = 15_000;
/** What the person types in the composer: several lines, so a suggestion shows its changes. */
const TYPED = "corrige o totl da compra\naplica o desconto\nmostra o frete";

/**
 * The assistant as a person leaves it once set up (#155): the wand on, Claude Code on the demo
 * host chosen and its privacy note agreed to. It holds no key: a key never goes through the page's storage.
 */
export function demoAssistantPrefs(): string {
  return JSON.stringify({
    version: 1,
    enabled: true,
    provider: "host",
    hostId: ALFA,
    confirmedHosts: [ALFA],
    models: {},
    profiles: {},
    openrouterPrivate: true,
  });
}

/** A button by the start of its name (the wand's name may carry its shortcut), in both languages. */
const named = (page: Page, name: string) =>
  page.getByRole("button", { name: new RegExp(`^(${name})`) });
const IMPROVE = "Improve with AI|Melhorar com IA";
const composer = (page: Page) => page.getByRole("textbox", { name: /^(Message|Mensagem)$/ });

/** The settings screen with the wand's setup notice, as the wand sends a person who has no provider. */
async function sentToSettings(page: Page): Promise<void> {
  await composer(page).fill(TYPED);
  await named(page, IMPROVE).click();
  await page
    .getByText(/^(Choose an AI provider to use|Escolha um provedor de IA para usar)/)
    .waitFor({ timeout: WAIT });
}

/** The host choice asks to agree to what leaves for the host, once. */
async function confirmHost(page: Page): Promise<void> {
  await page
    .getByRole("radio", { name: /^(Claude Code on a host|Claude Code em um host)/ })
    .click();
  await page
    .getByRole("alertdialog")
    .or(page.getByRole("dialog"))
    .first()
    .waitFor({ timeout: WAIT });
}

/** The wand on the composer, started on `TYPED`; `until` is what the state shows. */
const started = (until: (page: Page) => Promise<void>) => async (page: Page) => {
  await composer(page).fill(TYPED);
  await named(page, IMPROVE).click();
  await until(page);
};
const suggestion = (page: Page) =>
  page.getByRole("dialog", { name: /^(AI suggestion|Sugestão da IA)$/ }).waitFor({ timeout: WAIT });

export function assistantShots(ids: DemoIds): Shot[] {
  const settings = { name: "settings", section: "assistant" } as const;
  const session = { name: "session", host: ALFA, id: ids.idleSession } as const;
  const wand = (
    name: string,
    assistant: AssistantMode,
    until: (page: Page) => Promise<void>,
  ): Shot => ({
    name,
    route: session,
    assistantReady: true,
    assistant,
    prepare: started(until),
  });
  return [
    { name: "configuracoes-assistente", route: settings, assistantReady: true },
    {
      name: "configuracoes-assistente-avancado",
      route: settings,
      assistantReady: true,
      async prepare(page) {
        await named(page, "Advanced|Avançado").click();
        await page
          .getByText(/^(Which model profile|Qual perfil de modelo)/)
          .waitFor({ timeout: WAIT });
      },
    },
    { name: "configuracoes-assistente-confirmar", route: settings, prepare: confirmHost },
    { name: "configuracoes-assistente-aviso", route: session, prepare: sentToSettings },
    {
      name: "assistente-varinha-vazia",
      route: session,
      assistantReady: true,
      async prepare(page) {
        await named(page, "Write something first|Escreva algo primeiro").waitFor({ timeout: WAIT });
      },
    },
    // By the wand's own text, not a button name: the page may hold other Cancel or Dismiss buttons.
    wand("assistente-executando", "pending", (page) =>
      page
        .getByRole("status")
        .filter({ hasText: /Working on your text|Trabalhando no seu texto/ })
        .waitFor({ timeout: WAIT }),
    ),
    wand("assistente-sugestao", "answers", suggestion),
    wand("assistente-sugestao-avisos", "notices", suggestion),
    wand("assistente-falhou", "refuses", (page) =>
      page
        .getByRole("alert")
        .filter({ hasText: /Claude Code/ })
        .waitFor({ timeout: WAIT }),
    ),
    wand("assistente-desfazer", "answers", async (page) => {
      await suggestion(page);
      await named(page, "Accept|Aceitar").click();
      await named(page, "Undo|Desfazer").waitFor({ timeout: WAIT });
    }),
  ];
}
