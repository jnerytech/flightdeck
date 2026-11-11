import { z } from "zod";

// The JSON columns of `ssh_targets`, as the store writes them (#1609). Each is read with
// `parseJsonWith`, so a damaged one is an error: for the pinned key a null would read as "no key
// yet" and the next connect would pin whatever answers.

/** The pinned server key: its fingerprint and every key (`<type> <base64>`). */
export const PinnedKey = z.object({ fingerprint: z.string(), keys: z.array(z.string()) });

/** A destination's tags. */
export const Tags = z.array(z.string());
