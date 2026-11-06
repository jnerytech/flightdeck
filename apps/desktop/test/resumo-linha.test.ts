import { describe, expect, test } from "bun:test";
import type { SessionRecap } from "@flightdeck/protocol";
import { recapPreview } from "../src/lib/recap-preview.ts";

const recap = (over: Partial<SessionRecap> = {}): SessionRecap => ({
  asked: "Add a retry to the queue",
  done: "Retry added with backoff.",
  files: [],
  filesMore: 0,
  costUsd: null,
  question: null,
  state: "idle",
  source: "transcript",
  ...over,
});

describe("resumo-linha: the one line of a folded summary (issue #97)", () => {
  test("what was done comes first, else what was asked, else nothing", () => {
    expect(recapPreview(recap())).toBe("Retry added with backoff.");
    expect(recapPreview(recap({ done: null }))).toBe("Add a retry to the queue");
    expect(recapPreview(recap({ done: null, asked: null }))).toBe("");
  });

  test("markdown marks and line breaks are gone, so it reads as one plain line", () => {
    expect(
      recapPreview(
        recap({
          done: "A chave da **Isabela** está em `/home/dev/x.md`.\n- Alias: **abc**\n\n- E-mail",
        }),
      ),
    ).toBe("A chave da Isabela está em /home/dev/x.md. Alias: abc E-mail");
  });

  test("a very long summary is cut with an ellipsis at 160 characters", () => {
    const line = recapPreview(recap({ done: "palavra ".repeat(60) }));
    expect(line.length).toBeLessThanOrEqual(160);
    expect(line.endsWith("…")).toBe(true);
  });
});
