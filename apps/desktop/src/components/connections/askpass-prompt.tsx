import { useRef, useState } from "react";
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

/** One request: the secret lives only in this field, and goes to the daemon only in the answer. */
function Prompt(props: { store: AppStore; item: AppState["askpass"][number] }) {
  const t = useT();
  const { store, item } = props;
  const { request } = item;
  const [secret, setSecret] = useState("");
  // The action closes the dialog too: only a close that was not an answer is a cancel.
  const answered = useRef(false);
  const answer = (value: string | null) => {
    answered.current = true;
    void store.answerAskpass(item.hostId, request.requestId, value);
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
        <Input
          type="password"
          aria-label={label}
          autoComplete="off"
          autoFocus
          value={secret}
          onChange={(event) => setSecret(event.target.value)}
        />
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

/** Phase 15: ssh asks for a password or a key passphrase, one request at a time. */
export function AskpassPrompt(props: { store: AppStore; state: AppState }) {
  const first = props.state.askpass[0];
  return first ? <Prompt key={first.request.requestId} store={props.store} item={first} /> : null;
}
