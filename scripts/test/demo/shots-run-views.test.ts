import { describe, expect, test } from "bun:test";
import { isPreviewUrl } from "@flightdeck/protocol";
import type { DemoIds } from "../../demo-seed.ts";
import { narrowSizes } from "../../lib/shots/narrow.ts";
import { runViewShots } from "../../lib/shots/table-run-views.ts";
import type { WireRule } from "../../lib/shots/wire.ts";

const IDS = { project: "p1", gateCard: "c9", gateRunId: "run9" } as DemoIds;
const shots = runViewShots(IDS);
const names = shots.map((shot) => shot.name);

const PREVIEWS = ["previa-ambiente", "previa-recusada"];
const TIMELINES = [
  "card-run-rodando",
  "card-run-cota",
  "card-run-falhou",
  "card-run-tentativa",
  "card-run-passo-longo",
];

const shotOf = (name: string) => shots.find((shot) => shot.name === name);
const wireOf = (name: string): WireRule[] => shotOf(name)?.wire ?? [];
const runOf = (name: string): Run | undefined => {
  const rule = wireOf(name).find((r) => r.command === "run.get");
  return rule && "reply" in rule ? (rule.reply as Run) : undefined;
};

type Step = { stepId: string; attempt: number; status: string; startedAt: string };
type Run = {
  id: string;
  cardId: string;
  status: string;
  quotaUntil: string | null;
  reasonKey: string | null;
  steps: Step[];
};

describe("the preview page and the workflow timeline's prints (#4287)", () => {
  test("every state of the issue has a print of its own, and no name is printed twice", () => {
    expect([
      [...PREVIEWS, ...TIMELINES].filter((name) => !names.includes(name)),
      names.length,
    ]).toEqual([[], new Set(names).size]);
  });

  test("the preview prints open the page: one with a loopback address, one with an address that is refused", () => {
    const route = (name: string) =>
      shotOf(name)?.route as { name: string; url?: string } | undefined;
    expect(PREVIEWS.map((name) => route(name)?.name)).toEqual(["preview", "preview"]);
    expect([
      isPreviewUrl(route("previa-ambiente")?.url ?? ""),
      isPreviewUrl(route("previa-recusada")?.url ?? "x"),
    ]).toEqual([true, false]);
  });

  test("every timeline print is the gate card's page, and the page itself answers the run, so no run is touched", () => {
    const wrong = TIMELINES.filter((name) => {
      const route = shotOf(name)?.route as { name: string; cardId?: string } | undefined;
      const rules = wireOf(name);
      return (
        route?.name !== "card" ||
        route.cardId !== IDS.gateCard ||
        rules
          .map((r) => r.command)
          .sort()
          .join() !== "run.get,run.watch" ||
        rules.some((r) => !("reply" in r))
      );
    });
    expect(wrong).toEqual([]);
    expect(TIMELINES.filter((name) => runOf(name)?.id !== IDS.gateRunId)).toEqual([]);
  });

  test("every print is re-measured narrow, and waits for what it shows", () => {
    expect(
      [...PREVIEWS, ...TIMELINES].filter((name) => narrowSizes("dark", name).length === 0),
    ).toEqual([]);
    expect(
      [...PREVIEWS, ...TIMELINES].filter((name) => shotOf(name)?.prepare === undefined),
    ).toEqual([]);
  });

  test("the running timeline has a step running now; the quota one waits for a time to come", () => {
    expect(runOf("card-run-rodando")?.steps.some((s) => s.status === "running")).toBe(true);
    expect([runOf("card-run-cota")?.status, runOf("card-run-cota")?.quotaUntil]).toEqual([
      "running",
      "{in 1800s}",
    ]);
  });

  test("the failed timeline says why with a key the app translates", () => {
    const run = runOf("card-run-falhou");
    expect([run?.status, typeof run?.reasonKey]).toEqual(["failed", "string"]);
  });

  test("the retried timeline has a step with two attempts, the first failed; the long one has a step id over 60 characters", () => {
    const attempts = (runOf("card-run-tentativa")?.steps ?? []).filter((s) => s.attempt > 1);
    expect(attempts.length).toBeGreaterThan(0);
    const first = (runOf("card-run-tentativa")?.steps ?? []).find(
      (s) => s.stepId === attempts[0]?.stepId && s.attempt === 1,
    );
    expect(first?.status).toBe("failed");
    expect((runOf("card-run-passo-longo")?.steps ?? []).some((s) => s.stepId.length > 60)).toBe(
      true,
    );
  });

  test("the steps' times are relative to the print, so a running step reads seconds, not days", () => {
    const times = TIMELINES.flatMap((name) => (runOf(name)?.steps ?? []).map((s) => s.startedAt));
    expect([times.length > 0, times.filter((time) => !/^\{in -\d+s\}$/.test(time))]).toEqual([
      true,
      [],
    ]);
  });
});

/** What a print's `prepare` did on a page that runs the callbacks it is given. */
type Seen = { waits: string[]; attributes: string[]; scripts: string[]; scriptFrames: string[] };

async function prepared(name: string): Promise<Seen> {
  const seen: Seen = { waits: [], attributes: [], scripts: [], scriptFrames: [] };
  const word = (arg: unknown): string => (arg instanceof RegExp ? arg.source : String(arg));
  const target = (label: string): Record<string, unknown> => ({
    getByRole: (role: string, options?: { name?: unknown }) =>
      target(`${label} > ${role} ${word(options?.name)}`),
    getByText: (text: unknown) => target(`${label} > text ${word(text)}`),
    waitFor: async () => {
      seen.waits.push(label);
    },
    evaluate: async (run: (el: unknown, arg: unknown) => void, arg: unknown) =>
      run(
        { setAttribute: (key: string, value: string) => seen.attributes.push(`${key}=${value}`) },
        arg,
      ),
  });
  const frame = (label: string) => ({
    addScriptTag: async (options: { path: string }) => {
      seen.scripts.push(options.path);
      seen.scriptFrames.push(label);
    },
  });
  const main = frame("main");
  const page = {
    ...target("page"),
    locator: (selector: string) => target(`locator ${selector}`),
    frameLocator: (selector: string) => target(`frame ${selector}`),
    frames: () => [main, frame("inner")],
    mainFrame: () => main,
  };
  await shotOf(name)?.prepare?.(page as never);
  return seen;
}

describe("what each preview and timeline print waits for (#4287)", () => {
  test("the preview print fills the frame with its own page, waits for it, and gives that frame axe", async () => {
    const seen = await prepared("previa-ambiente");
    expect(
      seen.attributes.some((a) => a.startsWith("srcdoc=") && a.includes("<h1>Cart</h1>")),
    ).toBe(true);
    expect(
      seen.waits.some((wait) => wait.startsWith("frame iframe") && wait.includes("Cart")),
    ).toBe(true);
    // The print's axe run asks every frame: the frame without axe would hold it for a minute.
    expect([seen.scriptFrames, seen.scripts.every((path) => path.endsWith("axe.min.js"))]).toEqual([
      ["inner"],
      true,
    ]);
  });

  test("the refused preview waits for the refusal in both languages", async () => {
    const seen = await prepared("previa-recusada");
    expect(
      seen.waits.some((wait) => wait.includes("Only 127") && wait.includes("localhost abrem aqui")),
    ).toBe(true);
  });

  test("each timeline waits for its own title: the status in both languages", async () => {
    const waits = async (name: string) => (await prepared(name)).waits.join("\n");
    expect(await waits("card-run-rodando")).toMatch(
      /Workflow run.*Workflow feature.*running\|em andamento/,
    );
    expect(await waits("card-run-cota")).toMatch(/running\|em andamento/);
    expect(await waits("card-run-falhou")).toMatch(/failed\|falhou/);
    expect(await waits("card-run-passo-longo")).toMatch(/running\|em andamento/);
  });
});
