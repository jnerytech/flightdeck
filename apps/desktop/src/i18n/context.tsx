import { createContext, useContext } from "react";
import { formatNumber } from "./format.ts";
import { type T, translator } from "./index.ts";

/** The app's translator for the components that are not handed one; pt-BR until the app says. */
export const TContext = createContext<T>(translator("pt-BR"));

/** The translator of the language in use (it follows the language switch). */
export const useT = (): T => useContext(TContext);

/** A number with the separators of the language in use ("2.318.400" / "2,318,400"). */
export const useFormatNumber = (): ((value: number) => string) => {
  const { lang } = useT();
  return (value) => formatNumber(value, lang);
};
