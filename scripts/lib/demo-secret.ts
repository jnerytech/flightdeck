/**
 * Issue #846: the demo's repository holds a file with a key-shaped line, so the Files panel's
 * content search has a match that must never show its secret (#827, #829).
 */

/** A fake key the host's scanner masks; built from pieces so no source file holds a key-shaped text. */
export const DEMO_FAKE_KEY = ["sk", "demo".repeat(6)].join("-");

/** The file with that line, as the demo commits it to alfa's repository. */
export const DEMO_SECRET_FILE: { name: string; text: string } = {
  name: "config.example.ts",
  text: `export const apiKey = "${DEMO_FAKE_KEY}"; // chave de exemplo\nexport const retries = 3;\n`,
};

/** A credential file (the host never sends a line of one): searching its content finds nothing. */
export const DEMO_CREDENTIAL_FILE: { name: string; text: string } = {
  name: "wrong.txt",
  text: "",
};
