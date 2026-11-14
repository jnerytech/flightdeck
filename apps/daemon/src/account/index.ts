/**
 * The account domain's public entry (#1589): who is signed in to Claude on this host, the plan and
 * its usage windows, read without a prompt and polled by `Account`. Another domain imports from here,
 * never a file inside.
 */
export { Account } from "./account.ts";
export { demoAccountReaders } from "./demo.ts";
export type { AuthStatus } from "./domain/readings.ts";
export { type AccountReaders, accountReaders } from "./readers.ts";
