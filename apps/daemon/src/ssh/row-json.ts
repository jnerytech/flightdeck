import { SshOptions } from "@flightdeck/protocol";
import { z } from "zod";

// The JSON columns of `ssh_targets`, as the store writes them (#1609). Each is read with
// `parseJsonWith`, so a damaged one is an error: for the pinned key a null would read as "no key
// yet" and the next connect would pin whatever answers.

/** The pinned server key: its fingerprint and every key (`<type> <base64>`). */
export const PinnedKey = z.object({
  fingerprint: z.string().min(1),
  keys: z.array(z.string().min(1)).min(1),
});

/** The options as stored; a key this daemon does not know (a newer one wrote it) is left out. */
export const StoredOptions = SshOptions.strip();

/** Only what the ForwardAgent confirm needs from the options a destination had: damage reads as off. */
export const WasForwardAgent = z.looseObject({ forwardAgent: z.boolean().catch(false) });

/** A destination's tags. */
export const Tags = z.array(z.string());
