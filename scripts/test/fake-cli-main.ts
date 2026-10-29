// Body of every fake CLI (see fake-cli.ts): `bun fake-cli-main.ts <stateDir> ...args`. Records
// the arguments and answers with the first rule whose `args` all appear in them.
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { FakeRule } from "./fake-cli.ts";

const [stateDir = "", ...args] = process.argv.slice(2);
appendFileSync(join(stateDir, "calls.jsonl"), `${JSON.stringify(args)}\n`);
const rules = JSON.parse(readFileSync(join(stateDir, "rules.json"), "utf8")) as FakeRule[];
const rule = rules.find((r) => r.args.every((a) => args.includes(a)));
if (!rule) {
  process.stderr.write(`fake: sem resposta para ${JSON.stringify(args)}\n`);
  process.exit(1);
}
if (rule.stdout) process.stdout.write(rule.stdout);
process.exit(rule.code ?? 0);
