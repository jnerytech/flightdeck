import type { AppKernel } from "../../lib/kernel.ts";
import type { Platform } from "../../platform/types.ts";
import { type PersonasCore, PersonasSlice } from "./store.ts";

/** Builds the personas' slice from the store's kernel (#1596): a host's pack in the app's language. */
export function wirePersonas(
  kernel: AppKernel<ReturnType<PersonasCore["state"]>>,
  deps: { storage: Platform["storage"]; language: PersonasCore["language"] },
): PersonasSlice {
  return new PersonasSlice({
    state: () => kernel.state(),
    update: (patch) => kernel.update(patch),
    storage: deps.storage,
    list: (hostId, language) =>
      kernel.hostCommand(hostId, "personas.list", { scope: "host", language }),
    language: deps.language,
  });
}
