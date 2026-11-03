import type { SessionImage } from "@flightdeck/protocol";

/** Why a file was not taken as an image of the message. */
export type ImageRefusal = "type" | "size" | "count";

/** The reason a file cannot join the `have` images already attached, or `null` when it can. */
export function refuseImage(
  _file: { type: string; size: number },
  _have: number,
): ImageRefusal | null {
  return null;
}

/** The bytes of an image file in base64, with the type the file declares. */
export async function readImage(_file: Blob): Promise<SessionImage> {
  return { mediaType: "image/png", data: "" };
}
