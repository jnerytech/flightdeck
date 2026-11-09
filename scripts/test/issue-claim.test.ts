import { describe, expect, test } from "bun:test";
import type { GhResult } from "../lib/ci-branch.ts";
import {
  claimIssue,
  currentOwner,
  marksOf,
  type OwnerMark,
  ownerMark,
} from "../lib/issue-claim.ts";

/**
 * Issue #1410: a session claims an issue before it starts. Every `gh` here is a fake that answers
 * by its arguments and records what was asked; nothing reaches GitHub.
 */

const mark = (owner: string, status: OwnerMark["status"], at = "t"): OwnerMark => ({
  owner,
  status,
  at,
});
const note = (owner: string, status: OwnerMark["status"], text = "work") => ({
  body: `${owner}: ${text}\n\n${ownerMark(owner, status)}`,
  createdAt: "2026-11-09T10:00:00Z",
});

function fakeGh(opts: {
  state?: "OPEN" | "CLOSED" | null;
  comments?: Array<{ body: string; createdAt: string }>;
  /** What the second read answers (a claim made at the same moment by another session). */
  afterPost?: Array<{ body: string; createdAt: string }>;
  /** The comments' listing answers this text instead (not JSON lines). */
  commentsText?: string;
  /** `gh issue comment` fails with this stderr. */
  commentFails?: string;
}) {
  const asked: string[][] = [];
  let posted = false;
  // As GitHub does, a posted comment is there when the issue is read again.
  const comments = [...(opts.comments ?? [])];
  const gh = async (args: string[]): Promise<GhResult> => {
    asked.push(args);
    if (args[0] === "issue" && args[1] === "view") {
      const state = opts.state === undefined ? "OPEN" : opts.state;
      return { code: 0, stdout: JSON.stringify(state === null ? {} : { state }) };
    }
    // Every page of the comments, one JSON object per line (gh api --paginate --jq '.[]').
    if (args[0] === "api" && args.includes("--paginate")) {
      if (opts.commentsText !== undefined) return { code: 0, stdout: opts.commentsText };
      const listed = posted && opts.afterPost ? opts.afterPost : comments;
      return { code: 0, stdout: listed.map((c) => JSON.stringify(c)).join("\n") };
    }
    if (args[0] === "issue" && args[1] === "comment" && opts.commentFails) {
      return { code: 1, stdout: "", stderr: opts.commentFails };
    }
    if (args[0] === "issue" && args[1] === "comment") {
      comments.push({
        body: args[args.indexOf("--body") + 1] ?? "",
        createdAt: "2026-11-09T11:00:00Z",
      });
      posted = true;
      return { code: 0, stdout: "https://github.com/o/r/issues/7#issuecomment-1\n" };
    }
    return { code: 1, stdout: "", stderr: `unexpected gh ${args.join(" ")}` };
  };
  return { gh, asked };
}

function claim(
  args: string[],
  fake: ReturnType<typeof fakeGh>,
  over: { session?: string; coordinator?: boolean } = {},
) {
  const lines: string[] = [];
  return {
    lines,
    code: claimIssue(args, {
      gh: fake.gh,
      log: (l) => lines.push(l),
      coordinator: over.coordinator ?? false,
      ...(over.session ? { session: over.session } : {}),
    }),
  };
}

const posts = (asked: string[][]) => asked.filter((a) => a[0] === "issue" && a[1] === "comment");
const bodyOf = (post: string[] | undefined) => post?.[post.indexOf("--body") + 1] ?? "";

describe("issue-claim: one session owns an issue (#1410)", () => {
  test("a marker round-trips, and issue text around it is data", () => {
    expect(ownerMark("fd-harness", "progress")).toBe(
      "<!-- flightdeck-owner: fd-harness status: progress -->",
    );
    const marks = marksOf([
      note("fd-harness", "progress"),
      { body: "no marker here", createdAt: "x" },
      { body: "<!-- flightdeck-owner: bad name! status: progress -->", createdAt: "y" },
      note("fd-harness", "ready"),
    ]);
    expect(marks.map((m) => `${m.owner}:${m.status}`)).toEqual([
      "fd-harness:progress",
      "fd-harness:ready",
    ]);
  });

  test("the first claim since a release owns it; a later claim by another session is ignored", () => {
    expect(currentOwner([])).toBeNull();
    expect(
      currentOwner([mark("fd-ux-designer", "progress"), mark("fd-frontend", "progress")]),
    ).toBe("fd-ux-designer");
    // Only the owner or the coordinator releases it.
    expect(currentOwner([mark("fd-a", "progress"), mark("fd-b", "ready")])).toBe("fd-a");
    expect(
      currentOwner([mark("fd-a", "progress"), mark("fd-a", "ready"), mark("fd-b", "progress")]),
    ).toBe("fd-b");
    expect(currentOwner([mark("fd-a", "progress"), mark("fd-coordinator", "done")])).toBeNull();
    // The coordinator hands it over.
    expect(currentOwner([mark("fd-a", "progress"), mark("fd-b", "reassign")])).toBe("fd-b");
  });

  test("a claim on a free issue posts the marker and says so", async () => {
    const fake = fakeGh({ comments: [] });
    const r = claim(["7", "--by", "fd-harness"], fake);
    expect(await r.code).toBe(0);
    expect(bodyOf(posts(fake.asked)[0])).toContain(ownerMark("fd-harness", "progress"));
    expect(r.lines).toEqual(["claimed #7 for fd-harness"]);
  });

  test("a claim on an issue another session owns is refused, names the owner, and posts nothing", async () => {
    const fake = fakeGh({ comments: [note("fd-ux-designer", "progress")] });
    const r = claim(["7", "--by", "fd-frontend"], fake);
    expect(await r.code).toBe(1);
    expect(posts(fake.asked)).toEqual([]);
    expect(r.lines).toEqual([
      "#7 is owned by fd-ux-designer: ask fd-coordinator to reassign it (bun run claim 7 --by <session> --reassign)",
    ]);
  });

  test("the owner's own claim is accepted again; FLIGHTDECK_SESSION names the session", async () => {
    const fake = fakeGh({ comments: [note("fd-ux-designer", "progress")] });
    const r = claim(["7"], fake, { session: "fd-ux-designer" });
    expect(await r.code).toBe(0);
    expect([posts(fake.asked).length, r.lines]).toEqual([
      0,
      ["#7 is already yours (fd-ux-designer)"],
    ]);
  });

  test("of two claims at the same moment only the first stands: the later one is refused", async () => {
    const fake = fakeGh({
      comments: [],
      afterPost: [note("fd-frontend", "progress"), note("fd-ux-designer", "progress")],
    });
    const r = claim(["7", "--by", "fd-ux-designer"], fake);
    expect(await r.code).toBe(1);
    expect(r.lines.at(-1)).toBe(
      "#7 is owned by fd-frontend: ask fd-coordinator to reassign it (bun run claim 7 --by <session> --reassign)",
    );
  });

  test("only the coordinator reassigns; a closed issue and a missing session are refused", async () => {
    const owned = { comments: [note("fd-a", "progress")] };
    const coordinator = fakeGh(owned);
    expect(
      await claim(["7", "--by", "fd-b", "--reassign"], coordinator, { coordinator: true }).code,
    ).toBe(0);
    expect(bodyOf(posts(coordinator.asked)[0])).toContain(ownerMark("fd-b", "reassign"));
    const worker = fakeGh(owned);
    const refused = claim(["7", "--by", "fd-b", "--reassign"], worker);
    expect([await refused.code, posts(worker.asked).length]).toEqual([1, 0]);
    expect(refused.lines).toEqual(["only fd-coordinator reassigns an issue"]);
    const closed = fakeGh({ state: "CLOSED" });
    const r = claim(["7", "--by", "fd-b"], closed);
    expect([await r.code, r.lines, posts(closed.asked).length]).toEqual([
      1,
      ["#7 is closed: there is nothing to claim"],
      0,
    ]);
    const nobody = claim(["7"], fakeGh({}));
    expect(await nobody.code).toBe(2);
    expect(nobody.lines[0] ?? "").toContain("usage: bun run claim <issue> [--by <session>]");
  });

  test("a gh that fails or answers something else is one line and exit 1", async () => {
    const down = async (): Promise<GhResult> => ({ code: 1, stdout: "", stderr: "HTTP 502" });
    const lines: string[] = [];
    expect(
      await claimIssue(["7", "--by", "fd-a"], {
        gh: down,
        log: (l) => lines.push(l),
        coordinator: false,
      }),
    ).toBe(1);
    expect(lines).toEqual(["claim: gh could not read #7: HTTP 502"]);
  });

  test("from the review: strict arguments, the marker last in its comment, and an unknown state is an error", async () => {
    for (const args of [
      ["7", "--by", "--reassign"],
      ["1e3", "--by", "fd-a"],
      ["--by", "fd-a"],
      ["7", "--by", "-x"],
    ]) {
      const fake = fakeGh({});
      const r = claim(args, fake);
      expect([args.join(" "), await r.code, posts(fake.asked).length]).toEqual([
        args.join(" "),
        2,
        0,
      ]);
    }
    // A quoted marker inside a reply is no marker: only the comment's last line counts.
    const quoted = `> ${ownerMark("fd-a", "progress")}\n\nI disagree`;
    expect(marksOf([{ body: quoted, createdAt: "t" }])).toEqual([]);
    const noState = fakeGh({ state: null });
    const lines: string[] = [];
    expect(
      await claimIssue(["7", "--by", "fd-a"], {
        gh: noState.gh,
        log: (l) => lines.push(l),
        coordinator: false,
      }),
    ).toBe(1);
    expect(lines[0] ?? "").toContain("claim: gh could not read #7");
  });

  test("from the review: the comments are read in time order, over every page", async () => {
    const fake = fakeGh({
      comments: [
        { body: `x\n\n${ownerMark("fd-b", "progress")}`, createdAt: "2026-11-09T12:00:00Z" },
        { body: `x\n\n${ownerMark("fd-a", "progress")}`, createdAt: "2026-11-09T09:00:00Z" },
      ],
    });
    const r = claim(["7", "--by", "fd-b"], fake);
    expect(await r.code).toBe(1);
    expect(r.lines[0] ?? "").toStartWith("#7 is owned by fd-a");
    const list = fake.asked.find((a) => a[0] === "api");
    expect([
      list?.includes("--paginate"),
      list?.some((a) => a.endsWith("/issues/7/comments")),
    ]).toEqual([true, true]);
  });

  test("from the review: a loser's claim stays ignored, and the owner's release frees the issue", () => {
    expect(
      currentOwner([mark("fd-a", "progress"), mark("fd-b", "progress"), mark("fd-a", "ready")]),
    ).toBeNull();
  });

  test("from the review: --release posts the release, the owner's or the coordinator's", async () => {
    const owned = fakeGh({ comments: [note("fd-a", "progress")] });
    const r = claim(["7", "--by", "fd-a", "--release"], owned);
    expect([await r.code, r.lines]).toEqual([0, ["released #7 (fd-a)"]]);
    expect(bodyOf(posts(owned.asked)[0])).toContain(ownerMark("fd-a", "todo"));
    const other = fakeGh({ comments: [note("fd-a", "progress")] });
    const refused = claim(["7", "--by", "fd-b", "--release"], other);
    expect([await refused.code, posts(other.asked).length]).toEqual([1, 0]);
    expect(refused.lines[0] ?? "").toStartWith("#7 is owned by fd-a");
  });

  test("from the review: output that is not JSON lines, and a comment gh refuses, are one line and exit 1", async () => {
    const garbled = fakeGh({ commentsText: "<html>proxy</html>" });
    const a = claim(["7", "--by", "fd-a"], garbled);
    expect([await a.code, posts(garbled.asked).length]).toEqual([1, 0]);
    expect(a.lines[0] ?? "").toContain("claim: gh could not read #7");
    const refused = fakeGh({ commentFails: "HTTP 403" });
    const b = claim(["7", "--by", "fd-a"], refused);
    expect([await b.code, b.lines]).toEqual([1, ["claim: gh could not comment on #7: HTTP 403"]]);
  });
});
