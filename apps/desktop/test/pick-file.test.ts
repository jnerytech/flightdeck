import { describe, expect, test } from "bun:test";
import {
  PICKED_FILE_MAX_BYTES,
  type PickableFile,
  type PickDocument,
  type PickInput,
  pickWithInput,
} from "../src/platform/pick-file.ts";

/** A file input that records what the picker does and lets the test play the person. */
function fakeDocument() {
  const listeners = new Map<string, () => void>();
  const input: PickInput & { clicked: number } = {
    type: "",
    files: null,
    clicked: 0,
    click() {
      this.clicked++;
    },
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
  };
  const doc: PickDocument = { createElement: () => input };
  return {
    doc,
    input,
    choose(file: PickableFile | null) {
      input.files = file ? [file] : [];
      listeners.get("change")?.();
    },
    cancel() {
      listeners.get("cancel")?.();
    },
  };
}

const file = (name: string, text: string, size = text.length): PickableFile => ({
  name,
  size,
  text: async () => text,
});

describe("pick-file: the browser's file dialog through a file input", () => {
  test("opens a file input and answers with the chosen file's name and text", async () => {
    const page = fakeDocument();
    const picked = pickWithInput(page.doc);
    page.choose(file("backup.fdbackup", "armored text"));
    expect([await picked, page.input.type, page.input.clicked]).toEqual([
      { path: "backup.fdbackup", text: "armored text" },
      "file",
      1,
    ]);
  });

  test("a cancelled dialog answers null", async () => {
    const page = fakeDocument();
    const picked = pickWithInput(page.doc);
    page.cancel();
    expect(await picked).toBeNull();
  });

  test("a change with no file answers null", async () => {
    const page = fakeDocument();
    const picked = pickWithInput(page.doc);
    page.choose(null);
    expect(await picked).toBeNull();
  });

  test("a file over the cap is refused with a reason, and its text is never read", async () => {
    const page = fakeDocument();
    let read = 0;
    const big: PickableFile = {
      name: "huge.bin",
      size: PICKED_FILE_MAX_BYTES + 1,
      text: async () => {
        read++;
        return "x";
      },
    };
    const picked = pickWithInput(page.doc).then(
      (value) => ({ value }),
      (error: Error) => ({ error: error.message }),
    );
    page.choose(big);
    expect([await picked, read]).toEqual([{ error: "the file is too big to be a key" }, 0]);
  });

  test("a file of exactly the cap is read", async () => {
    const page = fakeDocument();
    const picked = pickWithInput(page.doc);
    page.choose(file("edge", "ok", PICKED_FILE_MAX_BYTES));
    expect(await picked).toEqual({ path: "edge", text: "ok" });
  });
});
