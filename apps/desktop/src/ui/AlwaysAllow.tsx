import type { PermissionUpdate } from "@flightdeck/protocol";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n/context";

/** The default project rule: the exact command for Bash, the tool's name for the others. */
export function defaultRule(toolName: string, input: Record<string, unknown>): string {
  const command = input.command;
  return toolName === "Bash" && typeof command === "string" ? `Bash(${command})` : toolName;
}

/** `Bash(npm test:*)` or `Write` as the project rule the daemon validates. */
export function projectRule(text: string): PermissionUpdate {
  const match = /^([^(]+)\((.*)\)$/s.exec(text.trim());
  const rule = match
    ? { toolName: match[1] as string, ruleContent: match[2] as string }
    : { toolName: text.trim() };
  return { type: "addRules", rules: [rule], behavior: "allow", destination: "localSettings" };
}

/**
 * "Permitir nesta sessão" (only when the request has session suggestions) and "Sempre neste
 * projeto", which opens the rule for editing before sending it.
 */
export function AlwaysAllow(props: {
  toolName: string;
  input: Record<string, unknown>;
  suggestions: PermissionUpdate[] | undefined;
  onAllow(updatedPermissions: PermissionUpdate[]): void;
}) {
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
        <Button size="sm" onClick={() => props.onAllow([projectRule(rule)])}>
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
        <Button variant="outline" size="sm" onClick={() => props.onAllow(session)}>
          {t("alwaysAllow.session")}
        </Button>
      )}
      <Button
        variant="outline"
        size="sm"
        onClick={() => setRule(defaultRule(props.toolName, props.input))}
      >
        {t("alwaysAllow.project")}
      </Button>
    </div>
  );
}
