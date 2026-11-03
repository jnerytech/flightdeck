/** Phase 38: an in-memory provider for the engine's tests, and the harness the contract runs it with. */
import type {
  BoardProvider,
  ExternalBoard,
  ExternalItem,
  PullResult,
  StatusField,
} from "../src/boardsync/provider.ts";
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

export class FakeProvider implements BoardProvider {
  readonly kind = "fake";
  items: ExternalItem[] = [];
  scope = { read: true, write: true };
  hasStatus = true;
  pageSize = 100;
  version = 0;
  setStatusCalls: Array<{ itemId: string; optionId: string }> = [];
  now = () => new Date().toISOString();

  async scopes() {
    return { read: false, write: false };
  }
  async listBoards(): Promise<ExternalBoard[]> {
    return [];
  }
  async statusField(): Promise<StatusField | null> {
    return null;
  }
  async pull(): Promise<PullResult> {
    return { items: [], cursor: "", notModified: true, truncated: true, redacted: 1 };
  }
  async setStatus(): Promise<{ updatedAt: string }> {
    return { updatedAt: "" };
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
      fake.version += 1;
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
