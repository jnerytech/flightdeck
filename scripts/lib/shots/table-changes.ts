/**
 * Part of the print table (scripts/demo-shots.ts): the states of a card's Changes tab (#4229) that
 * `card-mudancas` does not show. A state the demo's host cannot be left in (a failed read, a binary
 * or a hidden file, a merge it would refuse) is a wire rule (#3982); the rest is the real host.
 */
import type { ChangesResult, DiffFile, PrComment, ReviewComment } from "@flightdeck/protocol";
import type { Page } from "playwright-core";
import type { DemoIds } from "../../demo-seed.ts";
import { ALFA, type Shot } from "./shot.ts";
import type { WireRule } from "./wire.ts";

const CHANGES_TAB = /^(Mudanças|Changes)$/;
const MERGE = /^(Merge and archive|Merge e arquivar)$/;

/** The card's first file in the demo's repository, which the fake claude wrote. */
const FAKE_FILE = "fake-1.txt";

const CART: DiffFile = {
  path: "src/cart.ts",
  oldPath: null,
  status: "modified",
  additions: 2,
  deletions: 1,
  uncommitted: false,
  binary: false,
  hunks: [
    {
      header: "@@ -1,3 +1,4 @@",
      lines: [
        { op: " ", text: "export const total = (items: number[]) => {" },
        { op: "-", text: "  return items.length;" },
        { op: "+", text: "  const sum = items.reduce((a, b) => a + b, 0);" },
        { op: "+", text: "  return sum;" },
        { op: " ", text: "};" },
      ],
    },
  ],
};

/** A binary, a hidden and a too-large file: none has a diff to show, and each says why. */
const KINDS: DiffFile[] = [
  { ...CART },
  {
    path: "assets/logo.png",
    oldPath: null,
    status: "added",
    additions: 0,
    deletions: 0,
    uncommitted: false,
    binary: true,
    hunks: [],
  },
  {
    path: "config/credentials.json",
    oldPath: null,
    status: "added",
    additions: 0,
    deletions: 0,
    uncommitted: true,
    binary: false,
    secret: true,
    hunks: [],
  },
  {
    path: "data/export.sql",
    oldPath: null,
    status: "added",
    additions: 0,
    deletions: 0,
    uncommitted: false,
    binary: false,
    tooLarge: true,
    bytes: 52_428_800,
    hunks: [],
  },
];

const changes = (target: string, files: DiffFile[], ahead: number): ChangesResult => ({
  target,
  root: "/work/flightdeck-web",
  base: "main",
  files,
  position: { ahead, behind: ahead === 0 ? 0 : 1 },
});

const draft = (id: string, line: number, body: string): ReviewComment => ({
  id,
  target: "card",
  path: "src/cart.ts",
  side: "new",
  lineStart: line,
  lineEnd: line,
  quote: line === 3 ? "  const sum = items.reduce((a, b) => a + b, 0);" : "  return sum;",
  body,
  state: "draft",
  createdAt: "2026-11-20T10:00:00.000Z",
  sentAt: null,
  outdated: false,
});

/** Two drafts and one already sent: the list the person edits and the history under it. */
const REVIEW: ReviewComment[] = [
  draft("r1", 3, "Start the sum at 0 for an empty cart."),
  draft("r2", 4, "Return the sum directly."),
  {
    ...draft("r3", 1, "Name the argument after what it holds."),
    state: "sent",
    sentAt: "2026-11-20T09:30:00.000Z",
  },
];

const prComment = (id: string, over: Partial<PrComment>): PrComment => ({
  id,
  path: "src/cart.ts",
  line: 3,
  author: "maria-dev",
  authorAssociation: "MEMBER",
  authorIdentity: null,
  body: "This ignores a discount line.",
  resolved: false,
  kind: "inline",
  ...over,
});

const PR_COMMENTS: PrComment[] = [
  prComment("c1", {}),
  prComment("c2", {
    line: 4,
    author: "outside-fan",
    authorAssociation: "NONE",
    body: "Could this return a number type?",
  }),
  prComment("c3", { path: null, line: null, kind: "review", resolved: true, body: "Looks good." }),
];

/** Opens the diff tab and waits for `text` (a file the list shows). */
async function openChanges(page: Page, text: string): Promise<void> {
  await page.getByRole("button", { name: CHANGES_TAB }).click();
  await page.getByText(text, { exact: true }).first().waitFor({ timeout: 15_000 });
}

const revertButton = (page: Page, path: string) =>
  page.getByRole("button", { name: new RegExp(`^(Revert|Reverter) ${path}$`) });

export function changesShots(ids: DemoIds): Shot[] {
  const card = { name: "card", host: ALFA, projectId: ids.project, cardId: ids.diffCard } as const;
  const prCard = { name: "card", host: ALFA, projectId: ids.project, cardId: ids.prCard } as const;
  const target = `card:${ids.diffCard}`;
  const read = (files: DiffFile[], ahead = 1): WireRule => ({
    command: "changes.get",
    data: changes(target, files, ahead),
  });
  const reviews: WireRule = { command: "review.list", data: { comments: REVIEW } };
  const prList = (list: PrComment[]): WireRule[] => [
    { command: "pr.comments", data: { comments: list } },
    read([], 0),
  ];
  return [
    {
      // #4229: Revert asks first; it says where the file goes back to and how long the copy is kept.
      name: "card-mudancas-reverter",
      route: card,
      prepare: async (page) => {
        await openChanges(page, FAKE_FILE);
        await revertButton(page, FAKE_FILE).click();
        await page.getByRole("alertdialog").waitFor();
      },
    },
    {
      // ...and after it, the offer to undo with the seconds left. The host's file is not reverted.
      name: "card-mudancas-desfazer",
      route: card,
      wire: [{ command: "changes.revert", reply: { path: FAKE_FILE, undoUntil: "{in 25s}" } }],
      prepare: async (page) => {
        await openChanges(page, FAKE_FILE);
        await revertButton(page, FAKE_FILE).click();
        await page
          .getByRole("alertdialog")
          .getByRole("button", { name: /^(Revert file|Reverter arquivo)$/ })
          .click();
        await page.getByRole("button", { name: /^(Undo|Desfazer)$/ }).waitFor();
      },
    },
    {
      // The file editor, open on the card's file.
      name: "card-mudancas-editor",
      route: card,
      prepare: async (page) => {
        await openChanges(page, FAKE_FILE);
        await page
          .getByRole("button", { name: new RegExp(`^(Edit file|Editar arquivo) ${FAKE_FILE}$`) })
          .click();
        await page.getByRole("textbox", { name: /^(Text of|Texto de) / }).waitFor();
      },
    },
    {
      // A save over a file that changed on disk: the host refuses it with the hash the editor read
      // (the wrong one here), and the editor offers to reload or overwrite. Nothing is written.
      name: "card-mudancas-conflito",
      route: card,
      wire: [
        {
          command: "file.read",
          data: { path: FAKE_FILE, text: "one\ntwo\n", hash: "0".repeat(64), size: 8 },
        },
      ],
      prepare: async (page) => {
        await openChanges(page, FAKE_FILE);
        await page
          .getByRole("button", { name: new RegExp(`^(Edit file|Editar arquivo) ${FAKE_FILE}$`) })
          .click();
        await page.getByRole("textbox", { name: /^(Text of|Texto de) / }).click();
        await page.keyboard.type("three");
        await page.getByRole("button", { name: /^(Save|Salvar)$/ }).click();
        await page
          .getByRole("button", { name: /^(Reload from disk|Recarregar do disco)$/ })
          .waitFor({ timeout: 15_000 });
      },
    },
    {
      // The host refuses to open the file: the editor says so instead of an empty box.
      name: "card-mudancas-editor-recusado",
      route: card,
      wire: [{ command: "file.read", refuse: "The host could not read this file." }],
      prepare: async (page) => {
        await openChanges(page, FAKE_FILE);
        await page
          .getByRole("button", { name: new RegExp(`^(Edit file|Editar arquivo) ${FAKE_FILE}$`) })
          .click();
        await page.getByText("The host could not read this file.", { exact: false }).waitFor();
      },
    },
    {
      // The merge dialog on a card with no PR: squash picked, with a commit message written.
      name: "card-mesclar",
      route: card,
      wire: [read([CART], 2)],
      prepare: async (page) => {
        await openChanges(page, CART.path);
        await page.getByRole("button", { name: MERGE }).click();
        const dialog = page.getByRole("alertdialog");
        await dialog.getByRole("radio", { name: /^Squash/ }).check();
        await dialog
          .getByRole("textbox", { name: /^(Commit message|Mensagem do commit)$/ })
          .fill("Fix the cart total");
      },
    },
    {
      // The host refuses the merge: its words stay on the card as an alert. The merge is never sent.
      name: "card-mesclar-recusado",
      route: card,
      wire: [
        read([CART], 2),
        { command: "card.mergeLocal", reject: "The merge stopped: src/cart.ts has a conflict." },
      ],
      prepare: async (page) => {
        await openChanges(page, CART.path);
        await page.getByRole("button", { name: MERGE }).click();
        await page.getByRole("alertdialog").getByRole("button", { name: MERGE }).click();
        await page.getByRole("alert").waitFor();
      },
    },
    {
      // The comments of a card's PR: an open one, one from outside the team and a resolved summary.
      name: "card-pr-comentarios",
      route: prCard,
      wire: prList(PR_COMMENTS),
      prepare: async (page) => {
        await page.getByRole("button", { name: CHANGES_TAB }).click();
        await page.getByText("Could this return a number type?").waitFor({ timeout: 15_000 });
      },
    },
    {
      name: "card-pr-comentarios-vazio",
      route: prCard,
      wire: prList([]),
      prepare: async (page) => {
        await page.getByRole("button", { name: CHANGES_TAB }).click();
        await page.getByText(/^(No comments on the PR\.|Nenhum comentário no PR\.)$/).waitFor({
          timeout: 15_000,
        });
      },
    },
    {
      name: "card-pr-comentarios-falhou",
      route: prCard,
      wire: [{ command: "pr.comments", refuse: "The host could not reach GitHub." }, read([], 0)],
      prepare: async (page) => {
        await page.getByRole("button", { name: CHANGES_TAB }).click();
        await page
          .getByText(/^(Could not read the PR comments\.|Não consegui ler os comentários do PR\.)$/)
          .waitFor({ timeout: 15_000 });
      },
    },
    {
      // A draft comment being edited, under the diff it was written on.
      name: "card-mudancas-comentario-editando",
      route: card,
      wire: [read([CART]), reviews],
      prepare: async (page) => {
        await openChanges(page, CART.path);
        await page
          .getByRole("button", {
            name: /^(Edit the comment on|Editar o comentário em) src\/cart\.ts, /,
          })
          .first()
          .click();
        await page.getByRole("textbox", { name: /^(Comment text|Texto do comentário)$/ }).waitFor();
      },
    },
    {
      // The review's list with its sent history: drafts, then the comment already sent.
      name: "card-mudancas-enviados",
      route: card,
      wire: [read([CART]), reviews],
      prepare: async (page) => {
        await openChanges(page, CART.path);
        await page
          .getByText(/^(Sent|Enviado)$/)
          .first()
          .waitFor();
      },
    },
    {
      // A binary, a hidden and a too-large file in the list: each one says why it has no diff.
      name: "card-mudancas-arquivos",
      route: card,
      wire: [read(KINDS)],
      prepare: async (page) => {
        await openChanges(page, "data/export.sql");
      },
    },
    {
      // The host cannot read the changes: the reason and a way to try again.
      name: "card-mudancas-falhou",
      route: card,
      wire: [{ command: "changes.get", refuse: "The host could not read the repository." }],
      prepare: async (page) => {
        await page.getByRole("button", { name: CHANGES_TAB }).click();
        await page.getByRole("button", { name: /^(Try again|Tentar de novo)$/ }).waitFor({
          timeout: 15_000,
        });
      },
    },
    {
      // Nothing changed on the card's branch.
      name: "card-mudancas-vazio",
      route: card,
      wire: [read([], 0)],
      prepare: async (page) => {
        await page.getByRole("button", { name: CHANGES_TAB }).click();
        await page.getByText(/^(Nothing changed\.|Nada mudou\.)$/).waitFor({ timeout: 15_000 });
      },
    },
  ];
}
