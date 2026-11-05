import { type RefObject, useEffect, useId, useMemo, useRef, useState } from "react";
import { useT } from "@/i18n/context";
import { filterMenu, highlight, type MenuItem } from "../../lib/prompt-menu.ts";

/** The prompt snippets a message box offers after `/` (phase 18). */
export interface PromptSnippets {
  list(): Promise<MenuItem[]>;
  fill(key: string): Promise<string>;
}

/**
 * Above a message box: while its text is `/` and a name without spaces, the snippets and the
 * commands that fit it, in groups, as a popover anchored to the box (it takes no room in the page
 * and scrolls inside). The chosen one replaces the text. While it is open the box is its combobox:
 * the arrows, Home, End, Enter and Escape drive the list.
 */
export function PromptMenu(props: {
  prompts: PromptSnippets | undefined;
  text: string;
  label: string;
  onFill(text: string): void;
  /** The message box the menu is for: it gets the keys and the combobox roles while the menu is open. */
  input?: RefObject<HTMLTextAreaElement | null>;
}) {
  const t = useT();
  const id = useId();
  const [items, setItems] = useState<MenuItem[] | null>(null);
  const [selected, setSelected] = useState(0);
  /** The text the menu was closed at with Escape: it stays closed until the text changes. */
  const [dismissed, setDismissed] = useState<string | null>(null);
  const slash =
    props.prompts && /^\/\S*$/.test(props.text) ? props.text.slice(1).toLowerCase() : null;
  useEffect(() => {
    if (slash !== null && items === null) void props.prompts?.list().then(setItems);
  }, [slash, items, props.prompts]);
  const sections = useMemo(
    () => (slash === null ? [] : filterMenu(items ?? [], slash)),
    [slash, items],
  );
  const flat = sections.flatMap((section) => section.items);
  const open = flat.length > 0 && dismissed !== props.text;
  // A new query starts at the best match again.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the query is the trigger
  useEffect(() => setSelected(0), [slash]);
  const at = Math.min(selected, Math.max(flat.length - 1, 0));
  const choice = flat[at];
  const optionId = (index: number) => `${id}-option-${index}`;

  const fill = (item: MenuItem | undefined) => {
    if (item) void props.prompts?.fill(item.key).then(props.onFill);
  };
  // The latest state for the key handler, which is attached to the box once per open menu.
  const latest = useRef({ open, flat, at, fill });
  latest.current = { open, flat, at, fill };

  const field = props.input?.current ?? null;
  useEffect(() => {
    if (!field || !open) return;
    const onKey = (event: KeyboardEvent) => {
      const state = latest.current;
      if (event.isComposing) return;
      const last = state.flat.length - 1;
      let next: number | null = null;
      if (event.key === "ArrowDown") next = state.at >= last ? 0 : state.at + 1;
      else if (event.key === "ArrowUp") next = state.at <= 0 ? last : state.at - 1;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = last;
      else if (event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
        state.fill(state.flat[state.at]);
      } else if (event.key === "Escape") setDismissed(field.value);
      else return;
      if (next !== null) setSelected(next);
      // The box's own handlers (send, interrupt) must not see a key the menu used.
      event.preventDefault();
      event.stopPropagation();
    };
    field.addEventListener("keydown", onKey);
    return () => field.removeEventListener("keydown", onKey);
  }, [field, open]);
  useEffect(() => {
    if (!field || !open) return;
    field.setAttribute("role", "combobox");
    field.setAttribute("aria-expanded", "true");
    field.setAttribute("aria-controls", id);
    field.setAttribute("aria-autocomplete", "list");
    field.setAttribute("aria-activedescendant", `${id}-option-${at}`);
    return () => {
      for (const name of [
        "role",
        "aria-expanded",
        "aria-controls",
        "aria-autocomplete",
        "aria-activedescendant",
      ]) {
        field.removeAttribute(name);
      }
    };
  }, [field, open, id, at]);

  if (!open) return null;
  let index = -1;
  return (
    <div className="prompt-menu">
      <div
        id={id}
        role="listbox"
        aria-label={props.label}
        className="flex min-h-0 flex-col overflow-y-auto p-1 text-sm"
      >
        {sections.map((section) => {
          const heading = `${t(`session.promptMenu.${section.group}`)} (${section.items.length})`;
          return (
            // biome-ignore lint/a11y/useSemanticElements: a fieldset is a form control group; this one groups options of a listbox
            <div key={section.group} role="group" aria-label={heading}>
              <p aria-hidden="true" className="px-2 pt-1 font-medium text-muted-foreground text-xs">
                {heading}
              </p>
              {section.items.map((item) => {
                index += 1;
                const here = index;
                const current = here === at;
                return (
                  <button
                    key={item.key}
                    id={optionId(here)}
                    type="button"
                    role="option"
                    aria-label={item.name}
                    tabIndex={-1}
                    aria-selected={current}
                    className="prompt-menu-option"
                    onMouseEnter={() => setSelected(here)}
                    onClick={() => fill(item)}
                    ref={(node) => {
                      if (current) node?.scrollIntoView?.({ block: "nearest" });
                    }}
                  >
                    {highlight(item.name, slash ?? "").map((run, at2) =>
                      run.hit ? (
                        // biome-ignore lint/suspicious/noArrayIndexKey: runs are cut from one string, in order
                        <mark key={at2} className="bg-transparent font-semibold text-foreground">
                          {run.text}
                        </mark>
                      ) : (
                        // biome-ignore lint/suspicious/noArrayIndexKey: runs are cut from one string, in order
                        <span key={at2}>{run.text}</span>
                      ),
                    )}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
      {choice?.description && (
        <p
          data-testid="prompt-menu-description"
          className="border-t px-3 py-1.5 text-muted-foreground text-xs"
        >
          {choice.description}
        </p>
      )}
    </div>
  );
}
