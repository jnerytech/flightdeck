import type { EffortLevel } from "@flightdeck/protocol";
import { ChevronUp } from "lucide-react";
import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { T } from "../../i18n/index.ts";
import {
  EFFORTS,
  isCurrentModel,
  MAIN_MODELS,
  MORE_MODELS,
  modelName,
} from "../../lib/model-menu.ts";

const FAMILIES = ["opus", "sonnet", "haiku"] as const;

/** A group value no row has: the model in use is under "More models", so none above is checked. */
const NO_ROW = "\u0000";

/** The rows of the Effort submenu: Default (no level), then the levels. */
const EFFORT_ROWS: ReadonlyArray<{ value: EffortLevel | ""; key: "default" | EffortLevel }> = [
  { value: "", key: "default" },
  ...EFFORTS.map((level) => ({ value: level, key: level })),
];

/** What a model is for: its family's line, a generic one for a version of any other, the default's own for none. */
function explainOf(t: T, model: string): string {
  if (model === "") return t("modelExplain.default");
  const family = FAMILIES.find((name) => model === name || model.startsWith(`claude-${name}-`));
  return t(`modelExplain.${family ?? "version"}`);
}

/** The words of a model: its name, or the default model's. */
const labelOf = (t: T, model: string) => modelName(model) ?? t("session.modelDefault");

/**
 * The model under the message box, as a chip that opens the Model menu: the models (numbered, a
 * number key picks one), a "More models" submenu with the versions, and an Effort submenu when the
 * host can change the effort of a live session. The chip reads "Opus 5.5 · Medium".
 */
export function ModelChip(props: {
  t: T;
  /** What the person chose in this view; "" is the default. */
  model: string;
  /** The model the session reports it runs, when known. */
  current: string | undefined;
  /** The effort set from this view; null is the model's default. */
  effort: EffortLevel | null;
  /** The host changes the effort of a live session. */
  effortAvailable: boolean;
  onPickModel(model: string): void;
  onPickEffort(effort: EffortLevel | null): void;
}) {
  const { t } = props;
  const [open, setOpen] = useState(false);
  // What the person picked wins; else what the session runs.
  const inUse = props.model || props.current || "";
  const top = ["", ...MAIN_MODELS];
  const version = MORE_MODELS.includes(inUse) ? inUse : "";
  const checked = version === "" ? (top.find((value) => isCurrentModel(value, inUse)) ?? "") : "";
  const text = [
    labelOf(t, inUse),
    ...(props.effort ? [t(`efforts.${props.effort}.name`)] : []),
  ].join(" · ");
  const pick = (value: string) => {
    setOpen(false);
    props.onPickModel(value);
  };
  const pickEffort = (level: EffortLevel | null) => {
    setOpen(false);
    props.onPickEffort(level);
  };
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="mode-chip"
          aria-label={t("session.modelChip", { model: text })}
          title={explainOf(t, inUse)}
        >
          {text}
          <ChevronUp aria-hidden="true" className="size-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="end"
        className="mode-menu"
        onKeyDown={(e) => {
          const value = /^[1-9]$/.test(e.key) ? top[Number(e.key) - 1] : undefined;
          if (value === undefined) return;
          e.preventDefault();
          pick(value);
        }}
      >
        <DropdownMenuLabel>{t("session.modelMenuTitle")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={version === "" ? checked : NO_ROW}>
          {top.map((value, index) => (
            <DropdownMenuRadioItem key={value} value={value} onSelect={() => pick(value)}>
              <span className="mode-row">
                <span className="mode-row-name">{labelOf(t, value)}</span>
                <span className="mode-row-note">{explainOf(t, value)}</span>
              </span>
              <span aria-hidden="true" className="mode-row-key">
                {index + 1}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>{t("session.modelMore")}</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="mode-menu">
            <DropdownMenuRadioGroup value={version}>
              {MORE_MODELS.map((value) => (
                <DropdownMenuRadioItem key={value} value={value} onSelect={() => pick(value)}>
                  <span className="mode-row">
                    <span className="mode-row-name">{labelOf(t, value)}</span>
                    <span className="mode-row-note">{explainOf(t, value)}</span>
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {props.effortAvailable && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>{t("session.effortMenu")}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="mode-menu">
              <DropdownMenuRadioGroup value={props.effort ?? ""}>
                {EFFORT_ROWS.map(({ value, key }) => (
                  <DropdownMenuRadioItem
                    key={key}
                    value={value}
                    onSelect={() => pickEffort(value === "" ? null : value)}
                  >
                    <span className="mode-row">
                      <span className="mode-row-name">{t(`efforts.${key}.name`)}</span>
                      <span className="mode-row-note">{t(`efforts.${key}.explain`)}</span>
                    </span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
