/** Stub. */
import type { Board } from "../board/board.ts";
import type { Card } from "../board/types.ts";
import type { AutoApprover } from "../permissions/auto-approve.ts";

export type { Issue } from "@flightdeck/protocol";

import type { Issue } from "@flightdeck/protocol";

export interface IssuesOptions {
  board: Board;
  /** Where a card from a third-party issue is suspended. */
  autoApprove?: Pick<AutoApprover, "suspend">;
}

/** Stub. */
export class Issues {
  constructor(readonly opts: IssuesOptions) {}

  async list(_projectId: string, _query?: string): Promise<Issue[]> {
    return [];
  }

  async get(_projectId: string, _id: string): Promise<Issue> {
    return {
      ref: "",
      id: "",
      title: "",
      body: "",
      url: "",
      author: "",
      labels: [],
      external: false,
      createdAt: "",
    };
  }

  async createCard(_projectId: string, _issueRef: string): Promise<Card> {
    return this.opts.board.createCard(_projectId, { title: "", description: "" });
  }
}
