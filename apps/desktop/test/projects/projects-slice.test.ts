import { describe, expect, test } from "bun:test";
import type { Project, ProjectDetectResult } from "@flightdeck/protocol";
import { ProjectsSlice } from "../../src/features/projects/index.ts";
import { translator } from "../../src/i18n/index.ts";
import type { HostResult } from "../../src/lib/app-store.ts";

const project = (id: string, extra: Partial<Project> = {}): Project =>
  ({ id, name: id, path: `/work/${id}`, prProvider: null, ...extra }) as never;

type Detected = HostResult<ProjectDetectResult>;

/** A slice over stand-ins: the projects it holds, what a host answered, what the person was told. */
function projects(
  over: {
    listed?: { projects: Project[] } | null;
    detected?: Detected;
    held?: Record<string, Project[]>;
  } = {},
) {
  let held = over.held ?? {};
  const said: string[] = [];
  const refused: string[] = [];
  const asked: string[] = [];
  const slice = new ProjectsSlice({
    state: () => ({ hosts: [{ id: "h1", name: "alfa" }], projects: held }) as never,
    setProjects: (next) => {
      held = next;
    },
    quietly: (async (hostId: string, type: string) => {
      asked.push(`${hostId}:${type}`);
      return over.listed ?? null;
    }) as never,
    request: (async () => over.detected) as never,
    refused: (hostId, refusal) => void refused.push(`${hostId}:${refusal.code}`),
    success: (text) => void said.push(text),
    t: () => translator("en"),
  });
  return { slice, held: () => held, said, refused, asked };
}

describe("projects slice", () => {
  test("a host's list goes into the state and comes back", async () => {
    const { slice, held, asked } = projects({ listed: { projects: [project("p1")] } });
    const list = await slice.load("h1");
    expect(list?.map((p) => p.id)).toEqual(["p1"]);
    expect(held().h1?.map((p) => p.id)).toEqual(["p1"]);
    expect(asked).toEqual(["h1:project.list"]);
  });

  test("a host that gives no list leaves what the app holds", async () => {
    const { slice, held } = projects({ listed: null, held: { h1: [project("kept")] } });
    expect(await slice.load("h1")).toBeNull();
    expect(held().h1?.map((p) => p.id)).toEqual(["kept"]);
  });

  test("remembering a host's projects leaves the other hosts' alone", () => {
    const { slice, held } = projects({ held: { h2: [project("other")] } });
    slice.remember("h1", [project("p1")]);
    expect(Object.keys(held()).sort()).toEqual(["h1", "h2"]);
  });

  test("a project's key is the daemon's, else the one its folder would have", () => {
    const { slice } = projects();
    expect(slice.keyOf("h1", project("p1", { projectKey: "daemon-key" } as never))).toBe(
      "daemon-key",
    );
    expect(slice.keyOf("h1", project("p1"))).toBe("host:alfa:/work/p1");
    expect(slice.keyOf("ghost", project("p1"))).toBe("host:ghost:/work/p1");
  });

  test("a provider the host read replaces the project in its list and is said", async () => {
    const found = project("p1", { prProvider: "github" } as never);
    const { slice, held, said } = projects({
      held: { h1: [project("p0"), project("p1")] },
      detected: { ok: true, data: { project: found, outcome: "set" } as never },
    });
    const result = await slice.detectProvider("h1", "p1");
    expect(result?.outcome).toBe("set");
    expect(held().h1?.map((p) => p.id)).toEqual(["p0", "p1"]);
    expect(held().h1?.[1]?.prProvider).toBe("github");
    expect(said).toHaveLength(1);
  });

  test("a project the list did not hold is added at the end", async () => {
    const { slice, held } = projects({
      held: { h1: [project("p0")] },
      detected: { ok: true, data: { project: project("p1"), outcome: "unchanged" } as never },
    });
    await slice.detectProvider("h1", "p1");
    expect(held().h1?.map((p) => p.id)).toEqual(["p0", "p1"]);
  });

  test("no remote is said only when the person pressed", async () => {
    const detected: Detected = {
      ok: true,
      data: { project: project("p1"), outcome: "no_remote" } as never,
    };
    const quiet = projects({ detected });
    await quiet.slice.detectProvider("h1", "p1");
    expect(quiet.said).toEqual([]);
    const pressed = projects({ detected });
    await pressed.slice.detectProvider("h1", "p1", true);
    expect(pressed.said).toHaveLength(1);
  });

  test("a refusal reaches the person only when they pressed, and changes nothing", async () => {
    const detected: Detected = { ok: false, code: "no_git", message: "no repo" };
    const silent = projects({ detected, held: { h1: [project("p0")] } });
    expect(await silent.slice.detectProvider("h1", "p1")).toBeNull();
    expect(silent.refused).toEqual([]);
    const pressed = projects({ detected, held: { h1: [project("p0")] } });
    expect(await pressed.slice.detectProvider("h1", "p1", true)).toBeNull();
    expect(pressed.refused).toEqual(["h1:no_git"]);
    expect(pressed.held().h1?.map((p) => p.id)).toEqual(["p0"]);
  });
});
