import { describe, expect, test } from "bun:test";
import { RoiSettings } from "../src/lib/roi-settings.ts";

function setup() {
  const store = new Map<string, string>();
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  };
  let n = 0;
  const make = () => new RoiSettings({ storage }, { newId: () => `p${++n}` });
  return { make, settings: make() };
}

const reasonOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return (error as { reason?: string }).reason;
  }
  return undefined;
};

describe("roi-pessoas: people, their hosts and their monthly limits", () => {
  test("a person has a name, hosts and a token and/or cost limit, or none", () => {
    const { settings } = setup();
    const ana = settings.addPerson({ name: "Ana", hostIds: ["h1"], tokenLimit: 5_000_000 });
    expect(ana).toEqual({
      id: "p1",
      name: "Ana",
      hostIds: ["h1"],
      tokenLimit: 5_000_000,
      costLimit: null,
    });
    const bia = settings.addPerson({ name: "Bia", hostIds: ["h2", "h3"], costLimit: 200 });
    expect(bia).toMatchObject({ tokenLimit: null, costLimit: 200 });
    expect(settings.data().people.map((p) => p.name)).toEqual(["Ana", "Bia"]);
    expect(settings.personOf("h3")?.name).toBe("Bia");
    expect(settings.personOf("h9")).toBeNull();
  });

  test("a host in two people is refused with its reason, and so is a name used twice or an empty one", () => {
    const { settings } = setup();
    settings.addPerson({ name: "Ana", hostIds: ["h1"] });
    expect(reasonOf(() => settings.addPerson({ name: "Bia", hostIds: ["h1"] }))).toBe(
      "person_host_taken",
    );
    expect(reasonOf(() => settings.addPerson({ name: "ana", hostIds: ["h2"] }))).toBe(
      "person_name_taken",
    );
    expect(reasonOf(() => settings.addPerson({ name: "  ", hostIds: ["h2"] }))).toBe(
      "person_name_empty",
    );
    expect(settings.data().people).toHaveLength(1);
  });

  test("a limit must be a number from zero up; hosts are listed once", () => {
    const { settings } = setup();
    expect(reasonOf(() => settings.addPerson({ name: "Ana", hostIds: [], tokenLimit: -1 }))).toBe(
      "person_limit_invalid",
    );
    expect(
      reasonOf(() => settings.addPerson({ name: "Ana", hostIds: [], costLimit: Number.NaN })),
    ).toBe("person_limit_invalid");
    expect(settings.addPerson({ name: "Ana", hostIds: ["h1", "h1"] }).hostIds).toEqual(["h1"]);
  });

  test("a person is edited and removed, and a removed person frees the hosts", () => {
    const { settings } = setup();
    const ana = settings.addPerson({ name: "Ana", hostIds: ["h1"] });
    const edited = settings.updatePerson(ana.id, {
      name: "Ana M",
      hostIds: ["h1", "h4"],
      tokenLimit: 100,
    });
    expect(edited).toMatchObject({ name: "Ana M", hostIds: ["h1", "h4"], tokenLimit: 100 });
    expect(settings.updatePerson(ana.id, { tokenLimit: null }).tokenLimit).toBeNull();
    expect(reasonOf(() => settings.updatePerson("nope", { name: "x" }))).toBe("person_not_found");
    settings.removePerson(ana.id);
    expect(settings.data().people).toEqual([]);
    expect(settings.addPerson({ name: "Bia", hostIds: ["h1"] }).hostIds).toEqual(["h1"]);
  });

  test("people persist, are left out of nothing by an export, and an import merges them by id", () => {
    const a = setup();
    a.settings.addPerson({ name: "Ana", hostIds: ["h1"], tokenLimit: 10 });
    const text = a.settings.exportJson();
    const b = setup();
    b.settings.addPerson({ name: "Other", hostIds: ["h9"] });
    expect(b.settings.importJson(text)).toEqual({ people: 1 });
    expect(
      b.settings
        .data()
        .people.map((p) => p.name)
        .sort(),
    ).toEqual(["Ana", "Other"]);
    expect(a.make().data().people).toHaveLength(1);
  });

  test("an import that would put a host in two people keeps the person already there", () => {
    const a = setup();
    a.settings.addPerson({ name: "Ana", hostIds: ["h1"] });
    const text = a.settings.exportJson();
    const b = setup();
    b.settings.addPerson({ name: "Bia", hostIds: ["h1"] });
    expect(b.settings.importJson(text)).toEqual({ people: 0 });
    expect(b.settings.data().people.map((p) => p.name)).toEqual(["Bia"]);
  });
});
