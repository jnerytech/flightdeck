import { z } from "zod";

// The JSON a plugin folder and the `claude plugin` CLI hand over (#1609). The shape is another
// program's, so most of it is read as plain JSON and walked with guards; only what the daemon
// keeps (the pins) has a schema of its own.

/** Any JSON value, walked with guards after: the manifests, the catalog and the CLI's answers vary in shape on purpose. */
export const AnyJson = z.unknown();

/** A JSON object, whatever its keys. */
export const JsonObject = z.record(z.string(), z.unknown());

/**
 * The pins file. A missing or wrong field reads empty and the others stay; an entry that is no object stays
 * a pin with every field empty: a key in the file blocks an update, so a bad entry must not vanish.
 */
export const PinsJson = z.record(
  z.string(),
  z
    .looseObject({
      version: z.string().catch(""),
      hash: z.string().catch(""),
      at: z.string().catch(""),
    })
    .catch({ version: "", hash: "", at: "" }),
);
