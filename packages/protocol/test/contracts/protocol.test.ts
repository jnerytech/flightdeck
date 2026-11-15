import { describe, expect, test } from "bun:test";
import {
  ChangesResult,
  Command,
  EventEnvelope,
  FEATURE_RESUME_OFFER,
  Project,
  ProjectAddPayload,
  ProjectUpdatePayload,
  SESSION_IMAGE_MAX_BYTES,
  SESSION_IMAGE_MAX_COUNT,
  SESSION_IMAGE_TYPES,
  ServerMessage,
  SessionEvent,
  SessionInterruptedResult,
  TELEPORT_PART_MAX_BYTES,
  TeleportManifestSchema,
} from "../../src/index.ts";
import { TELEPORT_MANIFEST, validCommands, validEvents } from "./valid-messages.ts";

describe("protocolo", () => {
  test("projeto de um daemon anterior à fase 13 ganha a aprovação automática desligada", () => {
    const old = {
      id: "p1",
      path: "/r",
      name: "r",
      baseBranch: "main",
      prProvider: "none",
      setupScript: null,
      promptTemplate: "",
    };
    expect(Project.safeParse(old).data?.autoApprove).toEqual({
      enabled: false,
      model: "claude-haiku-5-5",
      lowWithoutAi: true,
    });
  });

  test("a manifest part is at most TELEPORT_PART_MAX_BYTES, and one at the cap is taken", () => {
    const part = TELEPORT_MANIFEST.parts[0];
    const sized = (size: number) =>
      TeleportManifestSchema.safeParse({ ...TELEPORT_MANIFEST, parts: [{ ...part, size }] })
        .success;
    expect([sized(TELEPORT_PART_MAX_BYTES), sized(TELEPORT_PART_MAX_BYTES + 1)]).toEqual([
      true,
      false,
    ]);
  });

  test("teleport.receive and teleport.write refuse a part they do not know, a bad sha256 or a chunk too big", () => {
    const part = TELEPORT_MANIFEST.parts[0];
    const receive = (manifest: unknown) =>
      Command.safeParse({ id: "1", type: "teleport.receive", payload: { manifest } }).success;
    const write = (payload: unknown) =>
      Command.safeParse({ id: "1", type: "teleport.write", payload }).success;
    expect([
      receive({ ...TELEPORT_MANIFEST, parts: [{ ...part, name: "../etc" }] }),
      receive({ ...TELEPORT_MANIFEST, parts: [{ ...part, sha256: "zz" }] }),
      receive({ ...TELEPORT_MANIFEST, permissionMode: "everything" }),
      receive({ ...TELEPORT_MANIFEST, git: { ...TELEPORT_MANIFEST.git, baseSha: "origin/main" } }),
      write({ id: "in-1", part: "other", offset: 0, data: "" }),
      write({ id: "in-1", part: "code", offset: 0, data: "A".repeat(200_000) }),
    ]).toEqual([false, false, false, false, false, false]);
  });

  test("the harness preview takes at least one part, and never mcp, which has no template (#927)", () => {
    const parse = (parts: string[]) =>
      Command.safeParse({
        id: "1",
        type: "project.harness.preview",
        payload: { path: "/work/app", parts },
      }).success;
    expect([parse([]), parse(["mcp"]), parse(["hooks"])]).toEqual([false, false, true]);
  });

  test("workflow.template.add names a project and one of the host's templates, and carries no file (#1221)", () => {
    const parse = (payload: unknown) =>
      Command.safeParse({ id: "1", type: "workflow.template.add", payload }).success;
    expect([
      parse({ projectId: "p", templateId: "alert-fixer", confirm: true }),
      parse({ projectId: "p", templateId: "alert-fixer" }),
      parse({ projectId: "p", templateId: "" }),
      parse({ projectId: "p", templateId: "alert-fixer", yaml: "steps: []" }),
      parse({ projectId: "p", templateId: "alert-fixer", path: ".flightdeck/workflows/x.yaml" }),
    ]).toEqual([true, true, false, false, false]);
  });

  test.each(Object.entries(validCommands))("comando %s válido passa no schema", (type, payload) => {
    expect(Command.safeParse({ id: "1", type, payload }).success).toBe(true);
  });

  test.each(validEvents.map((e) => [e.type, e] as const))(
    "evento %s válido passa no schema",
    (_, event) => {
      expect(SessionEvent.safeParse(event).success).toBe(true);
      const envelope = {
        type: "event",
        sessionId: "s",
        seq: 1,
        ts: new Date().toISOString(),
        event,
      };
      expect(EventEnvelope.safeParse(envelope).success).toBe(true);
      expect(ServerMessage.safeParse(envelope).success).toBe(true);
    },
  );

  test("teams.create and addMember carry an effort for the coordinator and each worker, and refuse a level that does not exist (#2310)", () => {
    const create = {
      projectId: "p1",
      goal: "x",
      workers: 2,
      coordinatorEffort: "max",
      workerEfforts: ["low", null],
    };
    const parsed = Command.safeParse({ id: "1", type: "teams.create", payload: create });
    expect(parsed.success && parsed.data.payload).toEqual(create);
    const add = { team: "t1", addMember: { persona: "qa", effort: "high" } };
    const added = Command.safeParse({ id: "1", type: "teams.update", payload: add });
    expect(added.success && added.data.payload).toEqual(add);
    const nullable = { team: "t1", addMember: { effort: null } };
    const none = Command.safeParse({ id: "1", type: "teams.update", payload: nullable });
    expect(none.success && none.data.payload).toEqual(nullable);
    const refuses = (type: string, payload: unknown) =>
      Command.safeParse({ id: "1", type, payload }).success;
    expect(refuses("teams.create", { ...create, coordinatorEffort: "turbo" })).toBe(false);
    expect(refuses("teams.create", { ...create, workerEfforts: ["low", "turbo"] })).toBe(false);
    expect(refuses("teams.create", { ...create, workerEfforts: Array(9).fill("low") })).toBe(false);
    expect(refuses("teams.update", { team: "t1", addMember: { effort: "turbo" } })).toBe(false);
  });

  test("teams.add_member and teams.remove_member need `as`, a bounded brief and no permission (#2090)", () => {
    const accepts = (type: string, payload: unknown) =>
      Command.safeParse({ id: "1", type, payload }).success;
    const add = { team: "t1", persona: "qa", brief: "Check the form.", as: { session: "s1" } };
    expect(accepts("teams.add_member", add)).toBe(true);
    expect(accepts("teams.add_member", { ...add, model: "haiku" })).toBe(true);
    expect(accepts("teams.add_member", { ...add, as: undefined })).toBe(false);
    expect(accepts("teams.add_member", { ...add, brief: "" })).toBe(false);
    expect(accepts("teams.add_member", { ...add, brief: "x".repeat(4001) })).toBe(false);
    expect(accepts("teams.add_member", { ...add, brief: "x".repeat(4000) })).toBe(true);
    expect(accepts("teams.add_member", { ...add, persona: "" })).toBe(false);
    expect(accepts("teams.add_member", { ...add, permission: "bypassPermissions" })).toBe(false);
    const remove = { team: "t1", member: "pc/s3", as: { session: "s1" } };
    expect(accepts("teams.remove_member", remove)).toBe(true);
    expect(accepts("teams.remove_member", { ...remove, as: undefined })).toBe(false);
    expect(accepts("teams.remove_member", { ...remove, member: "" })).toBe(false);
  });

  test("payload inválido é recusado pelo schema", () => {
    expect(
      Command.safeParse({ id: "1", type: "session.create", payload: { cwd: "" } }).success,
    ).toBe(false);
    expect(
      Command.safeParse({ id: "1", type: "session.send", payload: { sessionId: 1 } }).success,
    ).toBe(false);
    expect(Command.safeParse({ id: "1", type: "nope", payload: {} }).success).toBe(false);
    expect(Command.safeParse({ type: "session.list", payload: {} }).success).toBe(false);
    expect(
      Command.safeParse({
        id: "1",
        type: "permission.respond",
        payload: { requestId: "r", decision: "maybe" },
      }).success,
    ).toBe(false);
  });

  test("evento inválido é recusado pelo schema", () => {
    expect(SessionEvent.safeParse({ type: "session.status", status: "sleeping" }).success).toBe(
      false,
    );
    expect(SessionEvent.safeParse({ type: "unknown" }).success).toBe(false);
  });

  test("acks ok e erro passam no schema", () => {
    expect(
      ServerMessage.safeParse({ type: "ack", id: "1", ok: true, data: { x: 1 } }).success,
    ).toBe(true);
    expect(
      ServerMessage.safeParse({
        type: "ack",
        id: "1",
        ok: false,
        error: { code: "bad_request", message: "x" },
      }).success,
    ).toBe(true);
  });
});

describe("images in a message", () => {
  const send = (payload: Record<string, unknown>) =>
    Command.safeParse({ id: "1", type: "session.send", payload: { sessionId: "s", ...payload } });
  const png = { mediaType: "image/png", data: "iVBORw0KGgo=" };

  test("the limits are five images of the four types the API reads, up to 5 MB each", () => {
    expect(SESSION_IMAGE_MAX_COUNT).toBe(5);
    expect(SESSION_IMAGE_MAX_BYTES).toBe(5 * 1024 * 1024);
    expect([...SESSION_IMAGE_TYPES]).toEqual([
      "image/png",
      "image/jpeg",
      "image/gif",
      "image/webp",
    ]);
  });

  test("a message carries its images, with or without text", () => {
    const withText = send({ text: "look", images: [png] });
    expect(withText.success).toBe(true);
    const payload: unknown = withText.success ? withText.data.payload : null;
    expect((payload as { images?: unknown }).images).toEqual([png]);
    expect(send({ text: "", images: [png] }).success).toBe(true);
  });

  test("an empty message with no image is still refused", () => {
    expect(send({ text: "" }).success).toBe(false);
    expect(send({ text: "", images: [] }).success).toBe(false);
  });

  test("a type outside the list, too many images or one too big are refused", () => {
    expect(send({ text: "x", images: [{ ...png, mediaType: "image/svg+xml" }] }).success).toBe(
      false,
    );
    expect(send({ text: "x", images: Array(6).fill(png) }).success).toBe(false);
    const big = "A".repeat(Math.ceil((SESSION_IMAGE_MAX_BYTES * 4) / 3) + 8);
    expect(send({ text: "x", images: [{ ...png, data: big }] }).success).toBe(false);
  });

  test("the user message event says how many images came with it", () => {
    const parsed: unknown = SessionEvent.parse({ type: "message.user", text: "x", images: 2 });
    expect(parsed).toEqual({
      type: "message.user",
      text: "x",
      images: 2,
    });
  });
});

describe("session.interrupted (issue #150)", () => {
  const listed = {
    sessionId: "s",
    name: null,
    cwd: "/p",
    persona: null,
    interruptedAt: "2026-11-05T10:00:00.000Z",
    ranMs: 0,
    lastRequest: null,
  };

  test("the command takes no payload: an extra key is refused", () => {
    expect(Command.safeParse({ id: "1", type: "session.interrupted", payload: {} }).success).toBe(
      true,
    );
    expect(
      Command.safeParse({ id: "1", type: "session.interrupted", payload: { within: 1 } }).success,
    ).toBe(false);
  });

  test("the result is a list of sessions, and a negative run time is refused", () => {
    expect(SessionInterruptedResult.safeParse({ sessions: [listed] }).success).toBe(true);
    expect(
      SessionInterruptedResult.safeParse({ sessions: [{ ...listed, ranMs: -1 }] }).success,
    ).toBe(false);
    expect(SessionInterruptedResult.safeParse({ sessions: [{ sessionId: "s" }] }).success).toBe(
      false,
    );
  });

  test("the feature a host announces is named resume-offer", () => {
    expect(FEATURE_RESUME_OFFER).toBe("resume-offer");
  });
});

describe("session.init commands (the / menu)", () => {
  const init = {
    type: "session.init" as const,
    claudeSessionId: "c",
    model: "m",
    tools: [] as string[],
    slashCommands: ["compact"],
  };
  test("an init with described commands keeps them, and one without stays valid", () => {
    const commands = [{ name: "compact", description: "Compact", kind: "builtin" as const }];
    expect(SessionEvent.parse({ ...init, commands })).toEqual({ ...init, commands });
    expect(SessionEvent.parse(init)).toEqual(init);
  });
  test("a command needs a known kind", () => {
    const commands = [{ name: "x", description: "", kind: "other" }] as unknown;
    expect(SessionEvent.safeParse({ ...init, commands }).success).toBe(false);
  });
});

describe("changes-cap: a file the daemon would not send is listed with a marker and its size", () => {
  const file = {
    path: "dump.log",
    oldPath: null,
    status: "added" as const,
    additions: 3,
    deletions: 0,
    uncommitted: true,
    binary: false,
    hunks: [],
  };
  const result = (files: unknown[]) => ({
    target: "session:s1",
    root: "/w",
    base: null,
    files,
    position: null,
  });
  test("tooLarge and bytes survive a parse", () => {
    const sent = result([{ ...file, tooLarge: true, bytes: 209_715_200 }]);
    expect(ChangesResult.parse(sent).files[0]).toEqual({
      ...file,
      tooLarge: true,
      bytes: 209_715_200,
    });
  });
  test("a daemon that does not know the marker still parses: the file is simply not too large", () => {
    const parsed = ChangesResult.parse(result([file])).files[0];
    expect(parsed?.tooLarge).toBeUndefined();
    expect(parsed?.bytes).toBeUndefined();
  });
  test("a negative size is refused", () => {
    expect(ChangesResult.safeParse(result([{ ...file, tooLarge: true, bytes: -1 }])).success).toBe(
      false,
    );
  });
});

describe("git-ref-protocol: a project's base branch is a branch name", () => {
  const add = (baseBranch: unknown) => ProjectAddPayload.safeParse({ path: "/w/p", baseBranch });
  const update = (baseBranch: unknown) =>
    ProjectUpdatePayload.safeParse({ projectId: "p1", baseBranch });
  test("a name git accepts is kept, in an add and in an update, and no base at all is fine", () => {
    expect(add("main").success).toBe(true);
    expect(add("release/1.2").success).toBe(true);
    expect(update("feature/ü-é").success).toBe(true);
    expect(ProjectAddPayload.safeParse({ path: "/w/p" }).success).toBe(true);
    expect(ProjectUpdatePayload.safeParse({ projectId: "p1" }).success).toBe(true);
  });
  test("one that git would read as an option, or that is not a branch name, is refused", () => {
    for (const bad of ["--output=/tmp/stolen", "-main", "a..b", "a b", "x.lock", ""]) {
      expect(add(bad).success).toBe(false);
      expect(update(bad).success).toBe(false);
    }
  });
});

describe("rev-stored-protocol: a project says when its stored base branch is not one", () => {
  const project = {
    id: "p",
    path: "/w/p",
    name: "p",
    baseBranch: "--x",
    prProvider: "none",
    setupScript: null,
    promptTemplate: "",
  };
  test("baseBranchInvalid survives a parse, and a daemon that never sends it still parses", () => {
    expect(Project.parse({ ...project, baseBranchInvalid: true }).baseBranchInvalid).toBe(true);
    expect(Project.parse(project).baseBranchInvalid).toBeUndefined();
  });
});
