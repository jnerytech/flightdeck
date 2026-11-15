import { SecretScanner } from "../../src/snippets/domain/model.ts";

export const scanner = new SecretScanner();

export const cleanups: Array<() => unknown> = [];

export async function runCleanups() {
  for (const fn of cleanups.splice(0).reverse()) await fn();
}
