import { describe, expect, test } from "bun:test";
import {
  bypassAsked,
  chosenProject,
  confirmCopy,
  createPayload,
  memberPayload,
  type NewTeamForm,
  offeredChoice,
} from "../../src/features/teams/new-team.ts";
import { translator } from "../../src/i18n/index.ts";

const t = translator("en");

const form = (over: Partial<NewTeamForm> = {}): NewTeamForm => ({
  projectId: "p1",
  goal: "ship it",
  name: "",
  persona: "",
  model: "",
  permission: "",
  rows: [
    { persona: null, model: "", permission: "" },
    { persona: null, model: "", permission: "" },
  ],
  workerDefault: "",
  modes: { offered: true, allowBypass: true },
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
          { persona: "host:qa", model: "", permission: "" },
          { persona: null, model: "", permission: "" },
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
          { persona: null, model: "sonnet", permission: "" },
          { persona: null, model: "", permission: "" },
        ],
      }),
    );
    expect(sent.coordinatorPersona).toBe("host:lead");
    expect(sent.coordinatorModel).toBe("opus");
    expect(sent.workerModels).toEqual(["sonnet", null]);
  });

  test("permission modes go only to a host that takes them, an unset worker as null", () => {
    const rows = [
      { persona: null, model: "", permission: "plan" as const },
      { persona: null, model: "", permission: "" as const },
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
        { persona: null, model: "", permission: "" },
        { persona: null, model: "", permission: "bypassPermissions" },
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
    expect(memberPayload({ persona: "", model: "", permission: "" })).toEqual({
      persona: null,
      model: null,
    });
    expect(memberPayload({ persona: "host:qa", model: "opus", permission: "plan" })).toEqual({
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
