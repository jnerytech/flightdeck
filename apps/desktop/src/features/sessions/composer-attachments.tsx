import {
  SESSION_IMAGE_MAX_BYTES,
  SESSION_IMAGE_MAX_COUNT,
  type SessionImage,
} from "@flightdeck/protocol";
import { X } from "lucide-react";
import { IconActionButton } from "@/shared/feedback/index.ts";
import type { T } from "../../i18n/index.ts";
import type { ImageRefusal } from "./domain/session-images.ts";

/** The images waiting in the message box, each with its remove button, and why the last file was turned away. */
export function ComposerAttachments(
  props: Readonly<{
    t: T;
    attached: SessionImage[];
    refusal: ImageRefusal | null;
    onRemove(at: number): void;
  }>,
) {
  const { t, attached, refusal } = props;
  if (attached.length === 0 && !refusal) return null;
  return (
    <div className="composer-images">
      {attached.map((image, at) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: two pasted copies of one image look the same
        <div key={`${at}:${image.data.slice(-16)}`} className="composer-image">
          <img
            alt={t("session.imageAttached", { n: String(at + 1) })}
            src={`data:${image.mediaType};base64,${image.data}`}
            className="composer-thumb"
          />
          <IconActionButton
            label={t("session.imageRemove", { n: String(at + 1) })}
            onClick={() => props.onRemove(at)}
          >
            <X aria-hidden="true" />
          </IconActionButton>
        </div>
      ))}
      {refusal && (
        <p role="alert" className="text-status-error text-xs">
          {t(`session.imageRefused.${refusal}`, {
            max: String(
              refusal === "size"
                ? SESSION_IMAGE_MAX_BYTES / (1024 * 1024)
                : SESSION_IMAGE_MAX_COUNT,
            ),
          })}
        </p>
      )}
    </div>
  );
}
