import type { TeamInfo } from "@flightdeck/protocol";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  EffortSelect,
  ModelSelect,
  type PermissionChoice,
  PermissionSelect,
  PersonaPicker,
} from "@/features/personas/index.ts";
import type { AppStore } from "../../lib/app-store.ts";
import { type EffortChoice, effortOffered, offeredChoice } from "./new-team.ts";
import { useModes, usePersonaModels } from "./use-modes.ts";

/** The persona and model of a worker about to join a running team. */
export function NewMember(
  props: Readonly<{
    store: AppStore;
    hostId: string;
    team: TeamInfo;
    onAdd(member: {
      persona: string;
      model: string;
      effort: EffortChoice;
      permission: PermissionChoice;
    }): void;
    onCancel(): void;
  }>,
) {
  const { store, team } = props;
  const { t } = store.i18n;
  const [persona, setPersona] = useState("");
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState<EffortChoice>("");
  const [permission, setPermission] = useState<PermissionChoice>("");
  const modes = useModes(store, props.hostId);
  const personaModels = usePersonaModels(store, props.hostId);
  const effortShown = effortOffered({ efforts: modes.efforts, personaModels }, model, persona);
  return (
    <div className="row-end-wrap">
      <PersonaPicker
        store={store}
        hostId={props.hostId}
        label={t("teamsUi.newMemberPersona", { name: team.name })}
        value={persona}
        onChange={setPersona}
        idsOnly
      />
      <ModelSelect
        label={t("teamsUi.newMemberModel", { name: team.name })}
        defaultLabel={t("teamsUi.modelDefault")}
        value={model}
        onChange={setModel}
      />
      {effortShown && (
        <EffortSelect
          label={t("teamsUi.newMemberEffort", { name: team.name })}
          defaultLabel={t("teamsUi.effortDefault")}
          value={effort}
          onChange={setEffort}
        />
      )}
      {modes.offered && (
        <PermissionSelect
          label={t("teamsUi.newMemberPermission", { name: team.name })}
          value={offeredChoice(permission, modes.allowBypass)}
          allowBypass={modes.allowBypass}
          onChange={setPermission}
        />
      )}
      <Button
        size="sm"
        aria-label={t("teamsUi.addMember", { name: team.name })}
        onClick={() =>
          props.onAdd({
            persona,
            model,
            effort: effortShown ? effort : "",
            permission: offeredChoice(permission, modes.allowBypass),
          })
        }
      >
        {t("teamsUi.addMemberButton")}
      </Button>
      <Button variant="ghost" size="sm" onClick={props.onCancel}>
        {t("teamsUi.cancel")}
      </Button>
    </div>
  );
}
