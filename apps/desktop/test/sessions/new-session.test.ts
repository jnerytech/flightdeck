import { describe, expect, test } from "bun:test";
import {
  choicesToKeep,
  createPayload,
  joinPath,
  opensMoreOptions,
  promptMissing,
  sessionModes,
  startChoices,
  startFolder,
  underRoot,
} from "../../src/features/sessions/domain/new-session.ts";

describe("joinPath", () => {
  test("joins with the root's own separator and drops the separators around the subfolder", () => {
    expect(joinPath("/home/ana/", "/app/api")).toBe("/home/ana/app/api");
    expect(joinPath("C:\\work", "\\app")).toBe("C:\\work\\app");
  });

  test("a blank subfolder is the root itself", () => {
    expect(joinPath("/home/ana", "  ")).toBe("/home/ana");
  });
});

describe("underRoot", () => {
  test("the longest root that holds the path, with the rest as the subfolder", () => {
    expect(underRoot("/home/ana/app/api", ["/home/ana", "/home/ana/app"])).toEqual({
      root: "/home/ana/app",
      sub: "api",
    });
  });

  test("a path that is a root itself has no subfolder, and one outside every root is none", () => {
    expect(underRoot("/home/ana", ["/home/ana"])).toEqual({ root: "/home/ana", sub: "" });
    expect(underRoot("/srv/x", ["/home/ana"])).toBeNull();
  });
});

describe("startFolder", () => {
  const roots = ["/a", "/b"];

  test("without a pick, the last folder used here while the host still allows it", () => {
    expect(
      startFolder({ roots, picked: null, typedSub: null, kept: { root: "/b", sub: "x" } }),
    ).toEqual({
      root: "/b",
      sub: "x",
    });
  });

  test("the last folder is dropped once its root is no longer allowed", () => {
    expect(
      startFolder({ roots, picked: null, typedSub: null, kept: { root: "/gone", sub: "x" } }),
    ).toEqual({
      root: "/a",
      sub: "",
    });
  });

  test("a pick wins over the remembered folder and takes none of its subfolder", () => {
    expect(
      startFolder({ roots, picked: "/a", typedSub: null, kept: { root: "/b", sub: "x" } }),
    ).toEqual({
      root: "/a",
      sub: "",
    });
  });

  test("a typed subfolder wins, and a host with no folders has no root", () => {
    expect(
      startFolder({ roots, picked: null, typedSub: "y", kept: { root: "/b", sub: "x" } }),
    ).toEqual({
      root: "/b",
      sub: "y",
    });
    expect(startFolder({ roots: [], picked: null, typedSub: null, kept: undefined })).toEqual({
      root: "",
      sub: "",
    });
  });
});

describe("sessionModes", () => {
  test("Claude offers every mode, OpenCode only its own, and bypass only where the host allows it", () => {
    expect(sessionModes(false, true)).toEqual([
      "default",
      "acceptEdits",
      "plan",
      "auto",
      "dontAsk",
      "bypassPermissions",
    ]);
    expect(sessionModes(false, false)).toEqual([
      "default",
      "acceptEdits",
      "plan",
      "auto",
      "dontAsk",
    ]);
    expect(sessionModes(true, true)).toEqual(["default", "plan", "bypassPermissions"]);
    expect(sessionModes(true, false)).toEqual(["default", "plan"]);
  });
});

describe("startChoices", () => {
  test("what the last session chose, while the form still offers it", () => {
    expect(startChoices({ mode: "plan", model: "haiku" })).toEqual({
      mode: "plan",
      model: "haiku",
    });
  });

  test("anything else, or nothing, starts from Default and the account's model", () => {
    expect(startChoices({ mode: "bogus" as never, model: "gpt" })).toEqual({
      mode: "default",
      model: "",
    });
    expect(startChoices(undefined)).toEqual({ mode: "default", model: "" });
  });
});

describe("choicesToKeep", () => {
  const last = { mode: "plan", model: "haiku" } as const;

  test("a Claude session keeps its own mode and model", () => {
    expect(choicesToKeep({ opencode: false, last, mode: "auto", model: "opus" })).toEqual({
      mode: "auto",
      model: "opus",
    });
  });

  test("an OpenCode session leaves the last ones alone", () => {
    expect(choicesToKeep({ opencode: true, last, mode: "default", model: "" })).toEqual(last);
  });
});

describe("opensMoreOptions", () => {
  test("opens for a subfolder, for OpenCode or for a setting of the screen's own, else stays folded", () => {
    expect(opensMoreOptions("api", false, false)).toBe(true);
    expect(opensMoreOptions("", true, false)).toBe(true);
    expect(opensMoreOptions("", false, true)).toBe(true);
    expect(opensMoreOptions("", false, false)).toBe(false);
  });
});

describe("promptMissing", () => {
  test("a required prompt that is blank is missing, except for OpenCode", () => {
    expect(promptMissing(true, false, "  ")).toBe(true);
    expect(promptMissing(true, false, "fix it")).toBe(false);
    expect(promptMissing(true, true, "")).toBe(false);
    expect(promptMissing(false, false, "")).toBe(false);
  });
});

describe("createPayload", () => {
  test("only the fields that are set go to the host, trimmed", () => {
    expect(
      createPayload({
        cwd: "/a",
        prompt: " hi ",
        mode: "plan",
        model: "opus",
        name: " n ",
        opencode: false,
        effort: "high",
      }),
    ).toEqual({ cwd: "/a", prompt: "hi", permissionMode: "plan", model: "opus", name: "n" });
    expect(
      createPayload({
        cwd: "/a",
        prompt: " ",
        mode: "default",
        model: "",
        name: "",
        opencode: false,
        effort: "",
      }),
    ).toEqual({ cwd: "/a", permissionMode: "default" });
  });

  test("an OpenCode session names its runtime and, when set, its effort", () => {
    expect(
      createPayload({
        cwd: "/a",
        prompt: "",
        mode: "default",
        model: "m",
        name: "",
        opencode: true,
        effort: "low",
      }),
    ).toEqual({
      cwd: "/a",
      permissionMode: "default",
      model: "m",
      runtime: "opencode",
      effort: "low",
    });
    expect(
      createPayload({
        cwd: "/a",
        prompt: "",
        mode: "default",
        model: "",
        name: "",
        opencode: true,
        effort: "",
      }),
    ).toEqual({ cwd: "/a", permissionMode: "default", runtime: "opencode" });
  });
});
