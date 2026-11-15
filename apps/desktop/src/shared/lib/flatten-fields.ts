/** Values are cut here: a tool input shown to a person is what is asked, not whole documents. */
const MAX_VALUE = 200;

/** A value as text; an object (inside a list) is JSON, never "[object Object]". */
function show(value: unknown): string {
  return value !== null && typeof value === "object" ? JSON.stringify(value) : String(value);
}

/** Nested values flattened to `key.sub`, lists joined, long strings cut. */
export function flattenFields(
  input: Record<string, unknown>,
  prefix = "",
): Array<[string, string]> {
  return Object.entries(input).flatMap(([key, value]): Array<[string, string]> => {
    const name = `${prefix}${key}`;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      return flattenFields(value as Record<string, unknown>, `${name}.`);
    }
    const shown = Array.isArray(value) ? value.map(show).join(", ") : show(value);
    return [[name, shown.length > MAX_VALUE ? `${shown.slice(0, MAX_VALUE)}…` : shown]];
  });
}
