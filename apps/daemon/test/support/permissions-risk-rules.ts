import { resolve } from "node:path";
import { RiskClassifier } from "../../src/permissions/domain/risk.ts";

export const HOME = resolve("/casa/u");
export const CWD = resolve("/trabalho/proj");
export const ROOT = resolve("/trabalho/outro");
const risk = new RiskClassifier({ allowedRoots: [ROOT], home: HOME });
export const classify = (tool: string, input: Record<string, unknown>) =>
  risk.classify(tool, input, CWD);
export const bash = (command: string) => classify("Bash", { command });

export const MEDIUM = "comando de shell";

/** Each command with the reason that makes it high; the first high reason wins a tie. */
export function wrongReasons(rows: Array<[string, string]>, tool = "Bash"): string[] {
  return rows.flatMap(([command, reason]) => {
    const got = classify(tool, { command });
    return got.level === "high" && got.reason === reason
      ? []
      : [`${command}: ${got.level} "${got.reason}", expected high "${reason}"`];
  });
}

/** Each command that must stay an ordinary shell command. */
export function notHigh(commands: string[], tool = "Bash"): string[] {
  return commands.flatMap((command) => {
    const got = classify(tool, { command });
    return got.level === "medium" && got.reason === MEDIUM
      ? []
      : [`${command}: ${got.level} "${got.reason}", expected medium "${MEDIUM}"`];
  });
}
