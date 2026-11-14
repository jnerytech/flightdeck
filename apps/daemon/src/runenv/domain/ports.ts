/** A block holds this many ports per card. */
export const PORT_BLOCK = 10;

/** The variable that carries a port: `FLIGHTDECK_PORT_<NAME>`. */
export const portVariable = (name: string) =>
  `FLIGHTDECK_PORT_${name.toUpperCase().replaceAll("-", "_")}`;

/** Where the blocks start when the config does not say (`run.portBase`). */
export const DEFAULT_PORT_BASE = 41000;

/** The ports of one card's block. */
export const BLOCK_SIZE = 10;

/** Whether nothing listens on this machine's port. */
export type PortProbe = (port: number) => Promise<boolean>;

export type PortMap = Record<string, number>;

/** `FLIGHTDECK_PORT_<NAME>` for each port of the card. */
export function portEnv(ports: PortMap): Record<string, string> {
  return Object.fromEntries(
    Object.entries(ports).map(([name, port]) => [portVariable(name), String(port)]),
  );
}

const PORT_REFERENCE = /\{\{\s*port\.([\w-]+)\s*\}\}/g;

/** Replaces `{{port.<name>}}` with the card's port; a name without one is a bug and throws. */
export function interpolatePorts(text: string, ports: PortMap): string {
  return text.replace(PORT_REFERENCE, (_raw, name: string) => {
    const port = ports[name];
    if (port === undefined) throw new Error(`port without a block: ${name}`);
    return String(port);
  });
}
