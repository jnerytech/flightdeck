/**
 * Phase 39: the `<option>`s of a model list. Ids written `provider/model` (OpenCode's) are grouped
 * by provider; plain ids (Claude Code's aliases) stay a flat list.
 */
export function ModelOptions(props: { models: readonly string[] }) {
  const providers = new Map<string, string[]>();
  const plain: string[] = [];
  for (const id of props.models) {
    const at = id.indexOf("/");
    if (at <= 0) plain.push(id);
    else providers.set(id.slice(0, at), [...(providers.get(id.slice(0, at)) ?? []), id]);
  }
  const option = (id: string) => (
    <option key={id} value={id}>
      {id}
    </option>
  );
  return (
    <>
      {plain.map(option)}
      {[...providers].map(([provider, ids]) => (
        <optgroup key={provider} label={provider}>
          {ids.map(option)}
        </optgroup>
      ))}
    </>
  );
}
