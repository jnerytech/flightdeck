import type { PermissionUpdate } from "@flightdeck/protocol";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n/context";

/**
 * The default project rule: the exact command for Bash, the exact file for a tool that names one,
 * the tool's name for the others. A rule for a whole file tool would cover a credential file, and
 * the daemon refuses it (issue #384).
 */
export function defaultRule(
  toolName: string,
  input: Record<string, unknown>,
  cwd?: string,
): string {
  const command = input.command;
  if (toolName === "Bash" && typeof command === "string") return `Bash(${command})`;
  const file = input.file_path ?? input.notebook_path ?? input.path;
  return typeof file === "string" && file !== "" ? `${toolName}(${ruleFile(file, cwd)})` : toolName;
}

/**
 * A file as the CLI reads it in a rule: relative to the folder when it is inside it, `//` and the
 * path when it is absolute outside it (a single leading `/` would mean the project's root).
 */
function ruleFile(path: string, cwd: string | undefined): string {
  const file = path.replaceAll("\\", "/");
  const folder = (cwd ?? "").replaceAll("\\", "/").replace(/\/+$/, "");
  if (folder !== "" && file === folder) return ".";
  if (folder !== "" && file.startsWith(`${folder}/`)) return file.slice(folder.length + 1);
  return file.startsWith("/") ? `/${file}` : file;
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
export function AlwaysAllow(
  props: Readonly<{
    toolName: string;
    input: Record<string, unknown>;
    suggestions: PermissionUpdate[] | undefined;
    /** The folder the request ran in: a file rule is written relative to it. */
    cwd?: string | undefined;
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
      <Button
        variant="outline"
        size="sm"
        disabled={props.disabled}
        onClick={() => setRule(defaultRule(props.toolName, props.input, props.cwd))}
      >
        {t("alwaysAllow.project")}
      </Button>
    </div>
  );
}
