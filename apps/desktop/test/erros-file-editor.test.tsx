import { afterEach, describe, expect, test } from "bun:test";
import { registerDom } from "./dom.ts";

registerDom();
const { act, cleanup, render } = await import("@testing-library/react");
const { TContext } = await import("../src/i18n/context.tsx");
const { translator } = await import("../src/i18n/index.ts");
const { FileEditor } = await import("../src/ui/FileEditor.tsx");

import type { AppStore } from "../src/lib/app-store.ts";

afterEach(cleanup);

const FORBIDDEN = {
  en: "The folder is outside the host's allowed folders.",
  "pt-BR": "A pasta está fora das pastas permitidas do host.",
};

/** A store whose every host request is refused with `code`. */
function refusingStore(code: string, message: string) {
  return {
    hostRequest: async () => ({ ok: false, code, message }),
    success: () => {},
  } as unknown as AppStore;
}

describe("erros: the file editor", () => {
  for (const language of ["en", "pt-BR"] as const) {
    test(`a refused read shows the catalog text for its code, then the host's message, in ${language}`, async () => {
      render(
        <TContext.Provider value={translator(language)}>
          <FileEditor
            store={refusingStore("forbidden_cwd", "raw-detail-from-host")}
            hostId="h"
            target="t"
            path="a.md"
            onSaved={() => {}}
            onClose={() => {}}
          />
        </TContext.Provider>,
      );
      await act(() => Bun.sleep(10));
      const text = document.body.textContent ?? "";
      expect(text).toContain(FORBIDDEN[language]);
      expect(text).toContain("raw-detail-from-host");
    });
  }
});
