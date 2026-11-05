import { describe, expect, test } from "bun:test";
import type { Notice } from "../src/lib/app-store.ts";
import {
  ERROR_TOAST_MS,
  noticeAction,
  noticeLifetime,
  SUCCESS_TOAST_MS,
} from "../src/lib/notice-lifetime.ts";

const success: Notice = { id: 1, kind: "success", code: "", text: "saved" };
const error: Notice = { id: 2, kind: "error", code: "invalid_state", text: "no" };
const outside: Notice = {
  id: 3,
  kind: "error",
  code: "forbidden_cwd",
  text: "outside",
  reason: "cwd_outside_roots",
  params: { cwd: "D:\\myVault" },
  hostId: "h1",
};

describe("how long a toast stays", () => {
  test("a success goes after about five seconds", () => {
    expect(SUCCESS_TOAST_MS).toBe(5000);
    expect(noticeLifetime(success)).toBe(SUCCESS_TOAST_MS);
  });

  test("a success with a button to press stays as long as an error, so it can be reached", () => {
    const withLink: Notice = { ...success, link: { label: "Open", run: () => {} } };
    expect(noticeLifetime(withLink)).toBe(ERROR_TOAST_MS);
  });

  test("an error stays longer, about ten seconds", () => {
    expect(ERROR_TOAST_MS).toBe(10_000);
    expect(noticeLifetime(error)).toBe(ERROR_TOAST_MS);
  });

  test("a toast with an action waits until it is acted on", () => {
    expect(noticeLifetime(outside)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("the action of a refusal", () => {
  test("a folder outside the allowed ones offers to add it on its host", () => {
    expect(noticeAction(outside)).toEqual({
      type: "allow-root",
      hostId: "h1",
      folder: "D:\\myVault",
    });
  });

  test("it needs the host and the folder; any other error has none", () => {
    expect(noticeAction(error)).toBeNull();
    expect(noticeAction({ ...outside, hostId: undefined })).toBeNull();
    expect(noticeAction({ ...outside, params: {} })).toBeNull();
  });
});
