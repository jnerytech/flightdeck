import type { Card, WorkflowInfo } from "@flightdeck/protocol";
import { useState } from "react";
import { ActionButton } from "@/components/feedback/action-button";
import { InlineNotice } from "@/components/feedback/inline-notice";
import { Field, NativeSelect } from "@/components/layout/form";
import { Inline, Stack } from "@/components/layout/stack";
import { Badge } from "@/components/ui/badge";
import { useT } from "@/i18n/context";
import type { Key } from "../i18n/index.ts";
import type { AppStore } from "../lib/app-store.ts";
import { type ChainNode, chainOf, pickable } from "../lib/deps.ts";

/** The blockers as an indented list: each with its column, and what it waits for in turn. */
function Chain(props: {
  nodes: ChainNode[];
  waiting: ReadonlySet<string>;
  /** How deep in the chain: what a blocker waits for is marked with an arrow. */
  depth: number;
  onRemove?: (id: string) => void;
}) {
  const t = useT();
  return (
    <Stack as="ul" gap={1}>
      {props.nodes.map(({ card, children }) => (
        <li key={card.id}>
          <Stack gap={1}>
            <Inline gap={2} className="text-sm">
              {props.depth > 0 && <span aria-hidden="true">↳</span>}
              <span className="font-medium">{card.title}</span>
              <Badge variant="outline">{t(`kanban.columns.${card.column}` as Key)}</Badge>
              {card.prState && <Badge variant="outline">{t(`pr.${card.prState}` as Key)}</Badge>}
              {!props.waiting.has(card.id) && (
                <span className="text-muted-foreground text-xs">{t("deps.satisfied")}</span>
              )}
              {props.onRemove && (
                <ActionButton
                  variant="ghost"
                  size="sm"
                  onClick={() => props.onRemove?.(card.id)}
                  aria-label={t("deps.remove", { title: card.title })}
                >
                  ×
                </ActionButton>
              )}
            </Inline>
            {children.length > 0 && (
              <Chain nodes={children} waiting={props.waiting} depth={props.depth + 1} />
            )}
          </Stack>
        </li>
      ))}
    </Stack>
  );
}

/**
 * Phase 31: what a card waits for and what it holds up. The blockers with their chain, the
 * choice of what satisfies one, the auto-start, and the "unblocked" mark to dismiss.
 */
export function CardDeps(props: {
  store: AppStore;
  hostId: string;
  card: Card;
  /** The cards of the card's project. */
  cards: Card[];
  workflows: WorkflowInfo[];
}) {
  const t = useT();
  const { store, hostId, card, cards } = props;
  const update = (patch: Record<string, unknown>) =>
    store.hostCommand(hostId, "card.update", { cardId: card.id, ...patch });
  const { nodes, more } = chainOf(cards, card);
  const offered = pickable(cards, card);
  const holding = cards.filter((other) => card.blocking.includes(other.id));
  // The blockers of the whole chain that are not satisfied: the rest read as done.
  const waiting = new Set(cards.flatMap((other) => other.waitingOn));
  const [picked, setPicked] = useState("");
  return (
    <Stack gap={3}>
      {card.unblockedAt && (
        <Inline gap={2}>
          <InlineNotice>{t("deps.unblockedNotice")}</InlineNotice>
          <ActionButton
            variant="outline"
            size="sm"
            onClick={() => store.hostCommand(hostId, "card.dismissUnblocked", { cardId: card.id })}
          >
            {t("deps.dismiss")}
          </ActionButton>
        </Inline>
      )}
      <section aria-label={t("deps.title")}>
        <Stack gap={2}>
          <h3 className="font-medium text-sm">{t("deps.title")}</h3>
          {nodes.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("deps.none")}</p>
          ) : (
            <Chain
              nodes={nodes}
              waiting={waiting}
              depth={0}
              onRemove={(id) =>
                update({ blockedBy: card.blockedBy.filter((other) => other !== id) })
              }
            />
          )}
          {more > 0 && (
            <p className="text-muted-foreground text-xs">{t("deps.more", { count: more })}</p>
          )}
          <Inline gap={2}>
            <Field label={t("deps.addLabel")}>
              {(control) => (
                <NativeSelect
                  {...control}
                  inline
                  value={picked}
                  onChange={(e) => setPicked(e.target.value)}
                >
                  <option value="">{t("deps.pick")}</option>
                  {offered.map((other) => (
                    <option key={other.id} value={other.id}>
                      {other.title}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
            <ActionButton
              variant="outline"
              onClick={() =>
                picked ? update({ blockedBy: [...card.blockedBy, picked] }) : undefined
              }
            >
              {t("deps.add")}
            </ActionButton>
          </Inline>
          <Inline gap={2}>
            <Field label={t("deps.whenLabel")}>
              {(control) => (
                <NativeSelect
                  {...control}
                  inline
                  value={card.unblockWhen}
                  onChange={(e) => update({ unblockWhen: e.target.value })}
                >
                  <option value="done">{t("deps.when.done")}</option>
                  <option value="merged">{t("deps.when.merged")}</option>
                </NativeSelect>
              )}
            </Field>
            <label className="text-sm">
              <Inline gap={2}>
                <input
                  type="checkbox"
                  checked={card.autoStart !== null}
                  onChange={(e) =>
                    update({ autoStart: e.target.checked ? { workflow: null } : null })
                  }
                />
                {t("deps.autoStart")}
              </Inline>
            </label>
            {card.autoStart && props.workflows.length > 0 && (
              <NativeSelect
                inline
                aria-label={t("deps.workflowLabel")}
                value={card.autoStart.workflow ?? ""}
                onChange={(e) => update({ autoStart: { workflow: e.target.value || null } })}
              >
                <option value="">{t("deps.noWorkflow")}</option>
                {props.workflows.map((w) => (
                  <option key={w.name} value={w.name}>
                    {w.name}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Inline>
        </Stack>
      </section>
      {holding.length > 0 && (
        <section aria-label={t("deps.blockingTitle")}>
          <Stack gap={1}>
            <h3 className="font-medium text-sm">{t("deps.blockingTitle")}</h3>
            <Stack as="ul" gap={1} className="text-sm">
              {holding.map((other) => (
                <li key={other.id}>{other.title}</li>
              ))}
            </Stack>
          </Stack>
        </section>
      )}
    </Stack>
  );
}
