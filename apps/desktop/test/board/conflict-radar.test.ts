import { describe, expect, test } from "bun:test";
import { radarBadge, radarMergeLine } from "../../src/features/board/domain/conflict-radar.ts";
import { translator } from "../../src/i18n/index.ts";

/**
 * #1405: the host says which cards of the project change the same files. The badge names the card
 * (or counts them), and the Merge PR confirm says merging may leave them with conflicts.
 */
const t = translator("en");
const tPt = translator("pt-BR");
const overlap = (cardId: string, title: string, files = ["src/a.ts"]) => ({ cardId, title, files });
const card = (mayConflict?: object[]) => ({ id: "c1", mayConflict }) as never;

describe("conflict-radar: the words for cards that change the same files (#1405)", () => {
  test("no overlap, an empty list, or a host that does not report it says nothing", () => {
    expect([
      radarBadge(card(), t),
      radarBadge(card([]), t),
      radarMergeLine(card(), t),
      radarMergeLine(card([]), t),
    ]).toEqual([null, null, null, null]);
  });

  test("the badge names the one card, or counts several", () => {
    expect([
      radarBadge(card([overlap("c2", "Fix login")]), t),
      radarBadge(card([overlap("c2", "Fix login"), overlap("c3", "Rename user")]), t),
    ]).toEqual(["May conflict with Fix login", "May conflict with 2 cards"]);
  });

  test("the merge line lists the cards that change the same files", () => {
    expect(
      radarMergeLine(card([overlap("c2", "Fix login"), overlap("c3", "Rename user")]), t),
    ).toBe(
      "Other cards change the same files: Fix login, Rename user. Whoever merges second may have to resolve conflicts.",
    );
  });

  test("in pt-BR the words are translated", () => {
    expect([
      radarBadge(card([overlap("c2", "Fix login")]), tPt),
      radarBadge(card([overlap("c2", "a"), overlap("c3", "b")]), tPt),
      radarMergeLine(card([overlap("c2", "Fix login")]), tPt),
    ]).toEqual([
      "Pode conflitar com Fix login",
      "Pode conflitar com 2 cards",
      "Outros cards mudam os mesmos arquivos: Fix login. Quem fizer o merge depois pode ter de resolver conflitos.",
    ]);
  });
});
