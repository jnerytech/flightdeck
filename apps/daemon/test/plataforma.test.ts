import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { testHome } from "../../../scripts/test/temp-dir.ts";
import { defaultConfigPath, expandHome, userHome } from "../src/config.ts";
import { osServiceContext } from "../src/service-os.ts";

describe("plataforma", () => {
  test("o home vem do ambiente na hora da chamada: HOME, ou USERPROFILE no Windows", () => {
    // Bun's os.homedir() on Linux keeps the HOME the process started with; Node reads it on
    // every call. The daemon follows the environment, as Node does.
    expect(userHome({ HOME: "/home/x", USERPROFILE: "C:\\Users\\y" }, "linux")).toBe("/home/x");
    expect(userHome({ HOME: "/c/x", USERPROFILE: "C:\\Users\\y" }, "win32")).toBe("C:\\Users\\y");
    expect(userHome({}, "linux")).toBe(homedir());
    expect(userHome({ HOME: "" }, "linux")).toBe(homedir());
  });

  test("expandHome, a config padrão e o contexto do serviço usam o home do ambiente", () => {
    const home = testHome();
    expect(userHome()).toBe(home);
    expect(expandHome("~")).toBe(home);
    expect(expandHome("~/a")).toBe(join(home, "a"));
    expect(defaultConfigPath()).toBe(join(home, ".flightdeck", "config.json"));
    expect(osServiceContext(true).home).toBe(home);
  });

  test("um ~ fora do começo do caminho não é o home", () => {
    for (const path of ["C:\\Users\\RUNNER~1\\x", "/tmp/a~b", "a~", "~user/x"]) {
      expect(expandHome(path)).toBe(path);
    }
  });
});
