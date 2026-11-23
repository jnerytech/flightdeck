import { memo, type RefObject, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n/context";
import type { AppState, AppStore } from "@/lib/app-store";
import { useStoreSlice } from "@/lib/use-store";
import { Inline, Stack } from "@/shared/layout/index.ts";

function giveFocusBack(opener: Element | null) {
  const target =
    opener instanceof HTMLElement && opener.isConnected && opener !== document.body
      ? opener
      : document.querySelector<HTMLElement>("main");
  target?.focus();
}

/** One request: the secret lives only in this field, and goes to the daemon only in the answer. */
function Prompt(
  props: Readonly<{
    store: AppStore;
    item: AppState["askpass"][number];
    /** The last request of the queue: its close gives the focus back; another request's field takes it instead. */
    last: boolean;
    /** What had the focus when the first request came. */
    opener: RefObject<Element | null>;
  }>,
) {
  const t = useT();
  const { store, item } = props;
  const { request } = item;
  const [secret, setSecret] = useState("");
  // Hidden for each request: this component is keyed by the request id, so a shown secret never carries over.
  const [shown, setShown] = useState(false);
  // The action closes the dialog too: only a close that was not an answer is a cancel.
  const answered = useRef(false);
  const field = useRef<HTMLInputElement>(null);
  const answer = (value: string | null) => {
    // One answer: a held Enter lands more keys before the dialog is gone.
    if (answered.current) return;
    answered.current = true;
    void store.ssh.answer(item.hostId, request.requestId, value);
  };
  const label = t(`connections.askpass.label.${request.kind}`);
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !answered.current) answer(null);
      }}
    >
      <AlertDialogContent
        onCloseAutoFocus={(event) => {
          // The dialog has no trigger to give the focus back to: it goes to what had it when the request came,
          // or, when that is gone, to the main area, never to the end of the page (#4331).
          event.preventDefault();
          if (props.last) giveFocusBack(props.opener.current);
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t(`connections.askpass.title.${request.kind}`, { name: request.targetName })}
          </AlertDialogTitle>
          <AlertDialogDescription>{request.prompt}</AlertDialogDescription>
        </AlertDialogHeader>
        <Stack gap={2}>
          <Input
            ref={field}
            type={shown ? "text" : "password"}
            aria-label={label}
            autoComplete="off"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            autoFocus
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
            onKeyDown={(event) => {
              // Enter sends, as the button does: not an IME's Enter (WebKit reports it as keyCode 229 after the
              // composition ended), not a held key, and not an empty field.
              if (event.key !== "Enter" || event.repeat) return;
              if (event.nativeEvent.isComposing || event.keyCode === 229) return;
              event.preventDefault();
              if (secret !== "") answer(secret);
            }}
          />
          <Inline>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-pressed={shown}
              onClick={() => {
                setShown(!shown);
                // The press took the focus: the person is typing in the field.
                field.current?.focus();
              }}
            >
              {t("connections.askpass.show")}
            </Button>
          </Inline>
        </Stack>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction disabled={secret === ""} onClick={() => answer(secret)}>
            {t("connections.askpass.send")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

const ASKPASSPROMPT_KEYS = ["askpass"] as const;

/** Phase 15: ssh asks for a password or a key passphrase, one request at a time. */
export const AskpassPrompt = memo(function AskpassPrompt(props: { store: AppStore }) {
  const { store } = props;
  const state = useStoreSlice(store, ASKPASSPROMPT_KEYS);
  const first = state.askpass[0];
  // Taken in the render where the queue stops being empty, before the first dialog moves the focus into its field.
  const opener = useRef<Element | null>(null);
  const recorded = useRef(false);
  if (!first) recorded.current = false;
  else if (!recorded.current) {
    recorded.current = true;
    opener.current = document.activeElement;
  }
  return first ? (
    <Prompt
      key={first.request.requestId}
      store={props.store}
      item={first}
      last={state.askpass.length === 1}
      opener={opener}
    />
  ) : null;
});
