import { describe, expect, test } from "bun:test";
import {
  EFFORTS,
  isCurrentModel,
  MAIN_MODELS,
  MORE_MODELS,
  modelName,
} from "../src/lib/model-menu.ts";

describe("model-menu: the names", () => {
  test("a versioned id reads as the family and the version", () => {
    expect(modelName("claude-opus-5-5")).toBe("Opus 5.5");
    expect(modelName("claude-sonnet-5-5")).toBe("Sonnet 5.5");
    expect(modelName("claude-haiku-5-5")).toBe("Haiku 5.5");
    expect(modelName("claude-fable-5-1")).toBe("Fable 5.1");
  });

  test("an id with a single number, and a date suffix, keep what they have", () => {
    expect(modelName("claude-opus-5")).toBe("Opus 5");
    expect(modelName("claude-sonnet-4-5-20250929")).toBe("Sonnet 4.5");
  });

  test("an alias is the family alone", () => {
    expect(modelName("opus")).toBe("Opus");
    expect(modelName("haiku")).toBe("Haiku");
  });

  test("a bracketed context suffix is dropped, anything unknown is shown as it is", () => {
    expect(modelName("claude-opus-5-5[1m]")).toBe("Opus 5.5");
    expect(modelName("anthropic/some-model")).toBe("anthropic/some-model");
  });

  test("none, or an empty string, is null: the default model", () => {
    expect(modelName(null)).toBeNull();
    expect(modelName(undefined)).toBeNull();
    expect(modelName("")).toBeNull();
  });
});

describe("model-menu: which row is the model in use", () => {
  test("an id matches itself only", () => {
    expect(isCurrentModel("claude-opus-5-5", "claude-opus-5-5")).toBe(true);
    expect(isCurrentModel("claude-opus-5-5", "claude-opus-5-4")).toBe(false);
    expect(isCurrentModel("claude-opus-5-5", "opus")).toBe(false);
  });

  test("an alias matches itself and every version of its family", () => {
    expect(isCurrentModel("opus", "opus")).toBe(true);
    expect(isCurrentModel("opus", "claude-opus-5-5")).toBe(true);
    expect(isCurrentModel("opus", "claude-sonnet-5-5")).toBe(false);
  });

  test("the default row is the one when no model is chosen", () => {
    expect(isCurrentModel("", "")).toBe(true);
    expect(isCurrentModel("", "opus")).toBe(false);
    expect(isCurrentModel("opus", "")).toBe(false);
  });
});

describe("model-menu: the lists", () => {
  test("the efforts go from the lightest to max", () => {
    expect(EFFORTS).toEqual(["low", "medium", "high", "xhigh", "max"]);
  });

  test("the aliases come first and the versions under More models, none twice", () => {
    expect(MAIN_MODELS).toEqual(["opus", "sonnet", "haiku"]);
    expect(MORE_MODELS.every((id) => id.startsWith("claude-"))).toBe(true);
    expect(new Set([...MAIN_MODELS, ...MORE_MODELS]).size).toBe(
      MAIN_MODELS.length + MORE_MODELS.length,
    );
  });
});
