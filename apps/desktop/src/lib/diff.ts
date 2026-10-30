import { diffLines } from "diff";

export interface DiffLine {
  op: "+" | "-" | " ";
  text: string;
}

const isString = (v: unknown): v is string => typeof v === "string";

function lines(value: string): string[] {
  const parts = value.split("\n");
  if (parts.at(-1) === "") parts.pop();
  return parts;
}

function between(before: string, after: string): DiffLine[] {
  return diffLines(before, after).flatMap((part) => {
    let op = " ";
    if (part.added) op = "+";
    else if (part.removed) op = "-";
    return lines(part.value).map((text) => ({ op, text }) as DiffLine);
  });
}

/** Line diff for file-editing tools (Edit, MultiEdit, Write); `null` for anything else. */
export function toolDiff(toolName: string, input: Record<string, unknown>): DiffLine[] | null {
  switch (toolName) {
    case "Edit":
      return isString(input.old_string) && isString(input.new_string)
        ? between(input.old_string, input.new_string)
        : null;
    case "Write":
      return isString(input.content)
        ? lines(input.content).map((text) => ({ op: "+", text }))
        : null;
    case "MultiEdit":
      if (!Array.isArray(input.edits)) return null;
      return input.edits.flatMap((edit: unknown) => {
        const e = (edit ?? {}) as Record<string, unknown>;
        return isString(e.old_string) && isString(e.new_string)
          ? between(e.old_string, e.new_string)
          : [];
      });
    default:
      return null;
  }
}
