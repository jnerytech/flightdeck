import type { PermissionUpdate } from "@flightdeck/protocol";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n/context";
import { defaultRule, namesFolder, projectRule } from "./domain/always-allow-rule.ts";

/**
 * "Permitir nesta sessão" (only when the request has session suggestions) and "Sempre neste
 * projeto", which opens the rule for editing before sending it.
 */
export function AlwaysAllow(
  props: Readonly<{
    toolName: string;
    input: Record<string, unknown>;
    suggestions: PermissionUpdate[] | undefined;
    /** The folder the request ran in: a file rule is written relative to it. */
    cwd?: string;
    onAllow(updatedPermissions: PermissionUpdate[]): void;
    /** An answer is on its way: nothing here can be pressed. */
    disabled?: boolean;
  }>,
) {
  const t = useT();
  const [rule, setRule] = useState<string | null>(null);
  const session = (props.suggestions ?? []).filter((s) => s.destination === "session");
  if (rule !== null) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label={t("alwaysAllow.rule")}
          value={rule}
          onChange={(e) => setRule(e.target.value)}
          className="h-8 min-w-48 flex-1 font-mono text-xs"
        />
        <Button
          size="sm"
          disabled={props.disabled}
          onClick={() => props.onAllow([projectRule(rule)])}
        >
          {t("alwaysAllow.saveRule")}
        </Button>
        <Button variant="outline" size="sm" onClick={() => setRule(null)}>
          {t("common.cancel")}
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {session.length > 0 && (
        <Button
          variant="outline"
          size="sm"
          disabled={props.disabled}
          onClick={() => props.onAllow(session)}
        >
          {t("alwaysAllow.session")}
        </Button>
      )}
      {!namesFolder(props.toolName, props.input) && (
        <Button
          variant="outline"
          size="sm"
          disabled={props.disabled}
          onClick={() => setRule(defaultRule(props.toolName, props.input, props.cwd))}
        >
          {t("alwaysAllow.project")}
        </Button>
      )}
    </div>
  );
}
