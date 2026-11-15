/**
 * What the plugin manager asks of the outside (#1589): the `claude plugin` CLI, the store of pins
 * and the recorder of decisions. The manager depends on these shapes; the adapters (the CLI on
 * the PATH, a JSON file of pins, a JSON-lines log) answer them.
 */

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs `claude plugin <args>`. */
export interface PluginCli {
  run(args: string[]): Promise<CliResult>;
}

/** A version the person fixed: updates are refused until it is released. */
export interface Pin {
  version: string;
  /** The content hash of the plugin when it was pinned. */
  hash: string;
  at: string;
}

/** A store may answer at once (a map in memory) or later (a file). */
type Later<T> = T | Promise<T>;

export interface PinStore {
  all(): Later<Record<string, Pin>>;
  set(id: string, pin: Pin): Later<void>;
  delete(id: string): Later<void>;
}

/** What the manager reads of a marketplace's folder. */
export interface PluginFiles {
  /** The text of the catalog (`.claude-plugin/marketplace.json`) in the marketplace folder `location`. */
  readCatalog(location: string): Promise<string>;
  /** The path with its symbolic links resolved; it rejects when the path does not exist. */
  realpath(path: string): Promise<string>;
}

export interface PluginsOptions {
  cli: PluginCli;
  pins: PinStore;
  /** The marketplace folders; the disk when left out. */
  files?: PluginFiles;
  clock?: () => number;
  /** Told of every install, update, removal and marketplace change that landed. */
  record?: (decision: PluginDecision) => Later<void>;
}

export interface PluginDecision {
  action:
    | "install"
    | "update"
    | "uninstall"
    | "marketplace-add"
    | "marketplace-remove"
    | "rollback";
  /** The plugin id, or the marketplace name or source. */
  target: string;
  /** The content hash that was confirmed, when there is one. */
  hash?: string;
  at: string;
}
