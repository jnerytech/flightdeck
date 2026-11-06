import { useCallback, useEffect, useState } from "react";
import { Field } from "@/components/layout/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Key, T } from "@/i18n/index";
import type { AppStore } from "@/lib/app-store";
import type { AssistantKeyProvider } from "@/platform/types";
import { ConfirmDialog } from "@/ui/ConfirmDialog";
import { failureOf, refusalText } from "./refusal-text.ts";

/**
 * The key of one API provider: a password field to paste it (cleared at once, never shown again),
 * then "Key saved · …a1b2" with Replace, Test and Remove. The key is never read back: only its last
 * four characters come from the shell.
 */
export function KeyField(props: {
  store: AppStore;
  t: T;
  provider: AssistantKeyProvider;
  /** The provider's name as it reads in a sentence ("Anthropic", "OpenRouter"). */
  name: string;
}) {
  const { store, t, provider } = props;
  const [saved, setSaved] = useState<{ last4?: string } | null | "unknown">("unknown");
  const [replacing, setReplacing] = useState(false);
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);

  const read = useCallback(async () => {
    const status = await store.assistant.keyStatus(provider);
    setSaved(status.saved ? { ...(status.last4 ? { last4: status.last4 } : {}) } : null);
  }, [store, provider]);

  useEffect(() => {
    void read();
  }, [read]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await store.assistant.saveKey(provider, key);
      setKey("");
      setReplacing(false);
      setSaid(null);
      await read();
    } catch (failure) {
      setError(refusalText(t, failureOf(failure)));
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    try {
      const result = await store.assistant.testKey(provider);
      if (result.ok) setSaid(t("assistantSettings.testOk"));
      else if (result.detail?.startsWith("assistant_")) {
        setSaid(refusalText(t, { reason: result.detail }));
      } else setSaid(t("assistantSettings.testFailed"));
    } catch (failure) {
      setSaid(refusalText(t, failureOf(failure)));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setRemoving(false);
    await store.assistant.removeKey(provider);
    setSaid(null);
    await read();
  };

  if (saved === "unknown") return null;
  const label = t("assistantSettings.keyLabel" as Key, { provider: props.name });
  const entering = saved === null || replacing;
  return (
    <fieldset aria-label={props.name} className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
      {entering ? (
        <div className="flex flex-col gap-2">
          <Field label={label} error={error}>
            {(control) => (
              <Input
                {...control}
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={key}
                onChange={(e) => setKey(e.target.value)}
              />
            )}
          </Field>
          <div className="flex gap-2">
            <Button disabled={busy || key.trim() === ""} onClick={() => void save()}>
              {t("assistantSettings.keySave")}
            </Button>
            {replacing && (
              <Button
                variant="outline"
                onClick={() => {
                  setReplacing(false);
                  setKey("");
                  setError(null);
                }}
              >
                {t("common.cancel")}
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>{t("assistantSettings.keySaved", { last4: saved.last4 ?? "" })}</span>
          <Button variant="outline" size="sm" onClick={() => setReplacing(true)}>
            {t("assistantSettings.keyReplace")}
          </Button>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void test()}>
            {t("assistantSettings.keyTest")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setRemoving(true)}>
            {t("assistantSettings.keyRemove")}
          </Button>
        </div>
      )}
      {said && <output className="text-sm">{said}</output>}
      {removing && (
        <ConfirmDialog
          destructive
          message={t("assistantSettings.keyRemoveConfirm", { provider: props.name })}
          confirmLabel={t("assistantSettings.keyRemove")}
          onCancel={() => setRemoving(false)}
          onConfirm={() => void remove()}
        />
      )}
    </fieldset>
  );
}
