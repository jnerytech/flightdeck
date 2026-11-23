/** Part of the print table (scripts/demo-shots.ts), in print order: the Timeline sheet's other states (#4252). */
import type { SnapshotInfo } from "@flightdeck/protocol";
import type { Page } from "playwright-core";
import type { DemoIds } from "../../demo-seed.ts";
import { ALFA, openTimeline, type Shot } from "./shot.ts";
import type { WireRule } from "./wire.ts";

const WAIT = 8000;
const REWIND_TURN_2 = /^(Voltar arquivos até aqui|Rewind files to here) \((turno|turn) 2\)$/;
const TRY_AGAIN = /^(Tentar de novo|Try again)$/;
const REWIND_FILES = /^(Voltar arquivos|Rewind files)$/;
const SHOW_MORE = /^(Mostrar mais|Show more)$/;
const SHOW_LESS = /^(Mostrar menos|Show less)$/;

/** What the host's undo preview lists: the demo's host has no rewind to undo, so the read goes out as another one. */
const UNDO_LISTED: WireRule = {
  command: "rewind.undoPreview",
  as: "snapshots.list",
  data: {
    via: "snapshot",
    files: [
      { path: "README.md", change: "modified" },
      { path: "src/cart.ts", change: "deleted" },
    ],
    insertions: 3,
    deletions: 1,
  },
};

/** A rewind that touches more files than fit in the dialog's list box (15 rem), to show its scroll (#4374). */
const MANY_FILES = Array.from({ length: 26 }, (_, i) => ({
  path: `src/checkout/step-${String(i + 1).padStart(2, "0")}.ts`,
  change: (["modified", "created", "deleted"] as const)[i % 3],
}));

const LONG_PROMPT = [
  "Round the cart total to two decimals before it is shown, and make the discount apply to the subtotal, not to the shipping.",
  "Keep the old behavior behind a flag until the checkout team confirms the new numbers,",
  "add a test for a cart with a coupon and free shipping, and explain in the answer which functions changed and why the totals can differ by a cent from the invoice the customer already received.",
].join("\n");

/** One snapshot as `snapshots.list` answers it. */
function snapshot(
  n: number,
  kind: "before" | "after",
  tree: string,
  prompt: string | null,
): SnapshotInfo {
  return {
    claudeSessionId: "5d0c7a14-3b9e-4c27-9a61-8e2f1b7d4c30",
    n,
    ref: `refs/flightdeck/demo/${n}`,
    tree,
    kind,
    turnUuid: kind === "before" ? `0a1b2c3d-0000-4000-8000-00000000000${n}` : null,
    prompt,
    createdAt: `2026-11-20T14:0${n}:11.000Z`,
    repo: "/home/demo/flightdeck-web",
  };
}

/** Two turns that changed files, the second with a prompt past the clamp. */
const LONG_PROMPT_WIRE: WireRule[] = [
  {
    command: "snapshots.list",
    data: {
      snapshots: [
        snapshot(1, "before", "a1", "Fix the cart total."),
        snapshot(2, "after", "a2", null),
        snapshot(3, "before", "a2", LONG_PROMPT),
        snapshot(4, "after", "a3", null),
      ],
    },
  },
];

/** The Rewind dialog of turn 2, with the pointer away from the button it was opened with. */
async function openRewind(page: Page): Promise<void> {
  await openTimeline(page);
  await page.getByRole("button", { name: REWIND_TURN_2 }).click();
  await page.mouse.move(1000, 700);
}

/** The Undo dialog, opened from the notice's button. */
async function openUndo(page: Page): Promise<void> {
  await openTimeline(page);
  await page
    .getByRole("button", { name: /^(Desfazer volta|Undo rewind)$/ })
    .click({ timeout: WAIT });
  await page.mouse.move(1000, 700);
}

/** The long prompt's Show more button, once the sheet lists the turns. */
async function showMoreButton(page: Page) {
  await openTimeline(page);
  const button = page.getByRole("button", { name: SHOW_MORE });
  await button.waitFor({ timeout: WAIT });
  return button;
}

export function timelineShots(ids: DemoIds): Shot[] {
  const route = { name: "session", host: ALFA, id: ids.rewindSession } as const;
  return [
    {
      name: "linha-do-tempo-voltar-recusa",
      route,
      wire: [
        {
          command: "rewind.preview",
          refuse: "The snapshots could not be read: git is not available here.",
        },
      ],
      prepare: async (page) => {
        await openRewind(page);
        await page.getByRole("button", { name: TRY_AGAIN }).first().waitFor({ timeout: WAIT });
        await page.waitForTimeout(400);
      },
    },
    {
      // The host's answer to Rewind files is a refusal, answered in the page so no file goes back.
      name: "linha-do-tempo-voltar-recusa-aplicar",
      route,
      wire: [
        {
          command: "rewind.apply",
          reject: "The files could not be rewound: a file is open in another program.",
        },
      ],
      prepare: async (page) => {
        await openRewind(page);
        await page
          .getByRole("button", { name: /^(Voltar arquivos|Rewind files)$/ })
          .click({ timeout: WAIT });
        await page
          .getByText(/^(Não deu para voltar os arquivos|Could not rewind the files)/)
          .first()
          .waitFor({ timeout: WAIT });
        await page.mouse.move(1000, 700);
        await page.waitForTimeout(400);
      },
    },
    {
      name: "linha-do-tempo-voltar-nada",
      route,
      wire: [
        {
          command: "rewind.preview",
          data: { via: "snapshot", files: [], insertions: 0, deletions: 0 },
        },
      ],
      prepare: async (page) => {
        await openRewind(page);
        await page
          .getByText(/^(Nada para voltar|Nothing to rewind)/)
          .first()
          .waitFor({ timeout: WAIT });
        await page.waitForTimeout(400);
      },
    },
    {
      // #4374: the list of files is taller than its box, so it scrolls (the print shows the box and the cut; the keyboard focus is checked by the dialog tests).
      name: "linha-do-tempo-voltar-lista-longa",
      route,
      wire: [
        {
          command: "rewind.preview",
          data: { via: "snapshot", files: MANY_FILES, insertions: 120, deletions: 48 },
        },
      ],
      prepare: async (page) => {
        await openRewind(page);
        await page
          .getByRole("list", {
            name: /^(Arquivos que esta volta altera|Files this rewind changes)$/,
          })
          .waitFor({ timeout: WAIT });
        await page.getByRole("button", { name: REWIND_FILES }).waitFor({ timeout: WAIT });
        await page.mouse.move(1000, 700);
        await page.waitForTimeout(400);
      },
    },
    {
      // The row of a turn whose files the host could not read: its text and Try again.
      name: "linha-do-tempo-arquivos-falhou",
      route,
      wire: [
        {
          command: "snapshots.files",
          refuse: "The turn's snapshot could not be read: git is not available here.",
        },
      ],
      prepare: async (page) => {
        await openTimeline(page);
        await page
          .getByRole("button", { name: /^(Ver arquivos do turno|Show files of turn) \d+$/ })
          .first()
          .click();
        await page
          .getByText(/^(Não deu para ler os arquivos do turno|Could not read the files of turn)/)
          .first()
          .waitFor({ timeout: WAIT });
        await page.getByRole("button", { name: TRY_AGAIN }).first().waitFor({ timeout: WAIT });
        await page.mouse.move(1000, 700);
        await page.waitForTimeout(400);
      },
    },
    {
      name: "linha-do-tempo-desfazer",
      route,
      wire: [UNDO_LISTED],
      prepare: async (page) => {
        await openUndo(page);
        await page.getByText(/^(Desfazer a volta|Undo the rewind)$/).waitFor({ timeout: WAIT });
        await page
          .getByText(/README\.md/)
          .first()
          .waitFor({ timeout: WAIT });
        await page.waitForTimeout(400);
      },
    },
    {
      // The sheet's own read of the undo preview lists files (that is what offers the Undo); the dialog's read is refused.
      name: "linha-do-tempo-desfazer-recusa",
      route,
      wire: [
        {
          ...UNDO_LISTED,
          afterRefuse: "The snapshots could not be read: git is not available here.",
        },
      ],
      prepare: async (page) => {
        await openUndo(page);
        await page
          .getByText(
            /^(Não deu para saber o que o desfazer muda|Could not work out what the undo changes)/,
          )
          .first()
          .waitFor({ timeout: WAIT });
        await page.getByRole("button", { name: TRY_AGAIN }).first().waitFor({ timeout: WAIT });
        await page.waitForTimeout(400);
      },
    },
    {
      name: "linha-do-tempo-prompt-longo",
      route,
      wire: LONG_PROMPT_WIRE,
      prepare: async (page) => {
        await showMoreButton(page);
        await page.mouse.move(1000, 700);
        await page.waitForTimeout(400);
      },
    },
    {
      name: "linha-do-tempo-prompt-longo-aberto",
      route,
      wire: LONG_PROMPT_WIRE,
      prepare: async (page) => {
        await (await showMoreButton(page)).click();
        await page.getByRole("button", { name: SHOW_LESS }).waitFor({ timeout: WAIT });
        await page.mouse.move(1000, 700);
        await page.waitForTimeout(400);
      },
    },
  ];
}
