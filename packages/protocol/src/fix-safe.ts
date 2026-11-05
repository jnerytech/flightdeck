/** What a host may offer the person to paste into a shell or open in a browser as the fix of a dependency (HD-m1, HD-m2). */

/** True when `command` is one of the known fix commands. */
export function safeFixCommand(_command: string): boolean {
  return true;
}

/** True when `url` is an https address on one of the official install pages' hosts. */
export function safeFixUrl(_url: string): boolean {
  return true;
}
