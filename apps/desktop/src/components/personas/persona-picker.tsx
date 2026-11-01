import { useEffect, useId } from "react";
import { useT } from "@/i18n/context";
import type { AppStore } from "@/lib/app-store";
import { useStoreState } from "@/lib/use-store";

const SELECT =
  "h-9 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Phase 20: which persona a session opens in. The value is `host:<id>` (the pack's, the host's or
 * a project's, resolved by the daemon) or `app:<id>` (the app's own, sent whole), "" for none.
 * `idsOnly` keeps to the host's, by plain id, for `flightdeckd claude --persona`.
 */
export function PersonaPicker(props: {
  store: AppStore;
  hostId: string;
  label: string;
  value: string;
  onChange(value: string): void;
  idsOnly?: boolean;
}) {
  const t = useT();
  const id = useId();
  const { store, hostId } = props;
  const state = useStoreState(store);
  useEffect(() => {
    void store.loadPersonas(hostId);
  }, [store, hostId]);
  // The app's wait for the host's, so the list does not change under a choice.
  const hosts = state.personas[hostId];
  const apps = props.idsOnly || !hosts ? [] : store.globalPersonas.list();
  return (
    <div className="flex flex-col gap-1 text-sm">
      <label htmlFor={`${id}-persona`}>{props.label}</label>
      <select
        id={`${id}-persona`}
        className={SELECT}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      >
        <option value="">{t("personas.picker.none")}</option>
        {hosts?.map((p) => (
          <option key={p.id} value={props.idsOnly ? p.id : `host:${p.id}`}>
            {p.name}
          </option>
        ))}
        {apps.map((p) => (
          <option key={`app:${p.id}`} value={`app:${p.id}`}>
            {p.name}
          </option>
        ))}
      </select>
    </div>
  );
}
