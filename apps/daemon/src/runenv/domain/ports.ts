/** A block holds this many ports per card. */
export const PORT_BLOCK = 10;

/** The variable that carries a port: `FLIGHTDECK_PORT_<NAME>`. */
export const portVariable = (name: string) =>
  `FLIGHTDECK_PORT_${name.toUpperCase().replaceAll("-", "_")}`;
