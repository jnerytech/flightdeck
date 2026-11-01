import { describe, expect, test } from "bun:test";
import { ACTION_ISSUE_CODES } from "@flightdeck/protocol";
import { en } from "../src/i18n/en.ts";
import { actionIssueText } from "../src/i18n/errors.ts";
import { translator } from "../src/i18n/index.ts";
import { ptBR } from "../src/i18n/pt-BR.ts";

const enT = translator("en");
const ptT = translator("pt-BR");

describe("recusas-acoes: what is wrong in an action, said in the app's language", () => {
  test("every kind of issue has a text in both languages", () => {
    expect(ACTION_ISSUE_CODES.length).toBe(25);
    for (const code of ACTION_ISSUE_CODES) {
      expect(typeof (en.actionIssue as Record<string, string>)[code]).toBe("string");
      expect(typeof (ptBR.actionIssue as Record<string, string>)[code]).toBe("string");
    }
  });

  test("an issue is the action's name, then one sentence with its params", () => {
    const issue = { path: "deploy", code: "param_undeclared", params: { param: "env" } };
    expect(actionIssueText(issue, enT)).toBe("deploy: The parameter env is used but not declared.");
    expect(actionIssueText(issue, ptT)).toBe(
      "deploy: O parâmetro env é usado mas não foi declarado.",
    );
    expect(actionIssueText({ path: "", code: "file_not_list" }, enT)).toBe(
      "The actions file is a list of actions.",
    );
  });

  test("a code the app does not know shows the code, not nothing", () => {
    expect(actionIssueText({ path: "x", code: "from_the_future" }, enT)).toBe("x: from_the_future");
  });
});
