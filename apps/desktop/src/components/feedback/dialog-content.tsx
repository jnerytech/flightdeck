import { XIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { DialogClose, DialogContent } from "@/components/ui/dialog";
import { useT } from "../../i18n/context.tsx";

/**
 * A dialog's content with a × named from the dictionary: the vendored one hardcodes an English
 * label. The target is 24 px, and Esc still closes through the dialog itself.
 */
export function AppDialogContent({ children, ...props }: ComponentProps<typeof DialogContent>) {
  const t = useT();
  return (
    <DialogContent {...props} showCloseButton={false}>
      {children}
      <DialogClose
        aria-label={t("common.close")}
        className="absolute top-4 right-4 inline-flex size-6 items-center justify-center rounded-xs opacity-70 transition-opacity hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden [&_svg]:size-4"
      >
        <XIcon aria-hidden="true" />
      </DialogClose>
    </DialogContent>
  );
}
