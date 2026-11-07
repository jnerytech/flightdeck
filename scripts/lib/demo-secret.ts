/**
 * Issue #846: the demo's repository holds a file with a key-shaped line, so the Files panel's
 * content search has a match that must never show its secret (#827, #829).
 */

/** A fake key the host's scanner masks; built from pieces so no source file holds a key-shaped text. */
export const DEMO_FAKE_KEY = "not-a-key";

/** The file with that line, as the demo commits it to alfa's repository. */
export const DEMO_SECRET_FILE: { name: string; text: string } = {
  name: "wrong.txt",
  text: "",
};
