import { describe, expect, test } from "bun:test";
import { DAEMON_FEATURES } from "@flightdeck/protocol";
import { en } from "../src/i18n/en.ts";
import { translateError } from "../src/i18n/errors.ts";
import { translator } from "../src/i18n/index.ts";
import { ptBR } from "../src/i18n/pt-BR.ts";

const enT = translator("en");
const ptT = translator("pt-BR");

describe("recusas-recurso: the app names the feature a host does not offer", () => {
  test("every feature the daemon can report has a name in both languages", () => {
    expect((DAEMON_FEATURES as readonly string[]).length).toBeGreaterThan(30);
    for (const feature of DAEMON_FEATURES) {
      expect(typeof (en.daemonFeature as Record<string, string>)[feature]).toBe("string");
      expect(typeof (ptBR.daemonFeature as Record<string, string>)[feature]).toBe("string");
    }
  });

  test("feature_off is one sentence with the feature named in the app's language", () => {
    const why = { reason: "feature_off", params: { feature: "vault" } };
    expect(translateError("invalid_state", "vault is off", enT, why)).toEqual({
      title: "This host does not offer the vault: update the daemon, or check its settings.",
      detail: "",
    });
    expect(translateError("invalid_state", "vault is off", ptT, why).title).toBe(
      "Este host não oferece o cofre: atualize o daemon ou confira as configurações.",
    );
  });

  test("a feature the app does not know is named by its id, not hidden", () => {
    const why = { reason: "feature_off", params: { feature: "from_the_future" } };
    expect(translateError("invalid_state", "x", enT, why).title).toContain("from_the_future");
  });
});
