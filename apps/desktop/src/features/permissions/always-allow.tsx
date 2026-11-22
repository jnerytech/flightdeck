import type { PermissionUpdate } from "@flightdeck/protocol";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n/context";
import { Field, Form, FormActions } from "@/shared/layout/index.ts";
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
  const field = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  // The button that opened the editor unmounts with it: the focus goes to the field, and back to
  // the button (or its place) when the editor closes.
  const editing = rule !== null;
  const wasEditing = useRef(false);
  useEffect(() => {
    if (editing) field.current?.focus();
    else if (wasEditing.current) opener.current?.focus();
    wasEditing.current = editing;
  }, [editing]);
  const session = (props.suggestions ?? []).filter((s) => s.destination === "session");
  if (rule !== null) {
    return (
      <Form
        variant="inline"
        onSubmit={() => {
          // Enter submits even when the button is off: an empty rule or a sent answer sends nothing.
          if (props.disabled || rule.trim() === "") return;
          props.onAllow([projectRule(rule)]);
        }}
      >
        <Field label={t("alwaysAllow.rule")}>
          {(control) => (
            <Input
              {...control}
              ref={field}
              value={rule}
              onChange={(e) => setRule(e.target.value)}
              className="h-8 font-mono text-xs"
            />
          )}
        </Field>
        <FormActions
          submit={t("alwaysAllow.saveRule")}
          disabled={props.disabled || rule.trim() === ""}
          disabledReason={rule.trim() === "" ? t("alwaysAllow.ruleEmpty") : undefined}
          cancel={t("common.cancel")}
          onCancel={() => setRule(null)}
        />
      </Form>
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
          ref={opener}
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
