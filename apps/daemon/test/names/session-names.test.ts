import { describe, expect, test } from "bun:test";
import { aliasName, displayName, projectName, slug } from "../src/names/format.ts";
import { Names } from "../src/names/names.ts";
import { EventStore } from "../src/store/event-store.ts";

const code = (fn: () => unknown): string => {
  try {
    fn();
    return "ok";
  } catch (error) {
    return (error as { code?: string }).code ?? (error as Error).message;
  }
};

const newNames = () => {
  const store = new EventStore(":memory:");
  return { names: new Names(store.db), store };
};

describe("nomes-sessao: o formato", () => {
  test("o apelido é minúsculo, sem acento e com hífens", () => {
    expect(slug("Revisor de Código!")).toBe("revisor-de-codigo");
    expect(slug("  --Meu   Projeto--  ")).toBe("meu-projeto");
    expect(slug("Ação/Segurança")).toBe("acao-seguranca");
  });

  test("o projeto é o fim da chave do repositório, ou o nome da pasta", () => {
    expect(projectName("github.com/acme/app")).toBe("app");
    expect(projectName("D:\\repos\\flightdeck")).toBe("flightdeck");
    expect(projectName("/home/ana/meu projeto/")).toBe("meu projeto");
    expect(projectName("")).toBe("sem-projeto");
  });

  test("projeto · persona · número, com geral quando não há persona", () => {
    expect(displayName({ project: "flightdeck", persona: "revisor", number: 3 })).toBe(
      "flightdeck · revisor · 3",
    );
    expect(displayName({ project: "flightdeck", persona: null, number: 1 })).toBe(
      "flightdeck · geral · 1",
    );
    expect(aliasName({ project: "flightdeck", persona: "revisor", number: 3 })).toBe(
      "flightdeck-revisor-3",
    );
    expect(aliasName({ project: "Meu App", persona: "Revisor Sênior", number: 2 })).toBe(
      "meu-app-revisor-senior-2",
    );
    expect(aliasName({ project: "!!!", persona: "???", number: 1 })).toBe("sem-projeto-geral-1");
  });

  test("o card entra com o número do card, e a segunda sessão do card leva o seu número depois", () => {
    const card = { project: "flightdeck", persona: "revisor", cardNumber: 42 };
    expect(displayName({ ...card, number: 1 })).toBe("flightdeck · revisor · card 42");
    expect(aliasName({ ...card, number: 1 })).toBe("flightdeck-revisor-card-42");
    expect(displayName({ ...card, number: 2 })).toBe("flightdeck · revisor · card 42 · 2");
    expect(aliasName({ ...card, number: 2 })).toBe("flightdeck-revisor-card-42-2");
  });
});

describe("nomes-sessao: a sequência e o apelido", () => {
  test("o número é por projeto e persona, e sem persona vale geral", () => {
    const { names } = newNames();
    const a = names.assign("s1", { project: "flightdeck", persona: "revisor" });
    const b = names.assign("s2", { project: "flightdeck", persona: "revisor" });
    const c = names.assign("s3", { project: "flightdeck", persona: "autor" });
    const d = names.assign("s4", { project: "outro", persona: "revisor" });
    const e = names.assign("s5", { project: "flightdeck" });
    expect([a, b, c, d, e].map((n) => n.display)).toEqual([
      "flightdeck · revisor · 1",
      "flightdeck · revisor · 2",
      "flightdeck · autor · 1",
      "outro · revisor · 1",
      "flightdeck · geral · 1",
    ]);
    expect([a, b, c, d, e].map((n) => n.alias)).toEqual([
      "flightdeck-revisor-1",
      "flightdeck-revisor-2",
      "flightdeck-autor-1",
      "outro-revisor-1",
      "flightdeck-geral-1",
    ]);
  });

  test("a mesma sessão não ganha dois nomes", () => {
    const { names } = newNames();
    const first = names.assign("s1", { project: "flightdeck" });
    const again = names.assign("s1", { project: "flightdeck" });
    expect(again).toEqual(first);
    expect(names.assign("s2", { project: "flightdeck" }).display).toBe("flightdeck · geral · 2");
    expect(names.get("s1")).toEqual(first);
    expect(names.get("nada")).toBeNull();
  });

  test("o número nunca é reaproveitado: apagar a linha da sessão, ou reiniciar o daemon, não volta a contar", () => {
    const { names, store } = newNames();
    names.assign("s1", { project: "flightdeck" });
    names.assign("s2", { project: "flightdeck" });
    store.db.exec("DELETE FROM session_names");
    expect(names.assign("s3", { project: "flightdeck" }).display).toBe("flightdeck · geral · 3");
    const restarted = new Names(store.db);
    expect(restarted.assign("s4", { project: "flightdeck" }).display).toBe(
      "flightdeck · geral · 4",
    );
    // The alias stays reserved for the session that had it, so no other can take it.
    expect(restarted.resolve("flightdeck-geral-1")).toBe("s1");
  });

  test("dois projetos de nome parecido não repetem o apelido", () => {
    const { names } = newNames();
    const a = names.assign("s1", { project: "Meu App" });
    const b = names.assign("s2", { project: "meu-app" });
    expect(a.alias).toBe("meu-app-geral-1");
    expect(b.alias).toBe("meu-app-geral-2");
    expect(new Set([a.alias, b.alias]).size).toBe(2);
  });

  test("o apelido endereça a sessão, e um apelido que ninguém tem não endereça nada", () => {
    const { names } = newNames();
    names.assign("s1", { project: "flightdeck", persona: "revisor" });
    expect(names.resolve("flightdeck-revisor-1")).toBe("s1");
    expect(names.resolve("flightdeck-revisor-2")).toBeNull();
    expect(names.list().map((n) => n.id)).toEqual(["s1"]);
  });
});

describe("nomes-sessao: o card", () => {
  test("o número do card é por projeto e não se repete; cada nova sessão do card leva o seu número", () => {
    const { names } = newNames();
    const first = names.assign("s1", { project: "flightdeck", persona: "autor", cardId: "c-a" });
    const second = names.assign("s2", { project: "flightdeck", persona: "autor", cardId: "c-b" });
    const rerun = names.assign("s3", { project: "flightdeck", persona: "autor", cardId: "c-a" });
    expect(first).toMatchObject({ display: "flightdeck · autor · card 1", cardNumber: 1 });
    expect(second).toMatchObject({ display: "flightdeck · autor · card 2", cardNumber: 2 });
    expect(rerun).toMatchObject({ display: "flightdeck · autor · card 1 · 2", cardNumber: 1 });
    expect(rerun.alias).toBe("flightdeck-autor-card-1-2");
    // The card's numbers do not eat the sequence of the sessions that are not of a card.
    expect(names.assign("s4", { project: "flightdeck", persona: "autor" }).display).toBe(
      "flightdeck · autor · 1",
    );
  });
});

describe("nomes-sessao: renomear e a persona que chega depois", () => {
  test("renomear troca o nome, o apelido antigo continua valendo e o novo nome gera um apelido", () => {
    const { names } = newNames();
    names.assign("s1", { project: "flightdeck" });
    const renamed = names.rename("s1", "Revisão do login");
    expect(renamed.display).toBe("Revisão do login");
    expect(renamed.alias).toBe("flightdeck-geral-1");
    expect(renamed.aliases).toEqual(["flightdeck-geral-1", "revisao-do-login"]);
    expect(names.resolve("flightdeck-geral-1")).toBe("s1");
    expect(names.resolve("revisao-do-login")).toBe("s1");
    expect(names.get("s1")?.display).toBe("Revisão do login");
  });

  test("renomear para um nome cujo apelido é de outra sessão muda o nome, mas não rouba o apelido", () => {
    const { names } = newNames();
    names.assign("s1", { project: "flightdeck" });
    names.assign("s2", { project: "flightdeck" });
    const renamed = names.rename("s2", "flightdeck geral 1");
    expect(renamed.display).toBe("flightdeck geral 1");
    expect(renamed.aliases).toEqual(["flightdeck-geral-2"]);
    expect(names.resolve("flightdeck-geral-1")).toBe("s1");
  });

  test("a persona que chega depois dá um número novo sob ela e guarda o apelido de antes", () => {
    const { names } = newNames();
    names.assign("s1", { project: "flightdeck" });
    names.assign("s2", { project: "flightdeck", persona: "revisor" });
    const moved = names.setPersona("s1", "revisor");
    expect(moved).toMatchObject({ display: "flightdeck · revisor · 2", persona: "revisor" });
    expect(moved.aliases).toEqual(["flightdeck-geral-1", "flightdeck-revisor-2"]);
    expect(names.resolve("flightdeck-geral-1")).toBe("s1");
    expect(names.resolve("flightdeck-revisor-2")).toBe("s1");
    // The same persona again changes nothing; the number it left is not given to anyone.
    expect(names.setPersona("s1", "revisor")).toEqual(moved);
    expect(names.assign("s3", { project: "flightdeck" }).display).toBe("flightdeck · geral · 2");
  });

  test("um apelido que o renomear já tomou faz o número do próximo pular", () => {
    const { names } = newNames();
    names.assign("s1", { project: "flightdeck" });
    names.rename("s1", "flightdeck geral 2");
    const next = names.assign("s2", { project: "flightdeck" });
    expect(next).toMatchObject({ display: "flightdeck · geral · 3", number: 3 });
    expect(next.alias).toBe("flightdeck-geral-3");
  });

  test("o endereço não diferencia maiúsculas nem espaços nas pontas", () => {
    const { names } = newNames();
    names.assign("s1", { project: "flightdeck" });
    expect(names.resolve("  Flightdeck-Geral-1 ")).toBe("s1");
  });

  test("um nome em branco não renomeia nada, e uma persona em branco vale geral", () => {
    const { names } = newNames();
    names.assign("s1", { project: "flightdeck", persona: "  " });
    expect(code(() => names.rename("s1", "   "))).toBe("bad_request");
    expect(names.get("s1")?.display).toBe("flightdeck · geral · 1");
  });

  test("renomear ou pôr persona numa sessão sem nome é not_found", () => {
    const { names } = newNames();
    expect(code(() => names.rename("nada", "x"))).toBe("not_found");
    expect(code(() => names.setPersona("nada", "revisor"))).toBe("not_found");
  });
});
