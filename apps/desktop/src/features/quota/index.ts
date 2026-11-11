/**
 * The plan quota's public entry in the app (#1589, #1596): each host's 5-hour and 7-day windows, its
 * pause guard and the notices they raise. Another domain imports from here, never a file inside.
 */
export { QuotaGuard } from "./quota-guard.tsx";
export {
  initialQuotaState,
  type QuotaCore,
  type QuotaNotice,
  QuotaSlice,
  type QuotaSliceState,
} from "./store.ts";
export { wireQuota } from "./wire.ts";
