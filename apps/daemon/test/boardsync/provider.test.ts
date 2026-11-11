import { expect, test } from "bun:test";
import { providerContract } from "./contract.ts";
import { fakeHarness } from "./fake.ts";

providerContract("the fake provider", fakeHarness);

test("each harness builds its own fake provider, so a test never sees another's state", () => {
  expect(fakeHarness().provider).not.toBe(fakeHarness().provider);
});
