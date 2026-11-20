/**
 * Data for `bun run demo` (phase 10): two `--runtime fake` daemons in this process, with temporary
 * homes, projects and transcripts, seeded through the protocol like an app would, plus an offline
 * host and one that speaks an old protocol. Nothing leaves the machine and no real data is read:
 * HOME points to a temporary folder before any daemon starts.
 *
 * What the prints need is all here: sessions running, waiting (Bash, Write, Edit and an MCP tool),
 * idle and ended; cards in every column and one with a diff; an empty project; 60+ sessions and a
 * long transcript; the plan quota; costs from usage in the transcripts; a very long title.
 */
import { Database } from "bun:sqlite";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { join } from "node:path";
import { inSequence } from "@flightdeck/protocol";
import { loadConfig } from "../apps/daemon/src/config.ts";
import { ulid } from "../apps/daemon/src/kernel/ulid.ts";
import { INSTRUCTIONS_VERSION } from "../apps/daemon/src/teams/domain/instructions.ts";
import { commitWorkflow, sha256 } from "../apps/daemon/test/support/workflow-helpers.ts";
import type { DemoHost } from "../apps/desktop/src/demo/boot.ts";
import { demoCardTemplates } from "./lib/demo/card-templates.ts";
import { type UsageLoad, waitUsageLoaded } from "./lib/demo/ready.ts";
import { DEMO_CREDENTIAL_FILE, DEMO_SECRET_FILE } from "./lib/demo/secret.ts";
import {
  ACTIONS_YAML,
  AGENT_MD,
  assistantLine,
  CLAUDE_MD,
  git,
  KNOWLEDGE_DOCS,
  MCP_JSON,
  repo,
  SKILL_MD,
  TRACE_SESSION,
  userLine,
  WORKFLOW,
  writeUserConfig,
} from "./lib/demo/seed-files.ts";
import {
  host,
  laggingCards,
  PROMPT_ONE,
  PROMPT_TWO,
  sendTelemetry,
  until,
} from "./lib/demo/seed-host.ts";
import { teleportReady } from "./lib/demo/teleport.ts";
import {
  CONTRACT_CARD,
  DANGER_SESSION,
  DEMO_ACTIVE_TEAM,
  DEMO_AWAY_FAILING_CARD,
  DEMO_AWAY_FAILING_URL,
  DEMO_AWAY_MERGED_CARD,
  DEMO_CLOSED_TEAM,
  DEMO_GATE_CARD,
  DEMO_PR_BETA_CARD,
  DEMO_PR_BETA_URL,
  DEMO_PR_CARD,
  DEMO_PR_URL,
  DEMO_TEAM_OUTCOME,
  DEMO_TEAM_REPORT,
} from "./lib/e2e/journeys.ts";
import { installFakeCli } from "./test/fake-cli.ts";
import { realTempDir } from "./test/temp-dir.ts";

/** The PR the fake gh opens for a workflow template added from the app (issue #1221). */
const DEMO_TEMPLATE_PR_URL = "https://github.com/acme/flightdeck-web/pull/301";

export { writeHistory } from "./lib/demo/seed-files.ts";
/** The terminal session that waits for a high-risk Bash (the e2e journey opens it by name). */
export { DANGER_SESSION };

const LONG_TITLE =
  "Migrar a autenticação do painel administrativo para o provedor novo sem derrubar as sessões abertas nem perder os tokens de serviço";

/** Ids the prints open screens with. */
export interface DemoIds {
  waitingSession: string;
  /** The permission request `waitingSession` holds open: the bell's print links a row to it (#1168). */
  waitingRequest: string;
  idleSession: string;
  project: string;
  emptyProject: string;
  diffCard: string;
  /** A card whose workflow run waits at an open gate. */
  gateCard: string;
  /** The project's name, as the Agente screen is opened with it. */
  projectName: string;
  /** A session with two turns that changed files: the timeline's rewind and fork. */
  rewindSession: string;
  /** The Claude session id of `idleSession`, whose Tempo tab has a timeline (phase 23). */
  telemetrySession: string;
  /** A finished terminal session whose transcript has tools and subagents: the Rastro tab (phase 25). */
  traceSession: string;
  /** #1406: the billing project, whose cards lag behind main (`DEMO_UPDATE_CARDS`). */
  updateProject: string;
  /** A folder of the first host that simple mode's tasks may work in (phase 33). */
  notesFolder: string;
  /** A git repository of the first host that is no project yet: the New project journey adds it (issue #931). */
  freshRepo: string;
  /** The file that sets the share of memory alfa reads as in use; deleting it leaves alfa with no reading (issue #1364). */
  memoryFile: string;
  /** A long conversation with a code block and a summary: where it opens and what keeps it still (issue #112). */
  scrollSession: string;
  /** A session in a folder with a long path, whose first message holds a long unbroken id (issue #103). */
  longSession: string;
  /** A session with a very long title: its crumb is cut with an ellipsis (issue #133). */
  longTitleSession: string;
  /** The clone of flightdeck-web on beta: where a session moved from alfa lands (issue #790). */
  teleportRepo: string;
  /** A project whose docs folders hold a valid, a transitional and an obsolete document (issue #76). */
  knowledgeProject: string;
  /** The card with no PR in that project's backlog: the stage-contract and card-pins journeys use it (issues #78, #76). */
  contractCard: string;
  /** What `flightdeckd pair` prints for the first host, to pair it again from a first start (issue #1562). */
  alfaPairing: { address: string; port: number; token: string };
}

export interface DemoSeed {
  hosts: DemoHost[];
  ids: DemoIds;
  stop(): Promise<void>;
}

/** Hosts the demo pairs with: the seeded ones, an offline one and one of an old protocol. */
export async function seedDemo(log: (msg: string) => void = () => {}): Promise<DemoSeed> {
  const work = realTempDir("fd-demo-");
  // Before any daemon: hooks, settings and the history never touch the real home.
  const home = join(work, "home");
  mkdirSync(home, { recursive: true });
  // What the seed changes in the environment, to be put back by stop() (issue #301): unset stays unset.
  const envBefore = new Map(["HOME", "USERPROFILE", "SHELL"].map((n) => [n, process.env[n]]));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  writeUserConfig(home);
  // The terminal of a host opens `$SHELL`: a fixed prompt, so no machine (the CI runner's user and
  // host name, the folder) leaks into the prints. POSIX only: Windows keeps its own default shell.
  if (process.platform !== "win32") {
    const shell = join(work, "demo-shell.sh");
    writeFileSync(
      shell,
      "#!/bin/sh\nexport PS1='demo$ ' USER=demo LOGNAME=demo HOSTNAME=demo\nexec bash --noprofile --norc -i\n",
    );
    chmodSync(shell, 0o755);
    process.env.SHELL = shell;
  }
  // A `gh` that lists one issue (the issues of phase 13 come through the CLI), before any daemon.
  const issue = {
    number: 7,
    title: "Corrigir o login com SSO",
    body: "O login falha quando o SSO devolve um e-mail em maiúsculas.",
    url: "https://github.com/Acme/App/issues/7",
    author: { login: "ana" },
    labels: [{ name: "bug" }],
    createdAt: "2026-10-01T10:00:00Z",
    authorAssociation: "MEMBER",
  };
  // Issue #1244: the open PR of the In review card. It stays open with its build passing; a merge is
  // held for a review, so Merge PR asks first and the card says why, run after run.
  const build = [{ name: "build", status: "COMPLETED", conclusion: "SUCCESS" }];
  const gh = installFakeCli(
    "gh",
    [
      { args: ["api", "user"], stdout: "eu\n" },
      { args: ["issue", "list"], stdout: JSON.stringify([issue]) },
      { args: ["issue", "view", "7"], stdout: JSON.stringify(issue) },
      // Issue #1221: a workflow template added from the app opens its PR through the CLI. The branch
      // has no PR yet (`pr view <branch>` finds none), so the create answers with the PR's URL.
      { args: ["pr", "create"], stdout: `Creating pull request\n${DEMO_TEMPLATE_PR_URL}\n` },
      {
        args: [
          "pr",
          "view",
          DEMO_PR_URL,
          "state,statusCheckRollup,mergeStateStatus,reviewDecision,createdAt",
        ],
        stdout: JSON.stringify({ state: "OPEN", statusCheckRollup: build }),
      },
      {
        args: ["pr", "view", DEMO_PR_URL, "mergeStateStatus,reviewDecision,statusCheckRollup"],
        stdout: JSON.stringify({
          mergeStateStatus: "BLOCKED",
          reviewDecision: "REVIEW_REQUIRED",
          statusCheckRollup: build,
        }),
      },
      {
        args: ["pr", "view", DEMO_PR_URL, "mergeable"],
        stdout: JSON.stringify({ mergeable: "MERGEABLE" }),
      },
      {
        args: ["pr", "checks", DEMO_PR_URL],
        stdout: JSON.stringify([{ name: "build", bucket: "pass", link: "" }]),
      },
      // Issue #1345: beta's PR is open and mergeable, and the host's merge goes through. The fake keeps
      // saying "open" afterwards (its answers do not change), so the card stays on the page.
      {
        args: [
          "pr",
          "view",
          DEMO_PR_BETA_URL,
          "state,statusCheckRollup,mergeStateStatus,reviewDecision,createdAt",
        ],
        stdout: JSON.stringify({ state: "OPEN", statusCheckRollup: build }),
      },
      { args: ["pr", "merge", DEMO_PR_BETA_URL], stdout: "Merged\n" },
      // Issue #1369: a PR whose checks fail, so the host's poll keeps it that way for the summary.
      {
        args: ["pr", "view", DEMO_AWAY_FAILING_URL, "state,statusCheckRollup"],
        stdout: JSON.stringify({
          state: "OPEN",
          statusCheckRollup: [{ name: "build", status: "COMPLETED", conclusion: "FAILURE" }],
        }),
      },
      {
        args: ["pr", "merge", DEMO_PR_URL],
        code: 1,
        stderr:
          "X Pull request #42 is not mergeable: the base branch policy prohibits the merge.\n",
      },
    ],
    process.env,
    // The PR body of a workflow template holds quotes and angle brackets: the demo is not a Windows shim.
    { rejectCmdChars: false },
  );

  // A `claude` for the Plugins page (phase 26), before any daemon: one installed plugin whose hook
  // listens on PreToolUse, and one the marketplace offers. The real CLI is never run.
  const plugin = join(work, "plugins", "deploy-tools");
  mkdirSync(join(plugin, ".claude-plugin"), { recursive: true });
  mkdirSync(join(plugin, "hooks"), { recursive: true });
  mkdirSync(join(plugin, "skills", "deploy"), { recursive: true });
  writeFileSync(
    join(plugin, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: "deploy-tools", version: "1.2.0", description: "Publica o app" }),
  );
  writeFileSync(
    join(plugin, "hooks", "hooks.json"),
    JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "guard.sh" }] }],
      },
    }),
  );
  writeFileSync(join(plugin, "skills", "deploy", "SKILL.md"), SKILL_MD);
  const claude = installFakeCli("claude", [
    {
      args: ["marketplace", "list"],
      stdout: JSON.stringify([
        { name: "acme", source: "github", repo: "acme/plugins", installLocation: plugin },
      ]),
    },
    {
      args: ["list", "--json"],
      stdout: JSON.stringify({
        installed: [
          {
            id: "deploy-tools@acme",
            version: "1.2.0",
            scope: "user",
            enabled: true,
            installPath: plugin,
          },
        ],
        available: [
          {
            pluginId: "lint-rules@acme",
            name: "lint-rules",
            marketplaceName: "acme",
            description: "Regras de lint para o time",
            version: "0.4.0",
          },
        ],
      }),
    },
  ]);

  const alfa = await host(work, "alfa");
  const beta = await host(work, "beta");
  // #1520: a third online host that differs, so the Compare hosts print has a majority to mark against.
  const gama = await host(work, "gama");
  log(`alfa em ${alfa.url}, beta em ${beta.url}, gama em ${gama.url}`);
  const { client } = alfa;

  // Projects: one with cards in every column (and one with a diff), one empty.
  const web = repo(join(alfa.projects, "flightdeck-web"), {
    "README.md": "# flightdeck-web\n",
    "app.ts": "export const versao = 1;\n",
    ".mcp.json": MCP_JSON,
    "CLAUDE.md": CLAUDE_MD,
    ".claude/agents/revisor.md": AGENT_MD,
    ".claude/skills/deploy/SKILL.md": SKILL_MD,
    ".flightdeck/actions.yaml": ACTIONS_YAML,
    // Issue #846: a key-shaped line and a credential file, for the Files panel's search to hide.
    [DEMO_SECRET_FILE.name]: DEMO_SECRET_FILE.text,
    [DEMO_CREDENTIAL_FILE.name]: DEMO_CREDENTIAL_FILE.text,
  });
  git(web, "remote", "add", "origin", "git@github.com:Acme/App.git");
  repo(join(alfa.projects, "vazio"), { "README.md": "# vazio\n" });
  commitWorkflow(web, "feature", WORKFLOW);
  // Issue #100: a session here can move to beta, which gets a clone with this commit.
  teleportReady(git, web, beta.projects);
  const project = await client.call<{ id: string }>("project.add", { path: web });
  await client.call("workflow.trust", {
    projectId: project.id,
    name: "feature",
    hash: sha256(WORKFLOW),
  });
  await client.call("project.update", { projectId: project.id, issues: { provider: "github" } });
  const empty = await client.call<{ id: string }>("project.add", {
    path: join(alfa.projects, "vazio"),
  });
  // Issue #689: seven projects in all, so the sidebar tree shows its five and hides the rest.
  // A repository nobody registered: the Projects page adds it (issue #931).
  repo(join(alfa.projects, "fresh-app"), { "README.md": "# fresh-app\n" });
  const projectIds: Record<string, string> = {};
  for (const name of ["mobile-app", "infra", "design-system", "billing", "analytics"]) {
    repo(
      join(alfa.projects, name),
      name === "design-system"
        ? {
            "README.md": `# ${name}\n`,
            ...KNOWLEDGE_DOCS,
            // Issue #1249: a card template, so New card's template picker has a print.
            ".flightdeck/templates/cards.json": demoCardTemplates(),
          }
        : { "README.md": `# ${name}\n` },
    );
    const adding = client.call<{ id: string }>("project.add", { path: join(alfa.projects, name) });
    const added = await adding; // NOSONAR: projects are added in this order; the sidebar lists them as registered
    projectIds[name] = added.id;
  }
  // The host reads a project's card templates only when the project is trusted (#1201).
  await client.call("project.trust.set", {
    path: join(alfa.projects, "design-system"),
    trusted: true,
  });
  // Issue #78: a card with no PR in a project whose board asks for one before Review.
  const contractCard = await client.call<{ id: string }>("card.create", {
    projectId: projectIds["design-system"],
    title: CONTRACT_CARD,
    description: "Explain how the design tokens are used.",
  });
  await laggingCards(client, {
    projectId: projectIds.billing as string,
    repo: join(alfa.projects, "billing"),
    worktrees: join(work, "worktrees"),
    db: join(alfa.dataDir, "flightdeck.db"),
  });
  const card = (title: string, description: string) =>
    client.call<{ id: string }>("card.create", { projectId: project.id, title, description });
  await card("Documentar a API pública", "Escreva o guia de uso.");
  await card(LONG_TITLE, "Planeje a migração.");
  const diff = await card("Somar no total do carrinho", "Corrija a soma. [commit]");
  await client.call("card.start", { cardId: diff.id });
  // The run stops at its gate: an open request in "Precisa de você", with its steps on the card.
  const gated = await card(DEMO_GATE_CARD, "Faça o plano e peça aprovação.");
  await client.call("card.start", { cardId: gated.id, workflow: "feature" });
  // Created in Review: a person's move there would ask for a PR (issue #78), and the demo has none.
  const inReview = await client.call<{ id: string }>("card.create", {
    projectId: project.id,
    title: DEMO_PR_CARD,
    description: "Padronize os textos.",
    column: "review",
  });
  // Issue #1244: its PR is open on GitHub (the fake gh above), so the card offers Merge PR. It is
  // written as a PR the host opened is (`createPr`), without pushing a branch.
  await client.call("project.update", { projectId: project.id, prProvider: "github" });
  const prs = new Database(join(alfa.dataDir, "flightdeck.db"));
  prs
    .query("UPDATE cards SET pr_url = ?, pr_state = 'open', checks_state = 'passing' WHERE id = ?")
    .run(DEMO_PR_URL, inReview.id);
  prs.close();
  const waiting = await card("Aguardando o time de design", "Espere o layout.");
  // Phase 31: a chain of three cards: the schema, the API that needs it, the screen that needs the API.
  const schema = await card("Definir o esquema do carrinho", "Tabelas e índices.");
  const api = await client.call<{ id: string }>("card.create", {
    projectId: project.id,
    title: "API do carrinho",
    description: "Endpoints de leitura e escrita.",
    blockedBy: [schema.id],
  });
  await client.call("card.create", {
    projectId: project.id,
    title: "Tela do carrinho",
    description: "Liste os itens e some o total.",
    blockedBy: [api.id],
    autoStart: { workflow: null },
  });
  await client.call("card.move", { cardId: waiting.id, column: "waiting" });
  const done = await card("Atualizar dependências", "Atualize e rode os testes.");
  await client.call("card.move", { cardId: done.id, column: "done" });

  // Phase 36: delivered work for the ROI card, whatever day the demo runs. This month so far: four
  // cards done (two planned, two unplanned; two as merged PRs); the period before it: two.
  await client.call("project.update", { projectId: project.id, defaultHours: 2 });
  const finished: string[] = [done.id];
  await inSequence(["Ajustar o rodapé", "Revisar os textos", "Trocar o ícone"], async (title) => {
    const extra = await card(title, "Entregue na demo.");
    await client.call("card.move", { cardId: extra.id, column: "done" });
    finished.push(extra.id);
  });
  await inSequence(["Corrigir o menu", "Limpar o cache"], async (title) => {
    const old = await card(title, "Entregue antes.");
    await client.call("card.move", { cardId: old.id, column: "done" });
    finished.push(old.id);
  });
  const marks = new Database(join(alfa.dataDir, "flightdeck.db"));
  const nowIso = new Date().toISOString();
  const longAgo = new Date(Date.now() - 40 * 86_400_000).toISOString();
  const monthStart = new Date(`${nowIso.slice(0, 7)}-01T00:00:00Z`);
  // Noon of the day before this month began: inside the period before, however short the month so far.
  const before = new Date(monthStart.getTime() - 12 * 3_600_000).toISOString();
  const plan: Array<[string, string, string, string]> = [
    [finished[0] as string, nowIso, nowIso, "moved"],
    [finished[1] as string, nowIso, longAgo, "merged"],
    [finished[2] as string, nowIso, longAgo, "merged"],
    [finished[3] as string, nowIso, nowIso, "moved"],
    [finished[4] as string, before, longAgo, "moved"],
    [finished[5] as string, before, longAgo, "moved"],
  ];
  for (const [cardId, doneAt, createdAt, via] of plan) {
    marks
      .query("UPDATE card_done SET done_at = ?, card_created_at = ?, via = ? WHERE card_id = ?")
      .run(doneAt, createdAt, via, cardId);
  }
  marks.close();

  // Two budgets far above the day's usage, so Configurações lists them without raising an alert.
  await client.call("budget.set", {
    scope: "host",
    period: "day",
    limitUsd: 500,
    action: "notify",
  });
  await client.call("budget.set", {
    scope: "project",
    projectKey: "github.com/acme/app",
    period: "month",
    limitUsd: 5000,
    action: "queue",
  });

  // The project's auto memory (phase 26): an index, two topic files and one the index leaves out.
  const remember = (name: string, content: string) =>
    client.call("memory.write", {
      projectId: project.id,
      name,
      content,
      expectedHash: null,
      confirm: true,
    });
  await remember(
    "MEMORY.md",
    "- [Perfil](user_role.md) — quem usa o projeto\n- [Testes](feedback_testes.md) — rodar a suíte inteira antes do commit\n",
  );
  await remember(
    "user_role.md",
    "---\nname: perfil\ndescription: quem usa o projeto\ntype: user\n---\n\nA equipe de plataforma mantém o app.\n",
  );
  await remember(
    "feedback_testes.md",
    "---\nname: testes\ndescription: rodar a suíte inteira\ntype: feedback\n---\n\nRode a suíte inteira antes do commit.\n",
  );
  await remember("solta.md", "Uma nota que o índice não cita.\n");

  // A change in the working tree, for the Mudanças tab of the sessions working in this folder.
  writeFileSync(join(web, "app.ts"), "export const versao = 2;\n");

  // Managed sessions: waiting for Bash, waiting for Write, idle, ended; the plan quota.
  const later = (hours: number) => Math.floor(Date.now() / 1000) + hours * 3600;
  const session = (name: string, prompt: string) =>
    client.call<{ sessionId: string }>("session.create", { cwd: web, name, prompt });
  const bash = await session("Testes do backend", "[bash] rode a suíte");
  const bashRequest = await until(() => client.requests.get(bash.sessionId), "pedido do Bash");
  await session("Changelog da versão", "[tool] escreva o changelog");
  const idle = await session(
    "Revisão do PR 128",
    `Revise o PR. [ratelimit:five_hour=0.62@${later(2)}] [ratelimit:seven_day=0.35@${later(100)}]`,
  );
  const longTitle = await session(LONG_TITLE, "Planeje os passos.");
  // A worker's worktree path is long, and its messages quote ids that never break.
  const deep = join(
    web,
    ".flightdeck",
    "worktrees",
    "md-server-executora-1-com-um-nome-muito-comprido",
  );
  mkdirSync(deep, { recursive: true });
  const longSession = await client.call<{ sessionId: string }>("session.create", {
    cwd: deep,
    name: "md-server · executora 1",
    prompt: `Espere a tarefa de pc-nery/01M6K3MD573NETWEABH2YXKCHG01M6K3MD573NETWEABH2YXKCHG01M6K3MD573NETWEABH2YXKCHG e não comece nada por conta própria. ${"x".repeat(240)}`,
  });
  const ended = await session("Sessão antiga", "Liste os arquivos.");
  const statusOf = async (sessionId: string) => {
    const list = await client.call<{ sessions: Array<{ id: string; status: string }> }>(
      "session.list",
      {},
    );
    return list.sessions.find((s) => s.id === sessionId)?.status;
  };
  await until(async () => (await statusOf(bash.sessionId)) === "awaiting_permission", "Bash");
  await until(async () => (await statusOf(ended.sessionId)) === "idle", "sessão antiga");
  await client.call("session.close", { sessionId: ended.sessionId });

  // A closed team nobody works in: the Teams journey deletes it (issue #934). Its coordinator is the
  // idle session and its worker's card a finished one, so both are still there once it is gone.
  await until(async () => (await statusOf(idle.sessionId)) === "idle", "sessão ociosa");
  const teams = new Database(join(alfa.dataDir, "flightdeck.db"));
  const members = [
    {
      name: "coordenadora",
      role: "coordinator",
      persona: null,
      cardId: null,
      sessionId: idle.sessionId,
    },
    {
      name: "executora-1",
      role: "worker",
      persona: null,
      cardId: finished[0] as string,
      sessionId: null,
      number: 1,
    },
  ];
  teams
    .query(
      `INSERT INTO teams (id, name, project_id, goal, coordinator, members, checks, state,
                          paused_by, instructions_version, created_at)
       VALUES (?, ?, ?, ?, ?, ?, '[]', 'closed', NULL, ?, ?)`,
    )
    .run(
      ulid(),
      DEMO_CLOSED_TEAM,
      project.id,
      "Ship the login.",
      idle.sessionId,
      JSON.stringify(members),
      INSTRUCTIONS_VERSION,
      new Date().toISOString(),
    );

  // An active team at work (issue #1222): its page shows each member's last report. Its members are
  // a session and cards the demo already has, so no other screen's counts change, and the host acts
  // on an active team only when the quota crosses its limit.
  const diffSession = await until(async () => {
    const board = await client.call<{
      columns: Array<{ cards: Array<{ id: string; sessionId: string | null }> }>;
    }>("board.get", { projectId: project.id });
    return board.columns.flatMap((c) => c.cards).find((c) => c.id === diff.id)?.sessionId;
  }, "sessão do card do carrinho");
  const activeTeam = ulid();
  const crew = [
    {
      name: "coordenadora",
      role: "coordinator",
      persona: null,
      cardId: null,
      sessionId: longTitle.sessionId,
    },
    {
      name: "executora-1",
      role: "worker",
      persona: null,
      cardId: diff.id,
      sessionId: diffSession,
      number: 1,
    },
    {
      name: "executora-2",
      role: "worker",
      persona: null,
      cardId: finished[1] as string,
      sessionId: null,
      number: 2,
    },
  ];
  teams
    .query(
      `INSERT INTO teams (id, name, project_id, goal, coordinator, members, checks, state,
                          paused_by, instructions_version, created_at)
       VALUES (?, ?, ?, ?, ?, ?, '[]', 'active', NULL, ?, ?)`,
    )
    .run(
      activeTeam,
      DEMO_ACTIVE_TEAM,
      project.id,
      "Corrigir o total do carrinho.",
      longTitle.sessionId,
      JSON.stringify(crew),
      INSTRUCTIONS_VERSION,
      new Date().toISOString(),
    );
  // Issue #1220: the coordinator's report of the goal done, the outcome on top of the team's card.
  teams
    .query("UPDATE teams SET report_text = ?, report_at = ?, report_done = 1 WHERE id = ?")
    .run(DEMO_TEAM_OUTCOME, new Date().toISOString(), activeTeam);
  // The reports: what the first worker told the coordinator, and the coordinator's answer.
  const reports: Array<[string, string, string]> = [
    [diffSession, longTitle.sessionId, DEMO_TEAM_REPORT],
    [longTitle.sessionId, diffSession, "Revise o arredondamento e abra o PR."],
  ];
  for (const [at, [from, to, text]] of reports.entries()) {
    const sent = Date.now() - (reports.length - at) * 60_000;
    teams
      .query(
        `INSERT INTO session_messages (id, from_session, from_host, to_session, to_host, text,
                                       status, created_at, created_ms, delivered_at, team_id, kind)
         VALUES (?, ?, 'alfa', ?, 'alfa', ?, 'delivered', ?, ?, ?, ?, 'session')`,
      )
      .run(
        ulid(),
        from,
        to,
        text,
        new Date(sent).toISOString(),
        sent,
        new Date(sent).toISOString(),
        activeTeam,
      );
  }
  teams.close();

  // A long conversation (a code block in the first message, then twenty-four turns) whose summary
  // the host can build: the scroll journey needs a conversation taller than the window.
  const long = await session(
    "Conversa longa",
    "Mostre o código:\n```ts\nexport const total = (a: number, b: number) => a + b;\n```",
  );
  for (let turn = 1; turn <= 24; turn++) {
    await until(async () => (await statusOf(long.sessionId)) === "idle", `turno ${turn}`); // NOSONAR: the turns of one conversation, each after the last
    await /* NOSONAR: the turns of one conversation, each after the last */ client.call(
      "session.send",
      {
        sessionId: long.sessionId,
        text: `Passo ${turn}: explique o ponto ${turn} da revisão com detalhes suficientes para passar de uma linha na tela.`,
      },
    );
  }
  await until(async () => (await statusOf(long.sessionId)) === "idle", "última resposta");
  const longClaude = (await until(async () => {
    const list = await client.call<{
      sessions: Array<{ id: string; claudeSessionId: string | null }>;
    }>("session.list", {});
    return list.sessions.find((s) => s.id === long.sessionId)?.claudeSessionId;
  }, "id da conversa longa")) as string;
  const longTs = new Date().toISOString();
  writeFileSync(
    join(alfa.claudeProjects, "-demo", `${longClaude}.jsonl`),
    `${[
      userLine("long-u", "Revise o carrinho e explique cada ponto", web, longTs),
      assistantLine(
        "long-a",
        "Revisei o carrinho: a soma do total estava errada e foi corrigida.",
        web,
        longTs,
      ),
    ].join("\n")}\n`,
  );
  await until(
    async () =>
      client.call("session.summary", { claudeSessionId: longClaude }).then(
        () => true,
        () => false,
      ),
    "resumo da conversa longa",
  );

  // Two turns that change files: each waits for a permission (the snapshot before it is taken by
  // then), the seed edits the files as the agent would, and approving ends the turn.
  const rewind = await session("Carrinho: soma do total", "[tool] Corrija a soma do carrinho.");
  const claudeOf = async (sessionId: string) => {
    const list = await client.call<{
      sessions: Array<{ id: string; claudeSessionId: string | null }>;
    }>("session.list", {});
    return list.sessions.find((s) => s.id === sessionId)?.claudeSessionId;
  };
  // Timing for the Tempo tab (the idle session) and for Custos (the session with usage).
  const telemetrySession = (await until(() => claudeOf(idle.sessionId), "id da revisão")) as string;
  const when = Date.now() - 10 * 60_000;
  await inSequence([telemetrySession, "aaaaaaaa-0000-4000-8000-000000000001"], async (id) => {
    await sendTelemetry(alfa, id, "demo-prompt-1", when, PROMPT_ONE);
    await sendTelemetry(alfa, id, "demo-prompt-2", when + 60_000, PROMPT_TWO);
  });
  // Custos groups the timing by the project of the usage: a reader that comes right after the seed
  // (the tests, the first print) must find the transcripts already read.
  await waitUsageLoaded(async () => {
    const status = await client.call<{ initialLoad: UsageLoad }>("costs.status", {});
    return status.initialLoad;
  });
  const rewindClaude = (await until(() => claudeOf(rewind.sessionId), "id do carrinho")) as string;
  const snapshotsOf = async () =>
    (
      await client.call<{ snapshots: Array<{ kind: string }> }>("snapshots.list", {
        claudeSessionId: rewindClaude,
      })
    ).snapshots;
  const editingTurn = async (edit: () => void, snapshotsAfter: number) => {
    await until(
      async () => (await snapshotsOf()).length >= snapshotsAfter - 1,
      "snapshot do turno",
    );
    await until(() => client.requests.get(rewind.sessionId), "pedido do carrinho");
    edit();
    await client.call("permission.respond", {
      requestId: client.requests.get(rewind.sessionId),
      decision: "allow",
    });
    await until(async () => (await snapshotsOf()).length >= snapshotsAfter, "fim do turno");
  };
  await editingTurn(() => writeFileSync(join(web, "app.ts"), "export const versao = 2;\n"), 2);
  await client.call("session.send", {
    sessionId: rewind.sessionId,
    text: "[tool] Revise o arredondamento.",
  });
  await editingTurn(
    () =>
      writeFileSync(
        join(web, "carrinho.ts"),
        "export const total = (xs: number[]) => xs.reduce((a, b) => a + b, 0);\n",
      ),
    4,
  );

  // Terminal sessions (hooks): one running, one waiting for Edit, one for an MCP tool. The
  // seed watches the external sessions, so the receptor holds their requests open.
  await client.call("hooks.install", { confirm: true });
  await client.call("external.watch", {});
  const status = await client.call<{ receptorUrl: string | null }>("hooks.status", {});
  const hooksToken = (await loadConfig(alfa.config)).hooks.token ?? "";
  // A held PermissionRequest waits for the app for as long as the demo runs. Bun's `fetch` gives
  // up on a request after 6 minutes (and has no option to turn that off), which dropped the
  // seeded requests from the queue in a slow e2e run; `node:http` has no such limit.
  const hook = (sessionId: string, event: string, body: object) =>
    new Promise<void>((done) => {
      const req = request(
        `${status.receptorUrl}/hooks/${event}`,
        { method: "POST", headers: { Authorization: `Bearer ${hooksToken}` } },
        (res) => {
          res.resume();
          res.on("end", () => done());
          res.on("error", () => done());
        },
      );
      req.on("error", () => done());
      req.end(JSON.stringify({ session_id: sessionId, hook_event_name: event, cwd: web, ...body }));
    });
  await inSequence(
    [
      ["ext-rodando", "suba o servidor de desenvolvimento"],
      ["ext-edit", "corrija o import quebrado"],
      ["ext-mcp", "abra uma issue para o bug do login"],
      ["ext-rm", "limpe os artefatos de build"],
    ] as const,
    async ([id, prompt]) => {
      await hook(id, "SessionStart", { source: "startup" });
      await hook(id, "UserPromptSubmit", { prompt });
    },
  );
  // Names, so the list tells the terminal sessions apart.
  await client.call("session.meta.set", {
    claudeSessionId: "ext-rodando",
    name: "Servidor de desenvolvimento",
  });
  await client.call("session.meta.set", {
    claudeSessionId: "ext-edit",
    name: "Corrigir o import quebrado",
  });
  await client.call("session.meta.set", {
    claudeSessionId: "ext-mcp",
    name: "Issue do bug de login",
  });
  await client.call("session.meta.set", { claudeSessionId: "ext-rm", name: DANGER_SESSION });
  void hook("ext-rm", "PermissionRequest", {
    tool_name: "Bash",
    tool_input: { command: "rm -rf build" },
  });
  void hook("ext-edit", "PermissionRequest", {
    tool_name: "Edit",
    tool_input: { file_path: join(web, "app.ts"), old_string: "1", new_string: "2" },
  });
  void hook("ext-mcp", "PermissionRequest", {
    tool_name: "mcp__github__create_issue",
    tool_input: { repo: "acme/flightdeck-web", title: "Login falha com SSO", labels: ["bug"] },
  });

  // beta: a quieter host, with one session and one open PR (issue #1345: the Pull requests page lists
  // the PRs of both hosts).
  const betaApi = repo(join(beta.projects, "flightdeck-api"), {
    "README.md": "# flightdeck-api\n",
  });
  const apiProject = await beta.client.call<{ id: string }>("project.add", { path: betaApi });
  await beta.client.call("project.update", { projectId: apiProject.id, prProvider: "github" });
  const apiCard = await beta.client.call<{ id: string }>("card.create", {
    projectId: apiProject.id,
    title: DEMO_PR_BETA_CARD,
    description: "A route that says the service is up.",
    column: "review",
  });
  // Issue #1369: what beta did while the app was closed besides the cards in review: a card done with
  // its PR merged, and a card in review whose PR has failing checks.
  const lockfile = await beta.client.call<{ id: string }>("card.create", {
    projectId: apiProject.id,
    title: DEMO_AWAY_MERGED_CARD,
    description: "Bump the lockfile.",
    column: "review",
  });
  await beta.client.call("card.move", { cardId: lockfile.id, column: "done" });
  const flaky = await beta.client.call<{ id: string }>("card.create", {
    projectId: apiProject.id,
    title: DEMO_AWAY_FAILING_CARD,
    description: "The retry test fails one run in five.",
    column: "review",
  });
  const betaPrs = new Database(join(beta.dataDir, "flightdeck.db"));
  betaPrs
    .query("UPDATE cards SET pr_url = ?, pr_state = 'open', checks_state = 'passing' WHERE id = ?")
    .run(DEMO_PR_BETA_URL, apiCard.id);
  betaPrs
    .query(
      "UPDATE cards SET pr_url = ?, pr_state = 'merged', checks_state = 'passing' WHERE id = ?",
    )
    .run("https://github.com/acme/flightdeck-api/pull/56", lockfile.id);
  betaPrs
    .query("UPDATE cards SET pr_url = ?, pr_state = 'open', checks_state = 'failing' WHERE id = ?")
    .run(DEMO_AWAY_FAILING_URL, flaky.id);
  betaPrs.close();
  await beta.client.call("session.create", {
    cwd: beta.projects,
    name: "Rotina de backup",
    prompt: "Confira o backup.",
  });

  // An old daemon: answers hello refusing this app's protocol.
  const old = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: (req, srv) => (srv.upgrade(req) ? undefined : new Response("ws", { status: 426 })),
    websocket: {
      message(ws, raw) {
        const frame = JSON.parse(String(raw)) as { id: string };
        ws.send(
          JSON.stringify({
            type: "ack",
            id: frame.id,
            ok: false,
            error: { code: "protocol_incompatible", message: "protocolo 1 apenas" },
          }),
        );
      },
    },
  });
  // Reconnecting: a server that takes the connection and never answers the handshake.
  const slow = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: () => new Promise<Response>(() => {}),
  });
  // Offline: an address nothing listens on.
  const closed = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("") });
  const offlineUrl = `ws://127.0.0.1:${closed.port}/v1/ws`;
  closed.stop(true);

  log("dados semeados");
  return {
    hosts: [
      { id: "demo-alfa", name: "alfa", url: alfa.url, token: alfa.token },
      { id: "demo-beta", name: "beta", url: beta.url, token: beta.token },
      { id: "demo-gama", name: "gama", url: gama.url, token: gama.token },
      { id: "demo-offline", name: "notebook", url: offlineUrl, token: "x".repeat(32) },
      {
        id: "demo-slow",
        name: "estação",
        url: `ws://127.0.0.1:${slow.port}/v1/ws`,
        token: "x".repeat(32),
      },
      {
        id: "demo-old",
        name: "servidor antigo",
        url: `ws://127.0.0.1:${old.port}/v1/ws`,
        token: "x".repeat(32),
      },
    ],
    ids: {
      waitingSession: bash.sessionId,
      waitingRequest: bashRequest,
      idleSession: idle.sessionId,
      project: project.id,
      emptyProject: empty.id,
      diffCard: diff.id,
      gateCard: gated.id,
      projectName: "flightdeck-web",
      rewindSession: rewind.sessionId,
      telemetrySession,
      traceSession: TRACE_SESSION,
      notesFolder: join(alfa.projects, "notes"),
      freshRepo: join(alfa.projects, "fresh-app"),
      memoryFile: alfa.memoryFile,
      scrollSession: long.sessionId,
      longSession: longSession.sessionId,
      longTitleSession: longTitle.sessionId,
      teleportRepo: join(beta.projects, "flightdeck-web"),
      knowledgeProject: projectIds["design-system"] as string,
      updateProject: projectIds.billing as string,
      contractCard: contractCard.id,
      alfaPairing: {
        address: new URL(alfa.url).hostname,
        port: Number(new URL(alfa.url).port),
        token: alfa.token,
      },
    },
    stop: async () => {
      // Newest first: each restore puts back the PATH it saw, so the oldest must go last.
      claude.restore();
      gh.restore();
      old.stop(true);
      slow.stop(true);
      await alfa.stop();
      await beta.stop();
      await gama.stop();
      for (const [name, value] of envBefore) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    },
  };
}
