/**
 * One step of a path as a Windows filesystem reads it, so a check by name sees what the disk sees
 * (issues #1034, #1064): in lower case, with no NTFS stream after a colon (`.git::$INDEX_ALLOCATION`
 * is the folder itself), with no trailing dots or spaces (Windows drops them), and a dotted
 * folder's 8.3 short name (`GIT~1`, `CLAUDE~1`) turned back into the name it stands for (`.git`).
 * A short name keeps the first six letters of the name, so a longer folder (`.flightdeck`) is not
 * recognised by its short form. A step of only dots and spaces (`..`) is left as it is.
 */
export function ntfsName(step: string): string {
  const lower = step.toLowerCase();
  const colon = lower.indexOf(":");
  const named = colon < 0 ? lower : lower.slice(0, colon);
  let end = named.length;
  while (end > 0 && (named[end - 1] === "." || named[end - 1] === " ")) end--;
  const base = named.slice(0, end);
  if (base === "") return lower;
  const short = /^([^.: ~]{1,6})~\d+$/.exec(base);
  return short ? `.${short[1]}` : base;
}
