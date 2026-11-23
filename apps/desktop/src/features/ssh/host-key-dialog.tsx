import type { SshHostKeyCheck, SshTarget } from "@flightdeck/protocol";
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
import { useT } from "@/i18n/context";
import { Stack } from "@/shared/layout/index.ts";
import type { AppStore } from "../../lib/app-store.ts";

/** A fingerprint under its label, as a person compares it with the server's own (#4332). */
function Fingerprint(props: Readonly<{ label: string; value: string }>) {
  return (
    <Stack gap={1}>
      <span className="text-muted-foreground text-sm">{props.label}</span>
      <code className="break-all text-sm">{props.value}</code>
    </Stack>
  );
}

/**
 * The server key a connection met: a first one to confirm, or a changed one that stays blocked.
 * The changed case offers no way to trust the new key, only the way to the destination's form.
 */
export function HostKeyDialog(
  props: Readonly<{
    store: AppStore;
    target: SshTarget;
    check: Exclude<SshHostKeyCheck, { status: "pinned" }>;
    onConfirm: () => void;
    onEdit: () => void;
    onClose: () => void;
  }>,
) {
  const t = useT();
  const { check, target } = props;
  const changed = check.status === "changed";
  return (
    <AlertDialog open onOpenChange={(isOpen) => !isOpen && props.onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {changed
              ? t("connections.hostKey.changedTitle")
              : t("connections.hostKey.confirmTitle", { name: target.name })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {changed
              ? t("connections.hostKey.changedMessage", { name: target.name })
              : t("connections.hostKey.confirmMessage", { name: target.name })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {changed && check.pinned && (
          <Fingerprint label={t("connections.hostKey.pinned")} value={check.pinned} />
        )}
        <Fingerprint
          label={changed ? t("connections.hostKey.current") : t("connections.hostKey.fingerprint")}
          value={check.fingerprint}
        />
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void props.store.system.copyText(check.fingerprint)}
          >
            {t("connections.hostKey.copy")}
          </Button>
        </div>
        {changed && <p className="text-sm">{t("connections.hostKey.changedNext")}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel>
            {changed ? t("connections.hostKey.close") : t("common.cancel")}
          </AlertDialogCancel>
          {changed ? (
            <AlertDialogAction onClick={props.onEdit}>
              {t("connections.hostKey.edit")}
            </AlertDialogAction>
          ) : (
            <AlertDialogAction onClick={props.onConfirm}>
              {t("connections.hostKey.confirm")}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
