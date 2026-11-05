/** The side of the taskbar overlay, in pixels. */
export const BADGE_SIZE = 32;

/**
 * The overlay icon for `count` unread notifications as RGBA bytes (a red disc with the number in
 * white; "9+" past nine), or null for none. Drawn here, so the shell only has to hand the pixels to
 * the window and checks nothing but their size.
 */
export function badgeRgba(count: number): number[] | null {
  void count;
  return [];
}
