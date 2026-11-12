import { describe, test } from "bun:test";
import { isBranchName } from "@flightdeck/protocol";
import fc from "fast-check";
import { holds } from "../../../../scripts/test/property.ts";

/** A name made of well-formed parts: every one starts with a letter or digit and holds no dot. */
const part = fc.stringMatching(/^[a-z0-9][a-z0-9_-]{0,8}$/);
const validName = fc.array(part, { minLength: 1, maxLength: 4 }).map((parts) => parts.join("/"));

/** What a ref name may not hold anywhere (the FORBIDDEN rule of git-ref.ts). */
const forbidden = fc.constantFrom(
  " ",
  "~",
  "^",
  ":",
  "?",
  "*",
  "[",
  "\\",
  "..",
  "@{",
  "\t",
  "\u007f",
  "\u0000",
);

describe("branch names: properties of isBranchName", () => {
  test("a name of well-formed parts is accepted", () => {
    holds(fc.property(validName, (name) => isBranchName(name)));
  });

  test("a name never begins with a dash or an at sign, so no command reads it as an option or a file", () => {
    holds(
      fc.property(fc.constantFrom("-", "@"), validName, (lead, rest) => !isBranchName(lead + rest)),
    );
  });

  test("a forbidden character or sequence refuses the name wherever it sits", () => {
    holds(
      fc.property(validName, forbidden, fc.nat(), (name, bad, at) => {
        const cut = at % (name.length + 1);
        return !isBranchName(name.slice(0, cut) + bad + name.slice(cut));
      }),
    );
  });

  test("a part ending in .lock, a leading dot part, a trailing slash or a trailing dot refuse the name", () => {
    holds(
      fc.property(validName, (name) => {
        const [first = "", ...rest] = name.split("/");
        return (
          !isBranchName([`${first}.lock`, ...rest].join("/")) &&
          !isBranchName(`${name}/.hidden`) &&
          !isBranchName(`${name}/`) &&
          !isBranchName(`${name}.`)
        );
      }),
    );
  });

  test("a doubled slash or a leading slash refuses the name", () => {
    holds(
      fc.property(validName, (name) => !isBranchName(`${name}//x`) && !isBranchName(`/${name}`)),
    );
  });
});
