// Body of every fake CLI (see fake-cli.ts): `bun fake-cli-main.ts <stateDir> ...args`. Records
// the arguments and answers with the first rule whose `args` all appear in them (and whose
// `call`, when set, is the number of this call).
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { FakeRule } from "./fake-cli.ts";

const [stateDir = "", ...args] = process.argv.slice(2);
// What Bun refuses for a Windows .cmd shim: the call never happens, so nothing is recorded.
const { rejectCmdChars } = JSON.parse(readFileSync(join(stateDir, "options.json"), "utf8")) as {
  rejectCmdChars: boolean;
};
if (rejectCmdChars && args.some((a) => /[\r\n<>&|^"%]/.test(a))) {
  process.stderr.write(
    "fake: argumento com caractere especial do cmd.exe, recusado como o Bun faz\n",
  );
  process.exit(1);
}
appendFileSync(join(stateDir, "calls.jsonl"), `${JSON.stringify(args)}\n`);
appendFileSync(join(stateDir, "cwds.jsonl"), `${JSON.stringify(process.cwd())}\n`);
const call = readFileSync(join(stateDir, "calls.jsonl"), "utf8").trim().split(/\r?\n/).length;
const rules = JSON.parse(readFileSync(join(stateDir, "rules.json"), "utf8")) as FakeRule[];
const rule = rules.find(
  (r) => (r.call === undefined || r.call === call) && r.args.every((a) => args.includes(a)),
);
if (!rule) {
  process.stderr.write(`fake: sem resposta para ${JSON.stringify(args)}\n`);
  process.exit(1);
}
if (rule.stdout) process.stdout.write(rule.stdout);
process.exit(rule.code ?? 0);
