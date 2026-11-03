/** Phase 38: an in-memory provider for the engine's tests, and the harness the contract runs it with. */
import type {
  BoardProvider,
  ExternalBoard,
  ExternalItem,
  PullResult,
  StatusField,
} from "../src/boardsync/provider.ts";
import { FlightdeckError } from "../src/errors.ts";
import type { ContractHarness } from "./boardsync-contract.ts";

export const BOARD: ExternalBoard = {
  id: "PVT_board1",
  title: "Roadmap",
  owner: "acme",
  number: 3,
  url: "https://github.com/orgs/acme/projects/3",
};

export const STATUS_FIELD: StatusField = {
  fieldId: "PVTSSF_status",
  options: [
    { id: "o1", name: "Todo" },
    { id: "o2", name: "In Progress" },
    { id: "o3", name: "In Review" },
    { id: "o4", name: "Done" },
  ],
};

const refuse = (reason: string, params?: Record<string, string>) =>
  new FlightdeckError("invalid_state", reason, reason, params);

export class FakeProvider implements BoardProvider {
  readonly kind = "fake";
  items: ExternalItem[] = [];
  scope = { read: true, write: true };
  hasStatus = true;
  pageSize = 100;
  setStatusCalls: Array<{ itemId: string; optionId: string }> = [];
  /** What `setStatus` answers as the time of the change. */
  now = () => new Date().toISOString();
  /** Asked of every call: a test makes the provider fail by throwing here. */
  beforeCall: (method: string) => void = () => {};

  private check(method: string, boardId?: string) {
    this.beforeCall(method);
    if (boardId !== undefined && boardId !== BOARD.id) throw refuse("board_not_found", { boardId });
  }

  async scopes() {
    this.beforeCall("scopes");
    return { ...this.scope };
  }

  async listBoards(): Promise<ExternalBoard[]> {
    this.check("listBoards");
    return [BOARD];
  }

  async statusField(boardId: string): Promise<StatusField | null> {
    this.check("statusField", boardId);
    return this.hasStatus ? STATUS_FIELD : null;
  }

  /** The cursor is a digest of the items: the same board gives the same cursor. */
  private cursorOf(): string {
    return JSON.stringify(
      this.items.map((item) => [item.id, item.status, item.updatedAt, item.title]),
    );
  }

  async pull(boardId: string, since?: string): Promise<PullResult> {
    this.check("pull", boardId);
    const cursor = this.cursorOf();
    if (since !== undefined && since === cursor) {
      return { items: [], cursor, notModified: true, truncated: false, redacted: 0 };
    }
    const items: ExternalItem[] = [];
    for (let at = 0; at < this.items.length; at += this.pageSize) {
      items.push(...this.items.slice(at, at + this.pageSize).map((item) => ({ ...item })));
    }
    return {
      items,
      cursor,
      notModified: false,
      truncated: false,
      redacted: items.filter((item) => item.content === null).length,
    };
  }

  async setStatus(
    boardId: string,
    itemId: string,
    optionId: string,
  ): Promise<{ updatedAt: string }> {
    this.check("setStatus", boardId);
    if (!this.scope.write) throw refuse("board_sync_scope_missing", { scope: "project" });
    const option = STATUS_FIELD.options.find((candidate) => candidate.id === optionId);
    const target = this.items.find((candidate) => candidate.id === itemId);
    if (!option) throw refuse("board_sync_option_not_found", { option: optionId });
    if (!target) throw refuse("board_not_found", { itemId });
    this.setStatusCalls.push({ itemId, optionId });
    target.status = option.name;
    target.updatedAt = this.now();
    return { updatedAt: target.updatedAt };
  }
}

export function fakeHarness(): ContractHarness {
  const fake = new FakeProvider();
  return {
    provider: fake,
    boardId: BOARD.id,
    conditional: true,
    seed: (items) => {
      fake.items = items.map((item) => ({ ...item }));
    },
    setScopes: (scopes) => {
      fake.scope = scopes;
    },
    setHasStatus: (has) => {
      fake.hasStatus = has;
    },
    setPageSize: (size) => {
      fake.pageSize = size;
    },
    mutations: () => fake.setStatusCalls.length,
  };
}
