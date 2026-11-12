/** Where the daemon and its commands write their lines: `log` for output, `error` for problems (#1675). */
export interface Logger {
  log(message: string): void;
  error(message: string): void;
}
