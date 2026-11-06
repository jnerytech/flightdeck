import { describe, expect, test } from "bun:test";
import { viteCommands } from "../lib/demo-vite.ts";

const base = { bun: "/bin/bun", vite: "/d/vite.js", port: 4321, outDir: "/tmp/demo-dist" };

describe("demo-vite: the dev server for a person, a built bundle for CI (#444)", () => {
  test("without DEMO_BUILD the demo serves Vite's dev server on the port", () => {
    expect(viteCommands({ ...base, env: {} })).toEqual({
      build: null,
      serve: ["/bin/bun", "/d/vite.js", "--port", "4321", "--strictPort"],
    });
  });

  test("DEMO_BUILD=1 builds into the folder, then serves it with vite preview on the port", () => {
    expect(viteCommands({ ...base, env: { DEMO_BUILD: "1" } })).toEqual({
      build: ["/bin/bun", "/d/vite.js", "build", "--outDir", "/tmp/demo-dist", "--emptyOutDir"],
      serve: [
        "/bin/bun",
        "/d/vite.js",
        "preview",
        "--outDir",
        "/tmp/demo-dist",
        "--port",
        "4321",
        "--strictPort",
      ],
    });
  });

  test("any other DEMO_BUILD value keeps the dev server", () => {
    for (const value of ["", "0", "true"]) {
      expect(viteCommands({ ...base, env: { DEMO_BUILD: value } }).build).toBeNull();
    }
  });
});
