/** A request whose failure only means less to show (an older daemon, a host without history or a board): its error becomes null. */
export const quiet = <T>(promise: Promise<T>) => promise.catch(() => null);
