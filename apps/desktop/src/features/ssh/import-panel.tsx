import type { SshImportEntry } from "@flightdeck/protocol";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/context";
import { ActionButton } from "@/shared/feedback/index.ts";
import { FieldRow, Inline, Panel, Stack } from "@/shared/layout/index.ts";

/** The names of the host's `~/.ssh/config` that could become destinos; the registered ones are marked. */
export function ImportPanel(
  props: Readonly<{
    entries: SshImportEntry[];
    onApply(aliases: string[]): void;
    onClose(): void;
  }>,
) {
  const t = useT();
  // The names that can still be imported: a registered one is shown but never ticked.
  const free = props.entries.filter((entry) => !entry.exists).map((entry) => entry.alias);
  const [picked, setPicked] = useState(() => new Set(free));
  const toggle = (alias: string, on: boolean) =>
    setPicked((current) => {
      const next = new Set(current);
      if (on) next.add(alias);
      else next.delete(alias);
      return next;
    });

  if (props.entries.length === 0) {
    return (
      <Panel title={t("connections.import.title")}>
        <p>{t("connections.import.empty")}</p>
        <FieldRow>
          <Button variant="ghost" onClick={props.onClose}>
            {t("connections.import.close")}
          </Button>
        </FieldRow>
      </Panel>
    );
  }

  return (
    <Panel title={t("connections.import.title")}>
      {free.length > 0 && (
        <Inline>
          <Button variant="ghost" size="sm" onClick={() => setPicked(new Set(free))}>
            {t("connections.import.selectAll")}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setPicked(new Set())}>
            {t("connections.import.selectNone")}
          </Button>
        </Inline>
      )}
      <Stack as="ul" gap={2} label={t("connections.import.title")}>
        {props.entries.map((entry) => (
          <li key={entry.alias}>
            <Inline className="text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={picked.has(entry.alias)}
                  disabled={entry.exists}
                  onChange={(event) => toggle(entry.alias, event.target.checked)}
                />
                {entry.alias}
              </label>
              <span className="font-mono text-muted-foreground">
                {entry.user + "@" + entry.host + (entry.port === 22 ? "" : ":" + entry.port)}
              </span>
              {entry.exists && <span>{t("connections.import.exists")}</span>}
            </Inline>
          </li>
        ))}
      </Stack>
      <FieldRow>
        <ActionButton
          disabled={picked.size === 0}
          disabledReason={t("connections.import.pickOne")}
          onClick={() =>
            props.onApply(props.entries.filter((e) => picked.has(e.alias)).map((e) => e.alias))
          }
        >
          {t("connections.import.apply")}
        </ActionButton>
        <Button variant="ghost" onClick={props.onClose}>
          {t("common.cancel")}
        </Button>
      </FieldRow>
    </Panel>
  );
}
