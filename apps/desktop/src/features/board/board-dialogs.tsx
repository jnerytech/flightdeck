import type { BoardColumn, Card, Project } from "@flightdeck/protocol";
import type { ReactNode, RefObject } from "react";
import type { Key, T } from "../../i18n/index.ts";
import type { AppStore } from "../../lib/app-store.ts";
import { IssuesPanel } from "../issues/ui.ts";
import { CardStartDialog } from "./card-start-dialog.tsx";
import { ContractDialog } from "./contract-dialog.tsx";
import { DeleteCardDialog } from "./delete-card-dialog.tsx";
import { NewCardDialog } from "./new-card-dialog.tsx";
import type { MoveFocus } from "./use-move-focus.ts";
import type { MoveAsk } from "./use-selection-actions.tsx";

/** How long a card just made is waited for before the focus gives up on it (#1546). */
const MADE_CARD_WAIT_MS = 5000;

/** The dialogs a project's board opens: delete, the contract question, issues, start and new card. */
export function BoardDialogs(
  props: Readonly<{
    t: T;
    store: AppStore;
    hostId: string;
    projectId: string;
    project: Project | null;
    cards: Card[];
    /** Dialogs of the hooks (selection actions, bulk run, start ask), rendered in place. */
    hookDialogs: ReactNode;
    deleting: Card | null;
    onDeleteClose(): void;
    ask: MoveAsk | null;
    onAskClose(): void;
    /** Where the focus goes once a move has happened. */
    refocus: RefObject<MoveFocus | null>;
    runMove(cardId: string, column: BoardColumn, targetId?: string, force?: boolean): void;
    moveSelected(
      column: BoardColumn,
      targetId?: string,
      cards?: Card[],
      force?: boolean,
    ): Promise<void>;
    issuesOpen: boolean;
    onIssuesClose(): void;
    onProject(project: Project): void;
    starting: Card | null;
    onStartingClose(): void;
    creating: boolean;
    createIn: BoardColumn;
    onCreatingClose(): void;
    cardTemplates: boolean;
    onOpenCard(cardId: string, edit?: boolean): void;
    onOpenSettings(): void;
  }>,
) {
  const { t, store, hostId, projectId, project, ask, starting } = props;
  return (
    <>
      {props.deleting && (
        <DeleteCardDialog
          t={t}
          store={store}
          hostId={hostId}
          card={props.deleting}
          onClose={props.onDeleteClose}
        />
      )}
      {ask && (
        <ContractDialog
          t={t}
          column={t(`kanban.columns.${ask.column}` as Key)}
          lacking={ask.lacking}
          qualifying={ask.cards.length - ask.lacking.length}
          onRestoreFocus={(cardId) =>
            document.querySelector<HTMLElement>(`[data-card="${cardId}"] [data-card-open]`)?.focus()
          }
          onCancel={() => {
            props.onAskClose();
            props.refocus.current = null;
          }}
          onMoveAll={() => {
            props.onAskClose();
            const [only] = ask.cards;
            // The person went on anyway: the host is told, and keeps a notice on the card.
            if (only && ask.cards.length === 1)
              props.runMove(only.id, ask.column, ask.targetId, true);
            else void props.moveSelected(ask.column, ask.targetId, ask.cards, true);
          }}
          onMoveQualifying={() => {
            props.onAskClose();
            const lacks = new Set(ask.lacking.map((l) => l.card.id));
            void props.moveSelected(
              ask.column,
              ask.targetId,
              ask.cards.filter((card) => !lacks.has(card.id)),
            );
          }}
        />
      )}
      {props.hookDialogs}
      {props.issuesOpen && project && (
        <IssuesPanel
          store={store}
          hostId={hostId}
          project={project}
          cards={props.cards}
          onClose={props.onIssuesClose}
          onProject={props.onProject}
          onOpenCard={props.onOpenCard}
        />
      )}
      {starting && (
        <CardStartDialog
          store={store}
          hostId={hostId}
          card={starting}
          onClose={props.onStartingClose}
          onStarted={() =>
            store.success(t("kanban.started", { title: starting.title }), {
              label: t("kanban.openCard"),
              run: () => props.onOpenCard(starting.id),
            })
          }
        />
      )}
      <NewCardDialog
        t={t}
        store={store}
        hostId={hostId}
        projectId={projectId}
        open={props.creating}
        column={props.createIn}
        cardTemplates={props.cardTemplates}
        onClose={props.onCreatingClose}
        onOpenCard={props.onOpenCard}
        onMade={(card) => {
          // The card is not on the board yet: the focus waits for it (index -1 is never where it is).
          props.refocus.current = {
            cardId: card.id,
            column: card.column,
            index: -1,
            until: Date.now() + MADE_CARD_WAIT_MS,
          };
        }}
        onOpenSettings={props.onOpenSettings}
      />
    </>
  );
}
