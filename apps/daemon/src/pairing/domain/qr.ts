import QRCode from "qrcode";

/** The text as a QR code drawn in UTF-8 blocks, for the terminal. */
export function renderQr(text: string): Promise<string> {
  return QRCode.toString(text, { type: "utf8" });
}
