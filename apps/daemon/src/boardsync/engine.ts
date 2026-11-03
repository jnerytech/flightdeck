/**
 * Phase 38: one sync of a linked project with its external board: pull the items, apply them to the
 * cards, settle conflicts (the newest change wins, the loser goes to the card's log), and push the
 * local moves when the board allows it.
 */
import type { Board } from "../board/board.ts";
import type { Card } from "../board/types.ts";
import { FlightdeckError } from "../errors.ts";
import { UNTRUSTED_MARK } from "../issues/issues.ts";
import { columnOf } from "./map.ts";
import type { BoardProvider, ExternalItem } from "./provider.ts";
import type { BoardLink, BoardSyncStore, CardExternal } from "./store.ts";

export interface SyncReport {
  created: number;
  moved: number;
  updated: number;
  conflicts: number;
  /** Items with a status the map does not know. */
  unmapped: number;
  gone: number;
  /** Moves not made because the card is running. */
  skipped: number;
  pushed: number;
  redacted: number;
  truncated: boolean;
  notModified: boolean;
}

export interface BoardSyncOptions {
  board: Board;
  store: BoardSyncStore;
  provider: BoardProvider;
  /** Where a card from a third party's issue is suspended (phase 13). */
  autoApprove?: { suspend(key: string, reason: string): void };
  clock?: () => number;
}

const zero = (): SyncReport => ({
  created: 0,
  moved: 0,
  updated: 0,
  conflicts: 0,
  unmapped: 0,
  gone: 0,
  skipped: 0,
  pushed: 0,
  redacted: 0,
  truncated: false,
  notModified: false,
});

/** Changes this close in time are a tie. */
const TIE_MS = 2000;

/** The title a card gets when the token could not see the item. */
const RESTRICTED_TITLE = "Restricted item";

/** What a card made from an item says: the body and the link, under the mark for a stranger's. */
function descriptionOf(item: ExternalItem): string {
  return [item.content?.external ? UNTRUSTED_MARK : "", item.body, item.url]
    .filter((part) => part.trim() !== "")
    .join("\n\n");
}

/** A running card is not moved by someone else's change of status. */
const busy = (card: Card) =>
  card.queued ||
  card.workflowRunId !== null ||
  (card.sessionId !== null && card.column === "in_progress");

export class BoardSync {
  private readonly clock: () => number;

  constructor(private readonly opts: BoardSyncOptions) {
    this.clock = opts.clock ?? Date.now;
  }

  private iso(): string {
    return new Date(this.clock()).toISOString();
  }

  /** Pulls the board once and applies it to the project's cards. Throws what the provider threw. */
  async syncProject(projectId: string): Promise<SyncReport> {
    const { store, provider } = this.opts;
    const link = store.get(projectId);
    if (!link) {
      throw new FlightdeckError(
        "invalid_state",
        "the project has no linked board",
        "board_sync_not_linked",
      );
    }
    const report = zero();
    try {
      const pulled = await provider.pull(link.boardId, link.cursor ?? undefined);
      report.truncated = pulled.truncated;
      report.redacted = pulled.redacted;
      if (pulled.notModified) {
        report.notModified = true;
      } else {
        const seen = new Set<string>();
        for (const item of pulled.items) {
          seen.add(item.id);
          this.apply(projectId, link, item, report);
        }
        // A full pull that no longer lists an item: its card is flagged, never deleted.
        if (!pulled.truncated) this.flagMissing(projectId, seen, report);
      }
      store.update(projectId, {
        cursor: pulled.cursor,
        lastSyncedAt: this.iso(),
        lastError: null,
        truncated: pulled.truncated,
      });
      return report;
    } catch (error) {
      const reason = (error as { reason?: string }).reason ?? (error as Error).message;
      store.update(projectId, { lastError: reason });
      throw error;
    }
  }

  private flagMissing(projectId: string, seen: ReadonlySet<string>, report: SyncReport): void {
    const { store } = this.opts;
    for (const cardId of store.linkedCards(projectId)) {
      const external = store.externalOf(cardId);
      if (external.externalId && !seen.has(external.externalId) && !external.externalGone) {
        store.setExternal(cardId, { externalGone: true });
        report.gone += 1;
      }
    }
  }

  private apply(projectId: string, link: BoardLink, item: ExternalItem, report: SyncReport): void {
    const { store, board } = this.opts;
    const cardId = store.cardByExternal(projectId, item.id) ?? this.adopt(projectId, item);
    if (!cardId) {
      this.create(projectId, link, item, report);
      return;
    }
    const external = store.externalOf(cardId);
    if (item.archived !== external.externalGone) {
      store.setExternal(cardId, { externalGone: item.archived });
      if (item.archived) report.gone += 1;
    } else if (item.archived) {
      return;
    }
    const card = board.getCard(cardId);
    const changedAtProvider = item.updatedAt !== external.externalUpdatedAt;
    if (changedAtProvider && item.content !== null && item.title !== card.title) {
      this.opts.store.addLog(cardId, {
        at: this.iso(),
        kind: "title_changed",
        winner: "external",
        lostValue: card.title,
        lostAt: null,
        keptValue: item.title,
        keptAt: item.updatedAt,
        detail: null,
      });
      board.updateCard(cardId, { title: item.title });
      report.updated += 1;
    }
    if (item.status === external.externalStatus) {
      if (changedAtProvider) store.setExternal(cardId, { externalUpdatedAt: item.updatedAt });
      return;
    }
    if (external.localMovedAt !== null && this.conflicts(cardId, link, item, external, report)) {
      return;
    }
    this.settleStatus(cardId, link, item, report);
  }

  /**
   * The card moved here and the item changed there since the last sync. Both ending in the same
   * column is no conflict. Otherwise the later change wins and the loser is written to the log.
   * Answers true when this side kept the card as it is (so the provider's status is not applied).
   */
  private conflicts(
    cardId: string,
    link: BoardLink,
    item: ExternalItem,
    external: CardExternal,
    report: SyncReport,
  ): boolean {
    const { board, store } = this.opts;
    const column = columnOf(link.columnMap, item.status);
    const card = board.getCard(cardId);
    // A status the map does not know cannot be applied: the local move stands.
    if (column === null) return false;
    if (column === card.column) return false;
    const localAt = external.localMovedAt as string;
    const gap = Date.parse(item.updatedAt) - Date.parse(localAt);
    const winner: "local" | "external" =
      Math.abs(gap) <= TIE_MS ? (link.push ? "local" : "external") : gap > 0 ? "external" : "local";
    report.conflicts += 1;
    store.addLog(cardId, {
      at: this.iso(),
      kind: "conflict",
      winner,
      lostValue: winner === "external" ? card.column : item.status,
      lostAt: winner === "external" ? localAt : item.updatedAt,
      keptValue: winner === "external" ? item.status : card.column,
      keptAt: winner === "external" ? item.updatedAt : localAt,
      detail: null,
    });
    if (winner === "external") return false;
    // This side keeps the card: what the provider said is now known, the mark stays for the push.
    store.setExternal(cardId, { externalStatus: item.status, externalUpdatedAt: item.updatedAt });
    return true;
  }

  /** An existing card made from the same issue is linked to the item instead of a duplicate. */
  private adopt(projectId: string, item: ExternalItem): string | null {
    const ref = item.content?.kind === "issue" ? item.content.ref : undefined;
    const existing = ref ? this.opts.board.cardForIssue(projectId, ref) : null;
    if (!existing) return null;
    this.opts.store.setExternal(existing, {
      externalId: item.id,
      externalUrl: item.url,
      externalStatus: null,
      externalUpdatedAt: null,
    });
    return existing;
  }

  private create(projectId: string, link: BoardLink, item: ExternalItem, report: SyncReport): void {
    const { board, store } = this.opts;
    const ref = item.content?.kind === "issue" ? item.content.ref : undefined;
    const card = board.createCard(projectId, {
      title: item.content === null ? RESTRICTED_TITLE : item.title,
      description: descriptionOf(item),
      ...(ref ? { issueRef: ref, issueExternal: item.content?.external === true } : {}),
    });
    report.created += 1;
    if (item.content === null) report.redacted += 0;
    if (item.content?.external) {
      this.opts.autoApprove?.suspend(`card:${card.id}`, "card de issue de autor de fora");
    }
    store.setExternal(card.id, {
      externalId: item.id,
      externalUrl: item.url,
      externalStatus: null,
      externalUpdatedAt: null,
    });
    const column = columnOf(link.columnMap, item.status);
    if (column === null) report.unmapped += 1;
    this.settleStatus(card.id, link, item, report, true);
  }

  /** Applies the item's status to the card: the move, or the reason it was not made. */
  private settleStatus(
    cardId: string,
    link: BoardLink,
    item: ExternalItem,
    report: SyncReport,
    isNew = false,
  ): void {
    const { board, store } = this.opts;
    const column = columnOf(link.columnMap, item.status);
    const card = board.getCard(cardId);
    const record = { externalStatus: item.status, externalUpdatedAt: item.updatedAt };
    if (column === null) {
      if (!isNew) report.unmapped += 1;
      store.setExternal(cardId, record);
      return;
    }
    if (column !== card.column && !isNew && busy(card)) {
      report.skipped += 1;
      store.addLog(cardId, {
        at: this.iso(),
        kind: "move_skipped",
        winner: null,
        lostValue: item.status,
        lostAt: item.updatedAt,
        keptValue: card.column,
        keptAt: null,
        detail: "the card is running",
      });
      return;
    }
    if (column !== card.column) {
      board.moveCard(cardId, column);
      if (!isNew) report.moved += 1;
    }
    // The trigger marks a move as the card's own; this one is the board's, so the mark goes.
    store.setExternal(cardId, { ...record, localMovedAt: null });
  }
}
