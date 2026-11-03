import { useState } from "react";
import { AppDialogContent } from "@/components/feedback/dialog-content";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n/context";
import type { HostNameError } from "../lib/host-name.ts";

/** Renames a host (the app's display name only). Esc or Cancel closes it; Enter saves. */
export function RenameHostDialog(props: {
  name: string;
  /** Saves the name; the error says why it was refused, null means it is saved. */
  onRename(name: string): HostNameError | null;
  onClose(): void;
}) {
  const t = useT();
  const [name, setName] = useState(props.name);
  const [error, setError] = useState<HostNameError | null>(null);
  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <AppDialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t("hostPage.renameTitle")}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const refused = props.onRename(name);
            if (refused) setError(refused);
            else props.onClose();
          }}
        >
          <Input
            aria-label={t("hostPage.nameLabel")}
            aria-invalid={error !== null}
            // biome-ignore lint/a11y/noAutofocus: the dialog exists to type the name
            autoFocus
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
          />
          {error && (
            <p role="alert" className="text-sm text-status-error">
              {t(error === "empty" ? "hostPage.renameEmpty" : "hostPage.renameDuplicate")}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={props.onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit">{t("hostPage.saveName")}</Button>
          </DialogFooter>
        </form>
      </AppDialogContent>
    </Dialog>
  );
}
