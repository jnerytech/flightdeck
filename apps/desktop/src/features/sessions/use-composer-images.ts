import { inSequence, type SessionImage } from "@flightdeck/protocol";
import { useState } from "react";
import { type ImageRefusal, readImage, refuseImage } from "./domain/session-images.ts";

/**
 * The images waiting to go with the next message, and why the last file was turned away.
 * `attach` takes the image files of a list (pasted, dropped or picked); with `enabled` off it takes none.
 */
export function useComposerImages(enabled: boolean | undefined) {
  const [attached, setAttached] = useState<SessionImage[]>([]);
  const [refusal, setRefusal] = useState<ImageRefusal | null>(null);
  const attach = async (files: File[]) => {
    const images = files.filter((file) => file.type.startsWith("image/"));
    if (!enabled || images.length === 0) return;
    let have = attached.length;
    const taken: SessionImage[] = [];
    let turned: ImageRefusal | null = null;
    await inSequence(images, async (file) => {
      const why = refuseImage(file, have);
      if (why) turned = why;
      else {
        taken.push(await readImage(file));
        have++;
      }
    });
    setRefusal(turned);
    if (taken.length > 0) setAttached((before) => [...before, ...taken]);
  };
  return { attached, setAttached, refusal, setRefusal, attach };
}
