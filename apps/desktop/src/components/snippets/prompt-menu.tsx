import { useEffect, useState } from "react";

/** The prompt snippets a message box offers after `/` (phase 18). */
export interface PromptSnippets {
  list(): Promise<Array<{ key: string; name: string }>>;
  fill(key: string): Promise<string>;
}

/**
 * Under a message box: while its text is `/` and a name without spaces, the prompt snippets whose
 * name contains it; the chosen one replaces the text.
 */
export function PromptMenu(props: {
  prompts: PromptSnippets | undefined;
  text: string;
  label: string;
  onFill(text: string): void;
}) {
  const [prompts, setPrompts] = useState<Array<{ key: string; name: string }> | null>(null);
  const slash =
    props.prompts && /^\/\S*$/.test(props.text) ? props.text.slice(1).toLowerCase() : null;
  useEffect(() => {
    if (slash !== null && prompts === null) void props.prompts?.list().then(setPrompts);
  }, [slash, prompts, props.prompts]);
  const offered =
    slash === null ? [] : (prompts ?? []).filter((p) => p.name.toLowerCase().includes(slash));
  if (offered.length === 0) return null;
  return (
    <div
      role="listbox"
      aria-label={props.label}
      className="mx-4 mb-1 flex flex-col rounded-md border bg-popover p-1 text-sm"
    >
      {offered.map((p) => (
        <button
          key={p.key}
          type="button"
          role="option"
          aria-selected={false}
          className="rounded px-2 py-1 text-left hover:bg-muted"
          onClick={() => void props.prompts?.fill(p.key).then(props.onFill)}
        >
          {p.name}
        </button>
      ))}
    </div>
  );
}
