/** How often the secret scan gives the event loop back, and how. */
export const EVENT_LOOP_PACE = {
  every: 256 * 1024,
  pause: () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
};
