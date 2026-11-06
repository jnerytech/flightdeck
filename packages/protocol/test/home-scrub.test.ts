import { describe, expect, test } from "bun:test";
import { scrubHome } from "../src/snippets.ts";

describe("home-scrub: the user's name is not copied into a log (issue #255)", () => {
  test("the common home folders of Linux, macOS and Windows become ~", () => {
    expect(scrubHome("open /home/ana/.flightdeck/logs/x.log failed")).toBe(
      "open ~/.flightdeck/logs/x.log failed",
    );
    expect(scrubHome("read /Users/Ana/Library/Logs/f.log")).toBe("read ~/Library/Logs/f.log");
    expect(scrubHome("read C:\\Users\\Ana\\AppData\\Roaming\\f.log")).toBe(
      "read ~\\AppData\\Roaming\\f.log",
    );
    expect(scrubHome('{"p":"C:\\\\Users\\\\Ana\\\\f.log"}')).toBe('{"p":"~\\\\f.log"}');
    expect(scrubHome("d:\\users\\bob\\x")).toBe("~\\x");
  });

  test("a known home is replaced whatever it looks like, including a name with spaces", () => {
    expect(
      scrubHome("in C:\\Users\\Ana Maria\\repo and /srv/home-of-ana/x", "C:\\Users\\Ana Maria"),
    ).toBe("in ~\\repo and /srv/home-of-ana/x");
    expect(scrubHome("in /srv/ana/repo", "/srv/ana")).toBe("in ~/repo");
    expect(scrubHome("same /srv/ana", "/srv/ana/")).toBe("same ~");
  });

  test("other paths and short homes are left alone, and scrubbing twice changes nothing", () => {
    for (const text of ["/homework/x", "/home/", "/Users/", "/var/log/x", "~/repo"]) {
      expect(scrubHome(text)).toBe(text);
    }
    expect(scrubHome("a /x b", "/")).toBe("a /x b");
    expect(scrubHome("a /x b", "")).toBe("a /x b");
    const once = scrubHome("/home/ana/x and /home/bob/y");
    expect(once).toBe("~/x and ~/y");
    expect(scrubHome(once)).toBe(once);
  });
});
