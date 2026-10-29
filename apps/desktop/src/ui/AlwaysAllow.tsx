import type { PermissionUpdate } from "@flightdeck/protocol";
import { useState } from "react";

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
  const [rule, setRule] = useState<string | null>(null);
  const session = (props.suggestions ?? []).filter((s) => s.destination === "session");
  if (rule !== null) {
    return (
      <div className="always-allow">
        <input aria-label="Regra" value={rule} onChange={(e) => setRule(e.target.value)} />
        <button
          type="button"
          className="primary"
          onClick={() => props.onAllow([projectRule(rule)])}
        >
          Salvar regra
        </button>
        <button type="button" onClick={() => setRule(null)}>
          Cancelar
        </button>
      </div>
    );
  }
  return (
    <div className="always-allow">
      {session.length > 0 && (
        <button type="button" onClick={() => props.onAllow(session)}>
          Permitir nesta sessão
        </button>
      )}
      <button type="button" onClick={() => setRule(defaultRule(props.toolName, props.input))}>
        Sempre neste projeto
      </button>
    </div>
  );
}
