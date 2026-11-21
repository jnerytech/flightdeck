import { describe, expect, test } from "bun:test";
import {
  describeDefinition,
  savedDefinitionFiles,
} from "../../src/permissions/domain/action-save-view.ts";

describe("savedDefinitionFiles: the file each action save of a command line reads (#3752)", () => {
  test("it is the value of --definition-file, however the CLI is reached", () => {
    expect([
      savedDefinitionFiles("fd action save --definition-file d.json"),
      savedDefinitionFiles(
        "flightdeckd --host pi action save --project api --definition-file /tmp/x.json --secret-ids token",
      ),
      savedDefinitionFiles("fd action save --definition-file=d.json"),
      savedDefinitionFiles("bash -c 'fd action save --definition-file d.json'"),
      savedDefinitionFiles('fd action save --definition-file "my dir/d.json"'),
    ]).toEqual([["d.json"], ["/tmp/x.json"], ["d.json"], ["d.json"], ["my dir/d.json"]]);
  });

  test("each save of a line is one entry, in order, and a save with no file is a null", () => {
    expect(
      savedDefinitionFiles(
        "fd action save --definition-file a.json && fd action save --definition-file b.json; fd action save",
      ),
    ).toEqual(["a.json", "b.json", null]);
  });

  test("a flag given twice names no file: the CLI keeps the last, so the first is not what is saved", () => {
    expect([
      savedDefinitionFiles("fd action save --definition-file ok.json --definition-file evil.json"),
      savedDefinitionFiles("fd action save --definition-file=ok.json --definition-file evil.json"),
    ]).toEqual([[null], [null]]);
  });

  test("a relative file after a change of folder names no file: the shell reads it from elsewhere", () => {
    expect(
      [
        "cd sub && fd action save --definition-file d.json",
        "pushd sub; fd action save --definition-file d.json",
        "bash -c 'cd sub && fd action save --definition-file d.json'",
        "env -C sub fd action save --definition-file d.json",
        "env --chdir=sub fd action save --definition-file d.json",
      ].map(savedDefinitionFiles),
    ).toEqual([[null], [null], [null], [null], [null]]);
  });

  test("an absolute file is still shown after a change of folder, and a word like cd inside an argument is no change", () => {
    expect([
      savedDefinitionFiles("cd sub && fd action save --definition-file /tmp/d.json"),
      savedDefinitionFiles("fd action save --definition-file abcd.json"),
    ]).toEqual([["/tmp/d.json"], ["abcd.json"]]);
  });

  test("trust, remove, the reads and run name no file, and a word in an argument is no save", () => {
    expect(
      [
        "fd action trust deploy --hash abc",
        "fd action remove deploy",
        "fd action list --json",
        "fd action run deploy",
        "fd automation save api --definition-file a.json",
        "fd message send fd-qa 'action save --definition-file a.json'",
        "echo action save --definition-file a.json",
      ].map(savedDefinitionFiles),
    ).toEqual([[], [], [], [], [], [], []]);
  });
});

const DEFINITION = JSON.stringify({
  name: "deploy",
  description: "ships",
  run: ["deploy.sh", "--prod"],
  cwd: "/srv/api",
  env: { TOKEN: "{{secret.token}}", REGION: "eu" },
  params: {},
  timeoutS: 60,
});

describe("describeDefinition: what the person reads in the request (#3752)", () => {
  test("it shows the name, the run line, the cwd, the env names and the secret ids", () => {
    expect(describeDefinition("d.json", DEFINITION)).toBe(
      'saves d.json: name "deploy"; run ["deploy.sh","--prod"]; cwd "/srv/api"; env TOKEN, REGION; secrets token',
    );
  });

  test("an env value is never shown, a secret reference only as its id", () => {
    const shown = describeDefinition(
      "d.json",
      JSON.stringify({
        name: "a",
        run: ["x"],
        env: { K: "literal-password-123", S: "{{secretFile.cert}}" },
      }),
    );
    expect(shown.includes("literal-password-123")).toBe(false);
    expect(shown).toContain("env K, S");
    expect(shown).toContain("secrets cert");
  });

  test("a host or ssh destination is said, since it moves where the command runs", () => {
    const shown = describeDefinition(
      "d.json",
      JSON.stringify({ name: "a", run: ["x"], env: {}, ssh: "prod-box", host: "pi" }),
    );
    expect(shown).toContain('ssh "prod-box"');
    expect(shown).toContain('host "pi"');
  });

  test("a run line over the limit shows its start and says how many characters were cut", () => {
    const long = "a".repeat(500);
    const shown = describeDefinition(
      "d.json",
      JSON.stringify({ name: "a", run: ["sh", "-c", long], env: {} }),
    );
    expect(shown).toContain('run ["sh","-c","aaaa');
    expect(shown).toMatch(/… \d+ more characters not shown;/);
    expect(shown.length).toBeLessThan(700);
  });

  test("a run line that was cut tells the person to deny unless they know the rest", () => {
    const shown = describeDefinition(
      "d.json",
      JSON.stringify({ name: "a", run: ["sh", "-c", "a".repeat(500)], env: {} }),
    );
    expect(shown).toContain("the rest of run was not shown: deny it unless you know what it holds");
  });

  test("a run line that fits has no such warning", () => {
    expect(describeDefinition("d.json", JSON.stringify({ run: ["x"] }))).not.toContain(
      "the rest of run",
    );
  });

  test("the cut count is the exact rest of the run line", () => {
    const run = ["sh", "-c", "b".repeat(400)];
    const whole = JSON.stringify(run);
    const shown = describeDefinition("d.json", JSON.stringify({ name: "a", run, env: {} }));
    const match = /… (\d+) more characters not shown/.exec(shown);
    expect(Number(match?.[1])).toBe(whole.length - 300);
  });

  test("a file that could not be read says so, and says why the person should deny", () => {
    expect(describeDefinition("d.json", null)).toBe(
      "d.json: its content could not be shown (unreadable, too large or not one JSON object): deny it unless you know what it holds",
    );
  });

  test.each([
    ["an array", "[1,2]"],
    ["text", "not json"],
    ["null", "null"],
    ["a number", "7"],
  ])(
    "a file that holds %s is not one JSON object, so its content could not be shown",
    (_label, text) => {
      expect(describeDefinition("d.json", text)).toContain("its content could not be shown");
    },
  );

  test("a save with no file named says the line names none", () => {
    expect(describeDefinition(null, null)).toBe(
      "no definition file was found in the command: its content could not be shown, deny it unless you know what it holds",
    );
  });

  test("a control character or a terminal escape in a name cannot reach the person raw, and emoji stay", () => {
    const shown = describeDefinition(
      "d.json",
      JSON.stringify({ name: "a\u001b[2J🙂\nb", run: ["x"], env: {} }),
    );
    expect(shown.includes("\u001b")).toBe(false);
    expect(shown.includes("\n")).toBe(false);
    expect(shown).toContain("🙂");
  });

  test("approval and tags are shown, and approval never is said as no prompt", () => {
    const text = (extra: Record<string, unknown>) =>
      describeDefinition("d.json", JSON.stringify({ run: ["x"], ...extra }));
    expect([
      text({ approval: "never" }).includes("approval never (no approval is asked when it runs)"),
      text({ approval: "always" }).includes("approval always"),
      text({ tags: ["prod", "db"] }).includes("tags prod, db"),
      text({}).includes("approval"),
    ]).toEqual([true, true, true, false]);
  });

  test("bidi overrides, line separators and C1 controls in run, name, cwd, host or ssh never reach the person raw", () => {
    const hostile = "a\u202eb\u2028c\u009bd\u2066e";
    const out = describeDefinition(
      "d.json",
      JSON.stringify({ name: hostile, run: [hostile], cwd: hostile, host: hostile, ssh: hostile }),
    );
    expect(/[\u202a-\u202e\u2028\u2029\u2066-\u2069\u0080-\u009f]/.test(out)).toBe(false);
  });

  test("a run that is not a list of text is said, not hidden", () => {
    expect(
      describeDefinition("d.json", JSON.stringify({ name: "a", run: "rm -rf /", env: {} })),
    ).toContain("run is not a list of text");
  });
});
