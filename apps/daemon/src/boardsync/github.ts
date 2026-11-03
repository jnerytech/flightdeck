/**
 * Phase 38: GitHub Projects (v2) as a `BoardProvider`, through the host's `gh api graphql`: the
 * daemon holds no token. Query text is constant and every value goes as a variable.
 */
import type { GhRunner } from "../github/gh.ts";
import type { BoardProvider, ExternalBoard, PullResult, StatusField } from "./provider.ts";

export interface GithubBoardsOptions {
  gh: GhRunner;
}

export class GithubBoards implements BoardProvider {
  readonly kind = "github-projects";

  constructor(private readonly opts: GithubBoardsOptions) {}

  async scopes(): Promise<{ read: boolean; write: boolean }> {
    void this.opts;
    return { read: false, write: false };
  }

  async listBoards(): Promise<ExternalBoard[]> {
    return [];
  }

  async statusField(_boardId: string): Promise<StatusField | null> {
    return null;
  }

  async pull(_boardId: string, _since?: string): Promise<PullResult> {
    return { items: [], cursor: "", notModified: true, truncated: true, redacted: 1 };
  }

  async setStatus(
    _boardId: string,
    _itemId: string,
    _optionId: string,
  ): Promise<{ updatedAt: string }> {
    return { updatedAt: "" };
  }
}
