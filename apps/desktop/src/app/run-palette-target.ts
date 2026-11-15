import type { Card, ContractOverrides } from "@flightdeck/protocol";
import { projectContracts } from "@/features/board/ui.ts";
import { type PaletteTarget, paletteRoute } from "../features/palette/index.ts";
import type { AppStore } from "../lib/app-store.ts";
import type { Route } from "../lib/router.ts";

/** A card from an issue the palette named: by its full reference, else by its number in the project. */
async function createFromIssue(
  store: AppStore,
  target: Extract<PaletteTarget, { kind: "create-card-issue" }>,
) {
  const issueRef =
    target.ref ??
    (target.id
      ? (
          await store.hostCommand(target.hostId, "issues.get", {
            projectId: target.projectId,
            id: target.id,
          })
        )?.ref
      : undefined);
  return issueRef
    ? store.hostCommand(target.hostId, "issues.createCard", {
        projectId: target.projectId,
        issueRef,
      })
    : null;
}

/** An action of the palette that is not a screen: done in place, else the target's route. */
export function runPaletteTarget(
  store: AppStore,
  target: PaletteTarget,
  ui: {
    lang: string;
    go(route: Route): void;
    showHelp(): void;
    askStart(card: Card, contracts: ContractOverrides, go: () => void): void;
    /** Runs `go` at once, or after asking when another terminal holds the conversation (#1705). */
    guardLive(hostId: string, claudeSessionId: string | null, go: () => void): void;
  },
): void {
  switch (target.kind) {
    case "terminal":
      ui.guardLive(target.hostId, target.target.claudeSessionId, () => {
        if (store.terminals.embedded(target.hostId)) {
          void store.terminals.openClaude(target.hostId, target.target);
        } else void store.terminals.openIn(target.hostId, target.target);
      });
      return;
    case "new-terminal":
      void store.terminals.open(target.hostId);
      return;
    case "session-view":
      store.sessionViews.select(target.view);
      return;
    case "toggle-theme":
      store.theme.toggle();
      return;
    case "toggle-ui-mode":
      store.uiModes.toggle();
      return;
    case "switch-language":
      store.i18n.setLang(ui.lang === "pt-BR" ? "en" : "pt-BR");
      return;
    case "switch-client":
      store.clientScope.select(target.clientId);
      return;
    case "snippet":
      store.snippets.choose({ hostId: target.hostId, snippetId: target.snippetId });
      return;
    case "pull-link":
      void store.prWatch.openLink(target.url).then((route) => {
        if (route) ui.go(route);
      });
      return;
    case "create-card": {
      // Issue #147: text that matches no card becomes one in the project, and its board opens.
      const board: Route = { name: "board", host: target.hostId, projectId: target.projectId };
      void store
        .hostCommand(target.hostId, "card.create", {
          projectId: target.projectId,
          title: target.title,
          description: "",
        })
        .then((card) => {
          if (card) ui.go(board);
        });
      return;
    }
    case "start-session": {
      // Issue #1135: the typed text is the task; the mode and model are the form's last ones, and
      // the persona the client defaults to for that folder, as on the form.
      const { mode, model } = store.newSessionPrefs.value;
      const persona = store.personas.ref(
        store.clientScope.get().defaultPersona(target.hostId, target.cwd),
      );
      void store.commands.create(target.hostId, {
        cwd: target.cwd,
        prompt: target.prompt,
        permissionMode: mode,
        ...(model ? { model } : {}),
        ...(persona ? { persona } : {}),
      });
      return;
    }
    case "create-card-issue": {
      const board: Route = { name: "board", host: target.hostId, projectId: target.projectId };
      void createFromIssue(store, target).then((card) => {
        if (card) ui.go(board);
      });
      return;
    }
    case "start-card": {
      // The same question as the card's own Start (issue #78): only where In progress confirms.
      const start = () =>
        void store.hostCommand(target.hostId, "card.start", { cardId: target.cardId });
      const card = store.getState().cards[`${target.hostId}/${target.cardId}`];
      if (card) ui.askStart(card, projectContracts(store, target.hostId, card.projectId), start);
      else start();
      return;
    }
    case "shortcuts":
      ui.showHelp();
      return;
    case "decide-oldest":
      store.permissions.decideOldest(target.decision, target.key);
      return;
    default:
      ui.go(paletteRoute(target));
  }
}
