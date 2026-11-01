import { expect, setDefaultTimeout, test } from "bun:test";
import { seedDemo } from "../../../scripts/demo-seed.ts";

setDefaultTimeout(60_000);

test("stopping the demo seed puts PATH back, with no fake CLI left on it", async () => {
  const before = process.env.PATH;
  const home = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  const seed = await seedDemo();
  expect(process.env.PATH).not.toBe(before);
  await seed.stop();
  for (const [key, value] of Object.entries(home)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  expect(process.env.PATH).toBe(before);
});
