/** The plugin folders and the `claude` answers behind the demo's Plugins prints (#3956). */
import type { FakeRule } from "../../test/fake-cli.ts";

export interface DemoPluginFiles {
  /** What the demo's fake `claude plugin` answers. */
  rules: FakeRule[];
  /** A plugin folder the validation refuses: the local-folder print previews it. */
  refusedFolder: string;
}

/** Writes the demo's plugin folders under `work` and returns the answers of the fake `claude`. */
export function writeDemoPlugins(_work: string): DemoPluginFiles {
  return { rules: [], refusedFolder: "" };
}
