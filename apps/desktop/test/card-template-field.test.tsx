import { afterEach, describe, expect, test } from "bun:test";
import type { CardTemplate, CardTemplates } from "@flightdeck/protocol";
import { en } from "../src/i18n/en.ts";
import { translator } from "../src/i18n/index.ts";
import { ptBR } from "../src/i18n/pt-BR.ts";
import { registerDom } from "./dom.ts";
import { settle } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { TContext } = await import("../src/i18n/context.tsx");
const { applyTemplate, CardTemplateField, startPersonaOf, startWorkflowOf } = await import(
  "../src/components/board/card-template-field.tsx"
);

afterEach(cleanup);

const BUG: CardTemplate = {
  id: "bug",
  name: "Bug fix",
  description: "Fix it.\n\n- [ ] a test fails first",
  workflow: "fix",
  persona: "reviewer",
  pins: ["docs/adr/0001-style.md", "docs/specs/b.md"],
  spec: "docs/specs/bug.md",
};
const PLAIN: CardTemplate = {
  ...BUG,
  id: "plain",
  name: "Plain",
  workflow: null,
  persona: null,
  pins: [],
  spec: null,
  description: "",
};

describe("card-template-field: the helpers (#1201)", () => {
  test("a template's text takes the place of an empty description", () => {
    expect(applyTemplate({ description: "", filled: null }, BUG)).toEqual({
      description: BUG.description,
      filled: BUG.description,
    });
  });

  test("a template's text takes the place of the one the last template put there", () => {
    const first = applyTemplate({ description: "", filled: null }, BUG);
    const other = { ...BUG, id: "o", description: "Other." };
    expect(applyTemplate(first, other).description).toBe("Other.");
    expect(applyTemplate(first, null)).toEqual({ description: "", filled: null });
  });

  test("words the person typed are never replaced, by a template or by a blank card", () => {
    const typed = { description: "My own words", filled: null };
    expect(applyTemplate(typed, BUG).description).toBe("My own words");
    expect(applyTemplate(typed, null).description).toBe("My own words");
  });

  test("the card starts with its template's workflow when the project still has it", () => {
    expect([
      startWorkflowOf({ startWorkflow: "fix" }, ["fix", "other"]),
      startWorkflowOf({ startWorkflow: "gone" }, ["fix"]),
      startWorkflowOf({ startWorkflow: null }, ["fix"]),
    ]).toEqual(["fix", "", ""]);
  });

  test("the card starts in its template's persona when the host has it", () => {
    expect([
      startPersonaOf({ startPersona: "reviewer" }, ["dev", "reviewer"]),
      startPersonaOf({ startPersona: "gone" }, ["dev"]),
      startPersonaOf({ startPersona: null }, ["dev"]),
    ]).toEqual(["host:reviewer", null, null]);
  });
});

function fakeStore(answer: CardTemplates | "refused") {
  const asked: string[] = [];
  const store = {
    hostRequest: async (_host: string, type: string) => {
      asked.push(type);
      return answer === "refused"
        ? { ok: false, code: "bad_request", message: "no" }
        : { ok: true, data: answer };
    },
  };
  return { store: store as never, asked };
}

const OFFER = (over: Partial<CardTemplates> = {}): CardTemplates => ({
  templates: [BUG, PLAIN],
  dropped: 0,
  ignored: null,
  ...over,
});

for (const [lang, t] of [
  ["en", en],
  ["pt-BR", ptBR],
] as const) {
  async function show(
    answer: CardTemplates | "refused",
    over: { enabled?: boolean; value?: string | null } = {},
  ) {
    const picks: Array<CardTemplate | null> = [];
    const fake = fakeStore(answer);
    render(
      <TContext.Provider value={translator(lang)}>
        <CardTemplateField
          store={fake.store}
          hostId="h1"
          projectId="p1"
          enabled={over.enabled ?? true}
          value={over.value ?? null}
          onPick={(template) => picks.push(template)}
        />
      </TContext.Provider>,
    );
    await act(async () => {});
    return { picks, asked: fake.asked };
  }
  const select = () => screen.queryByLabelText(t.kanban.template) as HTMLSelectElement | null;

  describe(`card-template-field (${lang}): the picker in New card (#1201)`, () => {
    test("offers a blank card and each template by name", async () => {
      await show(OFFER());
      await settle(() => select() !== null);
      expect(
        Array.from(select()?.options ?? []).map((option) => [option.value, option.textContent]),
      ).toEqual([
        ["", t.kanban.templateNone],
        ["bug", "Bug fix"],
        ["plain", "Plain"],
      ]);
    });

    test("picking a template hands it over, and the blank card hands over none", async () => {
      const { picks } = await show(OFFER());
      await settle(() => select() !== null);
      await act(async () => {
        fireEvent.change(select() as HTMLElement, { target: { value: "bug" } });
      });
      await act(async () => {
        fireEvent.change(select() as HTMLElement, { target: { value: "" } });
      });
      expect(picks.map((pick) => pick?.id ?? null)).toEqual(["bug", null]);
    });

    test("the picked template says what the card starts with", async () => {
      await show(OFFER(), { value: "bug" });
      await settle(() => select() !== null);
      const parts = [
        t.kanban.templateWorkflow.replace("{name}", "fix"),
        t.kanban.templatePersona.replace("{name}", "reviewer"),
        t.kanban.templatePins.replace("{n}", "2"),
        t.kanban.templateSpec.replace("{path}", "docs/specs/bug.md"),
      ].join(", ");
      expect(screen.queryByText(t.kanban.templateStarts.replace("{parts}", parts))).not.toBeNull();
    });

    test("one pinned document is not 'documents'", async () => {
      await show(OFFER({ templates: [{ ...BUG, pins: ["docs/adr/0001-style.md"] }] }), {
        value: "bug",
      });
      await settle(() => select() !== null);
      const help = document.querySelector("p[id$='-help']")?.textContent ?? "";
      const one = lang === "en" ? "1 pinned document," : "1 documento fixado,";
      expect([help.includes(one), /1 (pinned documents|documentos fixados)/.test(help)]).toEqual([
        true,
        false,
      ]);
    });

    test("a template that sets nothing says nothing, and no template picked says nothing", async () => {
      await show(OFFER(), { value: "plain" });
      await settle(() => select() !== null);
      expect(screen.queryByText(/^(Starts with|Começa com)/) === null).toBe(true);
    });

    test("templates left out for a mistake are counted", async () => {
      await show(OFFER({ dropped: 2 }));
      await settle(() => select() !== null);
      expect(screen.queryByText(t.kanban.templateDropped.replace("{n}", "2"))).not.toBeNull();
    });

    test("a file that was not used says why, and offers no picker", async () => {
      await show({ templates: [], dropped: 0, ignored: "untrusted" });
      await settle(() => screen.queryByText(t.kanban.templateIgnored.untrusted) !== null);
      expect(select() === null).toBe(true);
    });

    test("a project with no templates shows nothing at all", async () => {
      const { asked } = await show({ templates: [], dropped: 0, ignored: null });
      await act(async () => {});
      expect([select() === null, asked]).toEqual([true, ["card.templates"]]);
    });

    test("a host that does not announce templates is not asked, and a refused ask shows nothing", async () => {
      const off = await show(OFFER(), { enabled: false });
      cleanup();
      const refused = await show("refused");
      expect([off.asked, select() === null, refused.asked]).toEqual([[], true, ["card.templates"]]);
    });
  });
}
