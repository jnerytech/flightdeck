import { REFERENCE } from "./schema.ts";

/** Interpolated values (and check outputs) longer than this are cut. */
export const MAX_VALUE = 8 * 1024;

/** Between the outputs of a `parallel` step in `{{steps.<id>.outputs}}`. */
export const OUTPUTS_SEPARATOR = "\n\n---\n\n";

export interface InterpolationContext {
  inputs: Record<string, string>;
  steps: Record<string, { output?: string; outputs?: string[] }>;
  loop?: { lastCheck: { output: string; exitCode: number } };
}

function resolve(expression: string, context: InterpolationContext): string | undefined {
  const [scope, name, field] = expression.split(".");
  if (scope === "inputs") return context.inputs[name ?? ""];
  if (scope === "steps") {
    const step = context.steps[name ?? ""];
    return field === "outputs" ? step?.outputs?.join(OUTPUTS_SEPARATOR) : step?.output;
  }
  if (scope === "loop" && name === "lastCheck" && context.loop) {
    const { output, exitCode } = context.loop.lastCheck;
    return field === "output" ? output : String(exitCode);
  }
  return undefined;
}

/**
 * Replaces every `{{…}}` with its value, cut at `MAX_VALUE` characters. The workflow was
 * validated before, so a reference without a value is a bug and throws instead of vanishing.
 */
export function interpolate(template: string, context: InterpolationContext): string {
  return template.replace(REFERENCE, (raw, expression: string) => {
    const value = resolve(expression, context);
    if (value === undefined) throw new Error(`referência desconhecida: ${raw}`);
    return value.slice(0, MAX_VALUE);
  });
}
