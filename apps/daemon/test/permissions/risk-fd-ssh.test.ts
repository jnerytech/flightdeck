import { describe, expect, test } from "bun:test";
import { bash, MEDIUM, notHigh, wrongReasons } from "../support/permissions-risk-rules.ts";

const REASON =
  "changes which server keys a host trusts, without the person confirming it in the app (flightdeckd ssh hostkey confirm or forget)";

describe("risk rules: a session pinning or forgetting a server key from its shell (#3537)", () => {
  test("hostkey confirm and forget are high, however the CLI is reached", () => {
    expect(
      wrongReasons([
        ["fd ssh hostkey confirm prod --fingerprint SHA256:abc", REASON],
        ["fd ssh hostkey forget prod", REASON],
        ["flightdeckd ssh hostkey confirm prod --fingerprint SHA256:abc --json", REASON],
        ["fd --host pi ssh hostkey forget prod", REASON],
        ["fd --json --config /x/y.json ssh hostkey confirm t1 --fingerprint SHA256:abc", REASON],
        ["flightdeckd --config=/x/y.json ssh hostkey forget prod", REASON],
        ["~/.flightdeck/bin/fd ssh hostkey forget prod", REASON],
        ["FLIGHTDECK_X=1 fd ssh hostkey confirm prod --fingerprint SHA256:abc", REASON],
        ['fd ssh "hostkey" forget prod', REASON],
        ["fd ssh hostkey fo''rget prod", REASON],
        [
          "fd ssh hostkey check prod && fd ssh hostkey confirm prod --fingerprint SHA256:abc",
          REASON,
        ],
        ["bun run apps/daemon/src/bin.ts ssh hostkey forget prod", REASON],
        ["bun apps/daemon/src/bin.ts ssh --host pi hostkey forget prod", REASON],
        [
          "bun apps/daemon/src/bin.ts ssh hostkey --json confirm t1 --fingerprint SHA256:abc",
          REASON,
        ],
        ["npx flightdeckd --host pi ssh --json hostkey forget prod", REASON],
        ["bash -c 'fd ssh hostkey check a && fd ssh --host pi hostkey forget a'", REASON],
        ["bunx flightdeckd ssh hostkey confirm prod --fingerprint SHA256:abc", REASON],
        ['bash -c "fd ssh hostkey forget prod"', REASON],
        ["sh -c 'flightdeckd ssh hostkey confirm prod --fingerprint SHA256:abc'", REASON],
      ]),
    ).toEqual([]);
  });

  test("the reads stay ordinary shell commands, and a word in an argument is not a verb", () => {
    expect(
      notHigh([
        "fd ssh list --json",
        "fd ssh import preview",
        "fd ssh hostkey check prod",
        "fd --host pi ssh hostkey check prod --json",
        "fd ssh test prod",
        "fd send fd-qa 'please ssh hostkey confirm prod'",
        "echo ssh hostkey confirm",
        "bash -c 'echo ssh hostkey forget'",
        'bash -c "fd ssh hostkey check x && echo confirm"',
        "bun apps/daemon/src/bin.ts ssh --host pi hostkey check prod",
        "bash -c 'fd send fd-qa hi && echo ssh hostkey forget'",
        "ssh deploy@prod.internal",
        "ssh-keygen -R prod.internal",
      ]),
    ).toEqual([]);
    expect(bash("fd ssh hostkey check prod").reason).toBe(MEDIUM);
  });
});
