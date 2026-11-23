import { Eye, EyeOff } from "lucide-react";
import { memo, useRef, useState } from "react";
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
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n/context";
import type { AppState, AppStore } from "@/lib/app-store";
import { useStoreSlice } from "@/lib/use-store";
import { IconActionButton } from "@/shared/feedback/index.ts";
import { Inline } from "@/shared/layout/index.ts";

/** One request: the secret lives only in this field, and goes to the daemon only in the answer. */
function Prompt(props: Readonly<{ store: AppStore; item: AppState["askpass"][number] }>) {
  const t = useT();
  const { store, item } = props;
  const { request } = item;
  const [secret, setSecret] = useState("");
  // Hidden for each request: this component is keyed by the request id, so a shown secret never carries over.
  const [shown, setShown] = useState(false);
  // The action closes the dialog too: only a close that was not an answer is a cancel.
  const answered = useRef(false);
  const answer = (value: string | null) => {
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
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t(`connections.askpass.title.${request.kind}`, { name: request.targetName })}
          </AlertDialogTitle>
          <AlertDialogDescription>{request.prompt}</AlertDialogDescription>
        </AlertDialogHeader>
        <Inline>
          <Input
            type={shown ? "text" : "password"}
            aria-label={label}
            autoComplete="off"
            autoFocus
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
            onKeyDown={(event) => {
              // Enter sends, as the button does: not while an IME composes, and not on an empty field.
              if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
              event.preventDefault();
              if (secret !== "") answer(secret);
            }}
          />
          <IconActionButton
            type="button"
            label={t("connections.askpass.show")}
            aria-pressed={shown}
            onClick={() => setShown(!shown)}
          >
            {shown ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
          </IconActionButton>
        </Inline>
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
  return first ? <Prompt key={first.request.requestId} store={props.store} item={first} /> : null;
});
