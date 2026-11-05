import { describe, expect, test } from "bun:test";
import { cleanTitle, rowTitle } from "../src/lib/hub-title.ts";

describe("sessoes-titulos: wrappers never reach a title (issue #111)", () => {
  test("system wrappers are stripped, and what is left is the text", () => {
    expect(cleanTitle("<task-notification>build done</task-notification> Revise o PR")).toBe(
      "Revise o PR",
    );
    expect(cleanTitle("Another Claude session sent a message: corrija o login")).toBe(
      "corrija o login",
    );
    expect(
      cleanTitle("<local-command-stdout>\u001b[2mCompacted (ctrl+o)</local-command-stdout>"),
    ).toBeNull();
    expect(cleanTitle("<local-command-caveat>Caveat: ignore</local-command-caveat>  Faça X")).toBe(
      "Faça X",
    );
    expect(
      cleanTitle("<command-name>/clear</command-name> <command-message>clear</command-message>"),
    ).toBeNull();
  });

  test("a wrapper with nothing after it, an open tag and blank text are null", () => {
    expect(cleanTitle("<task-notification>")).toBeNull();
    expect(cleanTitle("Another Claude session sent a message:")).toBeNull();
    expect(cleanTitle("   ")).toBeNull();
    expect(cleanTitle(null)).toBeNull();
    expect(cleanTitle(undefined)).toBeNull();
  });

  test("plain text is kept as it is, trimmed and on one line", () => {
    expect(cleanTitle("  Ajuste o botão\n e o menu ")).toBe("Ajuste o botão e o menu");
    expect(cleanTitle("Use <b> in the title")).toBe("Use <b> in the title");
  });
});

describe("sessoes-titulos: the order a title is chosen in", () => {
  const base = { name: null, title: null, persona: null, request: null, cwd: "/work/api" };
  const persona = { id: "qa", name: "QA / testes", icon: null };

  test("name, then the host\u2019s title (summary or first prompt), then persona + task, then the folder", () => {
    expect(
      rowTitle({ ...base, name: "Meu nome", title: "Resumo", persona, request: "tarefa" }),
    ).toBe("Meu nome");
    expect(rowTitle({ ...base, title: "Resumo do host", persona, request: "tarefa" })).toBe(
      "Resumo do host",
    );
    expect(rowTitle({ ...base, persona, request: "Corrigir o login" })).toBe(
      "QA / testes · Corrigir o login",
    );
    // The last prompt changes every turn: without a persona it does not name the session.
    expect(rowTitle({ ...base, request: "Corrigir o login" })).toBe("api");
    expect(rowTitle(base)).toBe("api");
  });

  test("a title that is only a wrapper counts as missing, so the next source is used", () => {
    expect(
      rowTitle({ ...base, title: "<task-notification>", persona, request: "Revisar o PR 128" }),
    ).toBe("QA / testes · Revisar o PR 128");
    expect(
      rowTitle({
        ...base,
        title: "Another Claude session sent a message:",
        request: "<task-notification>",
      }),
    ).toBe("api");
  });
});
