import type { EffortLevel, PermissionMode, SettableMode } from "@flightdeck/protocol";
import type { ReactNode } from "react";
import { NativeSelect } from "@/shared/layout/index.ts";
import type { T } from "../../i18n/index.ts";
import { type composerModeMenu, offersModelPicker } from "./domain/composer-pickers.ts";
import type { SessionState } from "./domain/session-state.ts";
import { ModeChip } from "./mode-chip";
import { ModelChip } from "./model-chip";
import { ModelOptions } from "./model-options.tsx";
import type { SessionActions } from "./session-actions.ts";

/** What the pickers read of the view's props. */
export interface ComposerPickersProps {
  session: Pick<SessionState, "model">;
  actions: Pick<SessionActions, "setModel" | "setEffort" | "setMode">;
  runtime?: "claude" | "opencode";
  /** The host announces `session.settings` and the session is a managed one. */
  settings?: boolean;
  /** The host changes the effort of a live session (`session.effort`). */
  effort?: boolean;
  /** Phase 39: OpenCode's models, for the live switch of an OpenCode session (none until known). */
  models?: readonly string[];
  onOpenHostSettings?: () => void;
}

/** What the composer's pickers hold: the person's picks, and how a pick is made. */
export interface PickerState {
  model: string;
  setModel(value: string): void;
  effort: EffortLevel | null;
  setEffort(level: EffortLevel | null): void;
  mode: PermissionMode | null;
  modeMenu: ReturnType<typeof composerModeMenu>;
  chooseMode(next: SettableMode): void;
}

/** The pickers of what the session lets change (model and effort, mode); the rest shows as text. */
export function composerPickers(
  props: ComposerPickersProps,
  t: T,
  state: PickerState,
): { model?: ReactNode; mode?: ReactNode } {
  const { actions, session } = props;
  const opencode = props.runtime === "opencode";
  const pickers: { model?: ReactNode; mode?: ReactNode } = {};
  if (
    offersModelPicker({
      settings: Boolean(props.settings),
      canSetModel: Boolean(actions.setModel),
      opencode,
      hasModels: Boolean(props.models),
    })
  ) {
    pickers.model = opencode ? (
      <NativeSelect
        compact
        inline
        aria-label={t("session.modelLabel")}
        value={state.model}
        onChange={(e) => {
          state.setModel(e.target.value);
          void actions.setModel?.(e.target.value || null);
        }}
      >
        <option value="">{t("session.modelDefault")}</option>
        <ModelOptions models={props.models ?? []} />
      </NativeSelect>
    ) : (
      <ModelChip
        t={t}
        model={state.model}
        current={session.model}
        effort={state.effort}
        effortAvailable={Boolean(props.effort && actions.setEffort)}
        onPickModel={(value) => {
          state.setModel(value);
          void actions.setModel?.(value || null);
        }}
        onPickEffort={(level) => {
          state.setEffort(level);
          void actions.setEffort?.(level);
        }}
      />
    );
  }
  if (props.settings && actions.setMode) {
    pickers.mode = (
      <ModeChip
        t={t}
        mode={state.mode}
        rows={state.modeMenu}
        onPick={state.chooseMode}
        onOpenHostSettings={props.onOpenHostSettings}
      />
    );
  }
  return pickers;
}
