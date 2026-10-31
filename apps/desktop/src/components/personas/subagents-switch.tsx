import type { PersonaSubagentsMode } from "@flightdeck/protocol";
import { useEffect, useId, useState } from "react";
import { useT } from "@/i18n/context";
import type { AppStore } from "@/lib/app-store";

const SELECT =
  "h-9 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
const MODES: PersonaSubagentsMode[] = ["all", "project", "none"];

/** Phase 20: which personas a project's sessions get as `persona-<id>` subagents. */
export function SubagentsSwitch(props: { store: AppStore; hostId: string; projectId: string }) {
  const t = useT();
  const id = useId();
  const { store, hostId, projectId } = props;
  const [mode, setMode] = useState<PersonaSubagentsMode | null>(null);
  useEffect(() => {
    void store.loadProjects(hostId).then((projects) => {
      const project = projects?.find((p) => p.id === projectId);
      if (project) setMode(project.personaSubagents);
    });
  }, [store, hostId, projectId]);
  const change = async (next: PersonaSubagentsMode) => {
    const saved = await store.hostCommand(hostId, "project.update", {
      projectId,
      personaSubagents: next,
    });
    if (saved) setMode(saved.personaSubagents);
  };
  return (
    <div className="mb-4 flex flex-col gap-1 text-sm">
      <label htmlFor={`${id}-subagents`}>{t("personas.subagents.label")}</label>
      <select
        id={`${id}-subagents`}
        className={`${SELECT} self-start`}
        value={mode ?? "all"}
        disabled={mode === null}
        onChange={(e) => void change(e.target.value as PersonaSubagentsMode)}
      >
        {MODES.map((m) => (
          <option key={m} value={m}>
            {t(`personas.subagents.${m}`)}
          </option>
        ))}
      </select>
      <p className="text-muted-foreground text-xs">{t("personas.subagents.hint")}</p>
    </div>
  );
}
