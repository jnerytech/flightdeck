import type { AppKernel } from "../../lib/kernel.ts";
import { type AccountCore, AccountSlice } from "./store.ts";

/** Builds the accounts' slice from the store's kernel (#1596): a host's account stream and `account.refresh`. */
export function wireAccount(kernel: AppKernel<ReturnType<AccountCore["state"]>>): AccountSlice {
  return new AccountSlice({
    state: () => kernel.state(),
    update: (patch) => kernel.update(patch),
    stream: (hostId) => {
      const conn = kernel.connection(hostId);
      return (
        conn && {
          watch: (on) => conn.watchAccount(on),
          get: () => conn.request("account.get", {}),
        }
      );
    },
    refresh: (hostId) => kernel.hostCommand(hostId, "account.refresh", {}),
  });
}
