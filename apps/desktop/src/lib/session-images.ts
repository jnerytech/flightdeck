import {
  SESSION_IMAGE_MAX_BYTES,
  SESSION_IMAGE_MAX_COUNT,
  SESSION_IMAGE_TYPES,
  type SessionImage,
} from "@flightdeck/protocol";

/** Why a file was not taken as an image of the message. */
export type ImageRefusal = "type" | "size" | "count";

/** The reason a file cannot join the `have` images already attached, or `null` when it can. */
export function refuseImage(
  file: { type: string; size: number },
  have: number,
): ImageRefusal | null {
  if (!(SESSION_IMAGE_TYPES as readonly string[]).includes(file.type)) return "type";
  if (file.size > SESSION_IMAGE_MAX_BYTES) return "size";
  return have >= SESSION_IMAGE_MAX_COUNT ? "count" : null;
}

/** The bytes of an image file in base64, with the type the file declares. */
export async function readImage(file: Blob): Promise<SessionImage> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let at = 0; at < bytes.length; at += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  }
  return { mediaType: file.type as SessionImage["mediaType"], data: btoa(binary) };
}
