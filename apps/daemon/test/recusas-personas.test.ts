import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FlightdeckError } from "../src/errors.ts";
import { normalizePersona, parsePersona } from "../src/personas/model.ts";
import { OpenSessionPersonas } from "../src/personas/open-session.ts";
import { packPersonas } from "../src/personas/pack.ts";
import { Personas } from "../src/personas/store.ts";
import { SecretScanner } from "../src/snippets/model.ts";
import { EventStore } from "../src/store/event-store.ts";
import { newManager, workspace } from "./helpers.ts";

const scanner = new SecretScanner();
const GOOD = { id: "seg", name: "Segurança", description: "Revisa", body: "Procure falhas." };

/** The reason, params and code of the refusal a call ends in; the detail is English, for logs. */
async function refused(call: () => unknown) {
  try {
    await call();
  } catch (error) {
    expect(error).toBeInstanceOf(FlightdeckError);
    const { code, reason, params, message } = error as FlightdeckError;
    expect(message).not.toMatch(/[ãõçáéíóú]/);
    return { code, reason, params };
  }
  throw new Error("it did not refuse");
}

describe("recusas-personas: the persona model says why", () => {
  const norm = (raw: unknown) => () => normalizePersona(raw, scanner);
  test.each([
    [null, "persona_not_object", undefined],
    [{ ...GOOD, extra: 1 }, "persona_field_unknown", { field: "extra" }],
    [{ ...GOOD, id: "Not An Id" }, "persona_id_format", undefined],
    [{ ...GOOD, name: undefined }, "persona_field_required", { field: "name" }],
    [{ ...GOOD, name: "a\nb" }, "persona_field_line", { field: "name", max: 60 }],
    [{ ...GOOD, effort: "huge" }, "persona_effort", undefined],
    [{ ...GOOD, permissionMode: "yolo" }, "persona_mode", undefined],
    [{ ...GOOD, model: "bad model!" }, "persona_field_invalid", { field: "model" }],
    [{ ...GOOD, body: "" }, "persona_body_empty", undefined],
    [{ ...GOOD, body: "x".repeat(9000) }, "persona_body_big", undefined],
    [{ ...GOOD, body: "a\u0000b" }, "persona_body_control", undefined],
    [{ ...GOOD, tools: "Read" }, "persona_tools_list", undefined],
    [{ ...GOOD, tools: ["Read", "Read"] }, "persona_tools_names", undefined],
  ])("case %#: refused with its reason", async (raw, reason, params) => {
    const got = await refused(norm(raw));
    expect(got.reason).toBe(reason as string);
    if (params) expect(got.params).toMatchObject(params);
  });

  test("a secret in the instructions", async () => {
    const got = await refused(
      norm({ ...GOOD, body: "use ghp_abcdefghijklmnopqrstuvwxyz0123456789ABCD" }),
    );
    expect(got).toMatchObject({ code: "persona_secret", reason: "persona_has_secret" });
    expect(got.params?.kinds).toBeString();
  });

  test("a persona file: the frontmatter, and the file name that must be the id", async () => {
    expect((await refused(() => parsePersona("sem frontmatter"))).reason).toBe(
      "persona_frontmatter_missing",
    );
    expect((await refused(() => parsePersona("---\n: : :\n---\ncorpo"))).reason).toBe(
      "persona_frontmatter_invalid",
    );
    expect((await refused(() => parsePersona("---\n- a\n- b\n---\ncorpo"))).reason).toBe(
      "persona_frontmatter_map",
    );
    const file = "---\nid: seg\nname: S\ndescription: D\n---\ncorpo\n";
    expect(await refused(() => parsePersona(file, "outro"))).toMatchObject({
      reason: "persona_id_filename",
      params: { id: "seg", file: "outro" },
    });
  });
});

describe("recusas-personas: the store and the open sessions say why", () => {
  function setup() {
    const { root, project } = workspace();
    const db = new EventStore(":memory:").db;
    const personas = new Personas({ db, allowedRoots: [root], scanner, pack: packPersonas });
    return { root, project, db, personas };
  }
  const ctx = { language: "pt-BR" as const };

  test("the scope, the persona and the file", async () => {
    const { personas, project } = setup();
    expect((await refused(() => personas.save({ scope: "project", persona: GOOD }))).reason).toBe(
      "persona_project_path",
    );
    expect((await refused(() => personas.get("nada", ctx))).reason).toBe("persona_not_found");
    expect((await refused(() => personas.remove("host", "nada"))).reason).toBe("persona_not_found");
    expect((await refused(() => personas.reset("meu", ctx))).reason).toBe("persona_pack_only");
    expect((await refused(() => personas.remove("project", "nada", project))).reason).toBe(
      "persona_not_found",
    );
    expect((await refused(() => personas.resolve({}, ctx))).reason).toBe("persona_ref_needed");
    expect((await refused(() => personas.resolve({ id: "a", definition: GOOD }, ctx))).reason).toBe(
      "persona_ref_needed",
    );
    expect((await refused(() => personas.trust(project, "nada", "h"))).reason).toBe(
      "persona_not_found",
    );
  });

  test("publishing as a project agent needs the confirmation and the editor", async () => {
    const { personas, project } = setup();
    const base = { projectPath: project, id: "arquiteto", language: "pt-BR" as const };
    expect((await refused(() => personas.publishAgent({ ...base, confirm: false }))).reason).toBe(
      "persona_publish_confirm",
    );
    expect((await refused(() => personas.publishAgent({ ...base, confirm: true }))).reason).toBe(
      "persona_publisher_off",
    );
  });

  test("a project persona that changed, or was never trusted", async () => {
    const { personas, project } = setup();
    mkdirSync(join(project, ".flightdeck", "personas"), { recursive: true });
    writeFileSync(
      join(project, ".flightdeck", "personas", "pr.md"),
      "---\nid: pr\nname: P\ndescription: D\n---\ncorpo\n",
    );
    expect((await refused(() => personas.trust(project, "pr", "hash-velho"))).reason).toBe(
      "persona_changed",
    );
    const untrusted = await refused(() =>
      personas.resolve({ id: "pr" }, { projectPath: project, language: "pt-BR" }),
    );
    expect(untrusted).toMatchObject({
      code: "persona_untrusted",
      reason: "persona_untrusted_project",
      params: { id: "pr" },
    });
  });

  test("an open session: the target, the service and the session", async () => {
    const { manager, project } = newManager();
    const open = new OpenSessionPersonas({ manager } as never);
    expect((await refused(() => open.apply({ persona: { id: "x" } }))).reason).toBe(
      "session_target_needed",
    );
    expect(
      (await refused(() => open.apply({ claudeSessionId: "c", persona: { id: "x" } }))).reason,
    ).toBe("terminal_sessions_off");
    const plain = new OpenSessionPersonas({ manager, personas: undefined } as never);
    const { sessionId } = manager.create({ cwd: project, prompt: "oi" });
    expect((await refused(() => plain.apply({ sessionId, persona: { id: "x" } }))).reason).toBe(
      "personas_off",
    );
    expect((await refused(() => plain.clear({ sessionId }))).reason).toBe("persona_not_applied");
  });
});
