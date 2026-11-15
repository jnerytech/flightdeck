import { SecretScanner } from "@flightdeck/protocol";
import type { ContextDeps } from "../../src/assistant/context.ts";
import { FlightdeckError } from "../../src/kernel/errors.ts";

/** Deps over a real repository; a card is a branch of it against `main`. */
export function deps(repo: string): ContextDeps {
  return {
    card: (cardId) => {
      if (cardId !== "c1") throw new FlightdeckError("not_found", "no card", "card_not_found");
      return { worktree: repo, base: "main" };
    },
    allowed: async (cwd) => cwd,
    scanner: new SecretScanner(),
  };
}
