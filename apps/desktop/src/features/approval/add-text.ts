/** What a new device shows and an enrolled one reads to add it as an approver (#3478). */
export interface AddText {
  daemonId: string;
  publicKey: string;
  name: string;
}

/** The short text the new device shows, for the person to carry to an enrolled device. */
export function encodeAdd(_text: AddText): string {
  return "";
}

/** The text read back, or null when it is not one this app made or its fields are not fit to sign. */
export function decodeAdd(_text: string): AddText | null {
  return null;
}

/** Sixteen characters of the key's id in groups of four: what the person compares on both devices. */
export async function fingerprintOf(_publicKey: string): Promise<string> {
  return "";
}
