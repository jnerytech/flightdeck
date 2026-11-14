import { describe, expect, test } from "bun:test";
import { takesEffort } from "../../src/features/personas/index.ts";
import {
  bypassAsked,
  chosenProject,
  confirmCopy,
  createPayload,
  effortOffered,
  memberPayload,
  type NewTeamForm,
  offeredChoice,
} from "../../src/features/teams/domain/new-team.ts";
import { translator } from "../../src/i18n/index.ts";

const t = translator("en");

const form = (over: Partial<NewTeamForm> = {}): NewTeamForm => ({
  projectId: "p1",
  goal: "ship it",
  name: "",
  persona: "",
  model: "",
  effort: "",
  permission: "",
  rows: [
    { persona: null, model: "", effort: "" as const, permission: "" },
    { persona: null, model: "", effort: "" as const, permission: "" },
  ],
  workerDefault: "",
  modes: { offered: true, allowBypass: true },
  efforts: true,
  personaModels: {},
  ...over,
});

describe("new-team: what the form sends", () => {
  test("a form with only a goal sends the project, the goal and the worker count", () => {
    expect(createPayload(form())).toEqual({ projectId: "p1", goal: "ship it", workers: 2 });
  });

  test("a name is trimmed, and a blank one is left out", () => {
    expect(createPayload(form({ name: "  squad " })).name).toBe("squad");
    expect("name" in createPayload(form({ name: "   " }))).toBe(false);
  });

  test("workers with no persona of their own take the host's Developer when it has one", () => {
    const sent = createPayload(form({ workerDefault: "dev" }));
    expect(sent.workerPersonas).toEqual(["dev", "dev"]);
    const mixed = createPayload(
      form({
        workerDefault: "dev",
        rows: [
          { persona: "host:qa", model: "", effort: "" as const, permission: "" },
          { persona: null, model: "", effort: "" as const, permission: "" },
        ],
      }),
    );
    expect(mixed.workerPersonas).toEqual(["host:qa", "dev"]);
  });

  test("the coordinator's persona and model go along, and worker models keep their row", () => {
    const sent = createPayload(
      form({
        persona: "host:lead",
        model: "opus",
        rows: [
          { persona: null, model: "sonnet", effort: "" as const, permission: "" },
          { persona: null, model: "", effort: "" as const, permission: "" },
        ],
      }),
    );
    expect(sent.coordinatorPersona).toBe("host:lead");
    expect(sent.coordinatorModel).toBe("opus");
    expect(sent.workerModels).toEqual(["sonnet", null]);
  });

  test("permission modes go only to a host that takes them, an unset worker as null", () => {
    const rows = [
      { persona: null, model: "", effort: "" as const, permission: "plan" as const },
      { persona: null, model: "", effort: "" as const, permission: "" as const },
    ];
    const sent = createPayload(form({ permission: "acceptEdits", rows }));
    expect(sent.coordinatorPermission).toBe("acceptEdits");
    expect(sent.workerPermissions).toEqual(["plan", null]);
    const unsupported = createPayload(
      form({ permission: "acceptEdits", rows, modes: { offered: false, allowBypass: false } }),
    );
    expect("coordinatorPermission" in unsupported).toBe(false);
    expect("workerPermissions" in unsupported).toBe(false);
  });

  test("Bypass after the host's switch went off is sent as the default", () => {
    expect(offeredChoice("bypassPermissions", false)).toBe("");
    expect(offeredChoice("bypassPermissions", true)).toBe("bypassPermissions");
    expect(offeredChoice("plan", false)).toBe("plan");
    const sent = createPayload(
      form({ permission: "bypassPermissions", modes: { offered: true, allowBypass: false } }),
    );
    expect("coordinatorPermission" in sent).toBe(false);
  });
});

describe("new-team: when Bypass asks again", () => {
  test("a coordinator or a worker on Bypass asks, on a host that offers the modes", () => {
    expect(bypassAsked(form({ permission: "bypassPermissions" }))).toBe(true);
    const worker = form({
      rows: [
        { persona: null, model: "", effort: "" as const, permission: "" },
        { persona: null, model: "", effort: "" as const, permission: "bypassPermissions" },
      ],
    });
    expect(bypassAsked(worker)).toBe(true);
  });

  test("no Bypass, a host that does not offer the modes, or a switch gone off asks nothing", () => {
    expect(bypassAsked(form({ permission: "plan" }))).toBe(false);
    const off = { offered: false, allowBypass: true };
    expect(bypassAsked(form({ permission: "bypassPermissions", modes: off }))).toBe(false);
    const gone = { offered: true, allowBypass: false };
    expect(bypassAsked(form({ permission: "bypassPermissions", modes: gone }))).toBe(false);
  });
});

describe("new-team: the project and the member", () => {
  test("the first project stands until another one that exists is chosen", () => {
    const projects = [{ id: "a" }, { id: "b" }];
    expect(chosenProject(projects, "")).toBe("a");
    expect(chosenProject(projects, "b")).toBe("b");
    expect(chosenProject(projects, "gone")).toBe("a");
    expect(chosenProject([], "b")).toBe("");
  });

  test("a new member sends its persona and model as null when blank, a permission only when set", () => {
    expect(memberPayload({ persona: "", model: "", effort: "" as const, permission: "" })).toEqual({
      persona: null,
      model: null,
    });
    expect(
      memberPayload({ persona: "host:qa", model: "opus", effort: "" as const, permission: "plan" }),
    ).toEqual({
      persona: "host:qa",
      model: "opus",
      permission: "plan",
    });
  });
});

describe("new-team: what a member's confirm says", () => {
  test("closing and deleting name the team, removing names the member", () => {
    expect(confirmCopy({ kind: "close" }, "Alpha", t)).toEqual({
      message: "Close the team Alpha? Its sessions are told to stop.",
      label: "Close",
    });
    const del = confirmCopy({ kind: "delete" }, "Alpha", t);
    expect(del.message).toContain("Alpha");
    expect(del.label).toBe("Delete team");
    const remove = confirmCopy({ kind: "remove", member: "worker-2" }, "Alpha", t);
    expect(remove.message).toContain("worker-2");
    expect(remove.label).toBe("Remove");
  });
});

describe("new-team: the effort of each member (issue #2310)", () => {
  test("opus and sonnet take an effort, haiku does not, and the default model follows the persona's", () => {
    expect(takesEffort("opus", null)).toBe(true);
    expect(takesEffort("sonnet", null)).toBe(true);
    expect(takesEffort("haiku", null)).toBe(false);
    // The persona's model is a full id, resolved by its family.
    expect(takesEffort("", "claude-opus-5-5")).toBe(true);
    expect(takesEffort("", "claude-sonnet-5-5")).toBe(true);
    expect(takesEffort("", "claude-haiku-5-5")).toBe(false);
    // No persona model: Claude Code's own default model takes an effort.
    expect(takesEffort("", null)).toBe(true);
    // A model picked on the row wins over the persona's.
    expect(takesEffort("haiku", "claude-opus-5-5")).toBe(false);
    expect(takesEffort("opus", "claude-haiku-5-5")).toBe(true);
  });

  test("the coordinator's effort and each worker's go along, none meaning the persona's", () => {
    const sent = createPayload(
      form({
        effort: "max",
        rows: [
          { persona: null, model: "", effort: "low", permission: "" },
          { persona: null, model: "", effort: "", permission: "" },
        ],
      }),
    );
    expect(sent.coordinatorEffort).toBe("max");
    expect(sent.workerEfforts).toEqual(["low", null]);
  });

  test("no effort chosen sends no effort field", () => {
    const sent = createPayload(form());
    expect("coordinatorEffort" in sent).toBe(false);
    expect("workerEfforts" in sent).toBe(false);
  });

  test("a host that does not announce the feature gets no effort, whatever the form holds", () => {
    const sent = createPayload(
      form({
        efforts: false,
        effort: "high",
        rows: [{ persona: null, model: "", effort: "low", permission: "" }],
      }),
    );
    expect("coordinatorEffort" in sent).toBe(false);
    expect("workerEfforts" in sent).toBe(false);
  });

  test("a haiku row sends no effort, and neither does a row whose persona runs on haiku", () => {
    const sent = createPayload(
      form({
        model: "haiku",
        effort: "high",
        personaModels: { "host:fast": "claude-haiku-5-5" },
        rows: [
          { persona: "host:fast", model: "", effort: "low", permission: "" },
          { persona: null, model: "haiku", effort: "max", permission: "" },
          { persona: null, model: "sonnet", effort: "medium", permission: "" },
        ],
      }),
    );
    expect("coordinatorEffort" in sent).toBe(false);
    expect(sent.workerEfforts).toEqual([null, null, "medium"]);
  });

  test("a row with the default model takes the effort by its persona's model", () => {
    const personaModels = { "host:lead": "claude-opus-5-5", "host:fast": "claude-haiku-5-5" };
    const shown = (persona: string) => effortOffered({ efforts: true, personaModels }, "", persona);
    expect(shown("host:lead")).toBe(true);
    expect(shown("host:fast")).toBe(false);
    // No persona and no model: shown.
    expect(shown("")).toBe(true);
    expect(effortOffered({ efforts: false, personaModels }, "opus", "")).toBe(false);
  });

  test("a worker added to a team carries its effort only when one is chosen", () => {
    expect(memberPayload({ persona: "", model: "", effort: "high", permission: "" })).toEqual({
      persona: null,
      model: null,
      effort: "high",
    });
    expect("effort" in memberPayload({ persona: "", model: "", effort: "", permission: "" })).toBe(
      false,
    );
  });
});
