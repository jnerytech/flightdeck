import { useEffect, useId } from "react";
import type { AppStore } from "@/lib/app-store";
import { useStoreState } from "@/lib/use-store";

/**
 * Several of a host's personas by plain id, in the order they were checked (a team's workers take
 * them in that order). A multiple choice, never text typed.
 */
export function PersonaMultiPicker(props: {
  store: AppStore;
  hostId: string;
  label: string;
  value: readonly string[];
  onChange(value: string[]): void;
}) {
  const { store, hostId, value } = props;
  const id = useId();
  const state = useStoreState(store);
  useEffect(() => {
    void store.loadPersonas(hostId);
  }, [store, hostId]);
  const personas = state.personas[hostId] ?? [];
  const toggle = (persona: string, checked: boolean) =>
    props.onChange(checked ? [...value, persona] : value.filter((p) => p !== persona));
  return (
    <fieldset className="flex flex-col gap-1 text-sm">
      <legend className="mb-1">{props.label}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {personas.map((p) => {
          const position = value.indexOf(p.id);
          return (
            <label key={p.id} htmlFor={`${id}-${p.id}`} className="flex items-center gap-1.5">
              <input
                id={`${id}-${p.id}`}
                type="checkbox"
                value={p.id}
                checked={position >= 0}
                onChange={(e) => toggle(p.id, e.target.checked)}
              />
              {p.name}
              {position >= 0 && (
                <span className="text-muted-foreground text-xs">{`#${position + 1}`}</span>
              )}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
