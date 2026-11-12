import { createHash, timingSafeEqual } from "node:crypto";

const digest = (value: string) => createHash("sha256").update(value).digest();

/** Constant-time token comparison (hashing first keeps the lengths equal). */
export function tokenMatches(expected: string, given: string): boolean {
  return timingSafeEqual(digest(expected), digest(given));
}
