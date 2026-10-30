declare module "claude-code" {
  interface PluginState {
    /** The names of the actions running now, for the band above the prompt. */
    "flightdeck-actions": { running: string[] };
  }
}
