import type { VaultVerdict } from "@flightdeck/protocol";
import { useId, useState } from "react";
import { ActionButton } from "@/components/feedback/action-button";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n/context";
import type { AppStore } from "@/lib/app-store";
import { PURPOSES, REQUESTERS } from "@/lib/vault-rules-form";

const SELECT =
  "h-9 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

type Purpose = (typeof PURPOSES)[number];
type Requester = (typeof REQUESTERS)[number];

/** Phase 19: "what happens if…": the verdict of the saved rules for a use, from a host. */
export function RulesPreview(props: { store: AppStore; secretId: string }) {
  const t = useT();
  const id = useId();
  const [requester, setRequester] = useState<Requester>("claude");
  const [purpose, setPurpose] = useState<Purpose>("action");
  const [action, setAction] = useState("");
  const [result, setResult] = useState<VaultVerdict | "none" | null>(null);

  const run = async () => {
    const verdict = await props.store.previewVaultUse(props.secretId, {
      requester,
      purpose,
      ...(action.trim() ? { action: action.trim() } : {}),
    });
    setResult(verdict ?? "none");
  };

  return (
    <fieldset className="flex flex-col gap-2 rounded-md border p-3">
      <legend className="px-1 font-medium">{t("vaultRulesUi.preview.title")}</legend>
      <div className="grid gap-2 @2xl:grid-cols-3">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-requester`}>{t("vaultRulesUi.preview.requester")}</label>
          <select
            id={`${id}-requester`}
            className={SELECT}
            value={requester}
            onChange={(e) => setRequester(e.target.value as Requester)}
          >
            {REQUESTERS.map((r) => (
              <option key={r} value={r}>
                {t(`actionsUi.requester.${r}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-purpose`}>{t("vaultRulesUi.preview.purpose")}</label>
          <select
            id={`${id}-purpose`}
            className={SELECT}
            value={purpose}
            onChange={(e) => setPurpose(e.target.value as Purpose)}
          >
            {PURPOSES.map((p) => (
              <option key={p} value={p}>
                {t(`vaultRulesUi.purposes.${p}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-action`}>{t("vaultRulesUi.preview.action")}</label>
          <Input id={`${id}-action`} value={action} onChange={(e) => setAction(e.target.value)} />
        </div>
      </div>
      <ActionButton type="button" variant="outline" className="self-start" onClick={() => run()}>
        {t("vaultRulesUi.preview.run")}
      </ActionButton>
      {result !== null && (
        <p role="status" aria-label={t("vaultRulesUi.preview.result")}>
          {result === "none"
            ? t("vaultRulesUi.preview.noHost")
            : [
                t(`vaultRulesUi.decision.${result.decision}`),
                result.reason,
                ...(result.once ? [t("vaultRulesUi.preview.once")] : []),
                ...(result.needsHold ? [t("vaultRulesUi.preview.hold")] : []),
                ...(result.limited ? [t("vaultRulesUi.preview.limited")] : []),
              ].join(" · ")}
        </p>
      )}
    </fieldset>
  );
}
