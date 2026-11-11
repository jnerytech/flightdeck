import { describe, expect, test } from "bun:test";
import {
  initialPersonasState,
  type PersonasCore,
  PersonasSlice,
} from "../../src/features/personas/index.ts";
import { memoryPlatform } from "../fixtures.ts";

/** A slice over a bare state, with a host that answers from the given list (null: it refuses). */
function slice(host: { personas: unknown[] } | null, language: "pt-BR" | "en" = "en") {
  let state = initialPersonasState();
  const asked: string[] = [];
  const core: PersonasCore = {
    state: () => state,
    update: (patch) => {
      state = { ...state, ...patch };
    },
    storage: memoryPlatform().platform.storage,
    list: async (hostId, lang) => {
      asked.push(`${hostId}:${lang}`);
      return host as never;
    },
    language: () => language,
  };
  return { slice: new PersonasSlice(core), state: () => state, asked };
}

describe("the personas slice", () => {
  test("load keeps a host's personas under its id and asks in the app's language", async () => {
    const s = slice({ personas: [{ id: "qa", name: "QA" }] }, "pt-BR");
    await s.slice.load("h1");
    await s.slice.load("h2");
    expect(s.asked).toEqual(["h1:pt-BR", "h2:pt-BR"]);
    expect(Object.keys(s.state().personas)).toEqual(["h1", "h2"]);
    expect(s.state().personas.h1?.map((p) => p.id)).toEqual(["qa"]);
  });

  test("load leaves the state alone when the host refuses", async () => {
    const s = slice(null);
    await s.slice.load("h1");
    expect(s.state().personas).toEqual({});
  });

  test("ref reads a host persona by id, an app persona whole, and nothing else", () => {
    const s = slice({ personas: [] }, "pt-BR");
    s.slice.global.save({ id: "minha", name: "Minha", description: "d", body: "b" });
    expect(s.slice.ref("host:qa")).toEqual({ id: "qa", language: "pt-BR" });
    expect(s.slice.ref("app:minha")?.language).toBe("pt-BR");
    expect(s.slice.ref("app:minha")).toHaveProperty("definition.id", "minha");
    expect(s.slice.ref("app:ausente")).toBeNull();
    expect(s.slice.ref("qa")).toBeNull();
  });
});
