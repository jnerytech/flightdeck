/** The most of a tool's output a session event keeps (the rest is counted, not kept). */
export const MAX_TOOL_RESULT = 4000;

export function truncateToolResult(text: string): string {
  return text.length > MAX_TOOL_RESULT
    ? `${text.slice(0, MAX_TOOL_RESULT)}… [${text.length - MAX_TOOL_RESULT} caracteres omitidos]`
    : text;
}
