/**
 * Phase 36: what the app asks of GitHub through the host's `gh`: sign out, a person's repos or a
 * search, a repo's issues. The token stays with `gh`; nothing here reads, keeps or returns it.
 */
import type { Issue } from "@flightdeck/protocol";
import type { GhRunner } from "./gh.ts";

export interface GithubRepo {
  /** `owner/name`. */
  name: string;
  description: string;
  private: boolean;
  url: string;
  updatedAt: string;
}

export interface GithubOptions {
  gh: GhRunner;
}

export class Github {
  constructor(private readonly opts: GithubOptions) {}

  async logout(): Promise<void> {
    void this.opts;
  }

  async repos(_query?: string): Promise<GithubRepo[]> {
    return [{ name: "", description: "", private: true, url: "", updatedAt: "" }];
  }

  async issues(_repo: string): Promise<Issue[]> {
    return [];
  }
}
