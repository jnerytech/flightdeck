import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Key, T } from "@/i18n/index";
import type { AppStore } from "@/lib/app-store";
import type { AssistantKeyProvider } from "@/platform/types";
import { ConfirmDialog } from "@/shared/feedback/index.ts";
import { Field, Form } from "@/shared/layout/index.ts";
import type { AssistantFailure } from "./domain/assistant.ts";
import { failureOf, refusalText } from "./domain/refusal-text.ts";

/**
 * The key of one API provider: a password field to paste it (cleared at once, never shown again),
 * then "Key saved · …a1b2" with Replace, Test and Remove. The key is never read back: only its last
 * four characters come from the shell. Every call says it is running and, when it fails, why; and the
 * focus goes where the button that had it went (the key field, or Replace).
 */
export function KeyField(
  props: Readonly<{
    store: AppStore;
    t: T;
    provider: AssistantKeyProvider;
    /** The provider's name as it reads in a sentence ("Anthropic", "OpenRouter"). */
    name: string;
  }>,
) {
  const { store, t, provider } = props;
  const [saved, setSaved] = useState<{ last4?: string } | null | "unknown">("unknown");
  const [replacing, setReplacing] = useState(false);
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [doing, setDoing] = useState<"save" | "test" | "remove" | null>(null);
  const [unread, setUnread] = useState<AssistantFailure | null>(null);
  const busy = doing !== null;
  const keyBox = useRef<HTMLInputElement>(null);
  const replaceButton = useRef<HTMLButtonElement>(null);
  /** Where the focus goes once that control exists: the one that had it is gone with the view it was in. */
  const focusNext = useRef<"key" | "replace" | null>(null);

  useEffect(() => {
    const target = focusNext.current === "key" ? keyBox.current : replaceButton.current;
    if (focusNext.current === null || target === null) return;
    target.focus();
    focusNext.current = null;
  });

  const read = useCallback(async () => {
    try {
      const status = await store.assistant.keyStatus(provider);
      setUnread(null);
      setSaved(status.saved ? { ...(status.last4 ? { last4: status.last4 } : {}) } : null);
    } catch (error_) {
      focusNext.current = null;
      setUnread(failureOf(error_));
    }
  }, [store, provider]);

  useEffect(() => {
    void read();
  }, [read]);

  const save = async () => {
    if (busy || key.trim() === "") return;
    setDoing("save");
    setError(null);
    try {
      await store.assistant.saveKey(provider, key);
      setKey("");
      setReplacing(false);
      setSaid(null);
      focusNext.current = "replace";
      await read();
    } catch (error_) {
      setError(refusalText(t, failureOf(error_)));
    } finally {
      setDoing(null);
    }
  };

  const test = async () => {
    setDoing("test");
    setSaid(null);
    try {
      const result = await store.assistant.testKey(provider);
      if (result.ok) setSaid(t("assistantSettings.testOk"));
      else if (result.detail?.startsWith("assistant_")) {
        setSaid(refusalText(t, { reason: result.detail }));
      } else setSaid(t("assistantSettings.testFailed"));
    } catch (error_) {
      setSaid(refusalText(t, failureOf(error_)));
    } finally {
      setDoing(null);
    }
  };

  const remove = async () => {
    setRemoving(false);
    setDoing("remove");
    setError(null);
    try {
      await store.assistant.removeKey(provider);
      setSaid(null);
      focusNext.current = "key";
      await read();
    } catch (error_) {
      setError(refusalText(t, failureOf(error_)));
    } finally {
      setDoing(null);
    }
  };

  const unreadNotice =
    unread === null ? null : (
      <div role="alert" className="flex items-center gap-2 text-sm">
        <span>{refusalText(t, unread)}</span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setUnread(null);
            void read();
          }}
        >
          {t("modelPicker.retry")}
        </Button>
      </div>
    );

  if (saved === "unknown") return unreadNotice;
  const label = t("assistantSettings.keyLabel" as Key, { provider: props.name });
  const entering = saved === null || replacing;
  return (
    <fieldset aria-label={props.name} className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
      {entering ? (
        <Form variant="inline" onSubmit={() => void save()}>
          <Field label={label} error={error}>
            {(control) => (
              <Input
                {...control}
                type="password"
                autoComplete="off"
                spellCheck={false}
                ref={keyBox}
                value={key}
                onChange={(e) => setKey(e.target.value)}
              />
            )}
          </Field>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || key.trim() === ""}>
              {t(doing === "save" ? "assistantSettings.keySaving" : "assistantSettings.keySave")}
            </Button>
            {replacing && (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  focusNext.current = "replace";
                  setReplacing(false);
                  setKey("");
                  setError(null);
                }}
              >
                {t("common.cancel")}
              </Button>
            )}
          </div>
        </Form>
      ) : (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>{t("assistantSettings.keySaved", { last4: saved.last4 ?? "" })}</span>
          <Button
            ref={replaceButton}
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => {
              focusNext.current = "key";
              setReplacing(true);
            }}
          >
            {t("assistantSettings.keyReplace")}
          </Button>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void test()}>
            {t(doing === "test" ? "assistantSettings.keyTesting" : "assistantSettings.keyTest")}
          </Button>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => setRemoving(true)}>
            {t(
              doing === "remove" ? "assistantSettings.keyRemoving" : "assistantSettings.keyRemove",
            )}
          </Button>
        </div>
      )}
      {!entering && error && (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      )}
      {unreadNotice}
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
