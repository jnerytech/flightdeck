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

test("stopping the demo seed puts HOME, USERPROFILE and SHELL back as they were, set or not (#301)", async () => {
  const names = ["HOME", "USERPROFILE", "SHELL"];
  const before = names.map((name) => process.env[name]);
  // One of them unset, to see that "unset" comes back unset and not as the text "undefined".
  const savedShell = process.env.SHELL;
  delete process.env.SHELL;
  const seed = await seedDemo();
  try {
    expect(process.env.HOME).not.toBe(before[0]);
    await seed.stop();
    expect(names.map((name) => process.env[name])).toEqual([before[0], before[1], undefined]);
  } finally {
    if (savedShell === undefined) delete process.env.SHELL;
    else process.env.SHELL = savedShell;
    for (const [i, name] of names.entries()) {
      if (name === "SHELL") continue;
      if (before[i] === undefined) delete process.env[name];
      else process.env[name] = before[i];
    }
  }
});
