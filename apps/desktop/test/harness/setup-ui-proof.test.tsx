import { describe, expect, test } from "bun:test";
import { settleMaybe } from "../wait.ts";
import { ALL, act, cleanup, click, open, render, SETTINGS, setup } from "./setup-ui-setup.tsx";

/**
 * Issue #3507: writing a project's setup is signed by an enrolled device over the whole request, after the
 * person confirmed it in the app. A no in the device's dialog, or a signing that fails, writes nothing.
 */
const DIGESTS = { [SETTINGS]: "d-settings", "CLAUDE.md": "d-claude" };
const BODY = { path: "/work/api", parts: ALL, digests: DIGESTS, confirm: true };

async function applyWith(proof: "signed" | "declined" | "fails") {
  const t = setup({ proof });
  await act(async () => {
    render(t.view);
  });
  await open();
  await click("Apply the setup", true);
  return t;
}

describe("setup-ui-proof: the setup is written with the proof of a device when the host asks for it", () => {
  test("the apply is signed over the path, the parts, the digests and confirm, and what is sent carries the proof", async () => {
    const t = await applyWith("signed");
    await settleMaybe(() => t.count("project.harness.apply") === 1);
    expect([t.signed, t.sent.find(([type]) => type === "project.harness.apply")?.[1]]).toEqual([
      [BODY],
      { ...BODY, proof: { keyId: "k", nonce: "n", signature: "s" } },
    ]);
    cleanup();
  });

  test("a no in the device's dialog sends nothing and says nothing went wrong", async () => {
    const t = await applyWith("declined");
    await settleMaybe(() => t.signed.length === 1);
    expect([t.signed.length, t.count("project.harness.apply"), t.errors]).toEqual([1, 0, []]);
    cleanup();
  });

  test("a signing that fails sends nothing and tells the person why", async () => {
    const t = await applyWith("fails");
    await settleMaybe(() => t.errors.length === 1);
    expect([t.count("project.harness.apply"), t.errors]).toEqual([0, ["no key on this device"]]);
    cleanup();
  });

  test("with the proof off, the setup goes out as before", async () => {
    const t = setup();
    await act(async () => {
      render(t.view);
    });
    await open();
    await click("Apply the setup", true);
    await settleMaybe(() => t.count("project.harness.apply") === 1);
    expect([
      t.signed.length,
      t.sent.find(([type]) => type === "project.harness.apply")?.[1],
    ]).toEqual([0, BODY]);
    cleanup();
  });
});
