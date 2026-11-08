import { useId, useState } from "react";
import { Panel } from "@/components/layout/panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n/context";
import type { Key } from "@/i18n/index";
import type { AppStore } from "@/lib/app-store";
import { RoiSettingsError } from "@/lib/roi-settings";
import { useStoreSlice } from "@/lib/use-store";

/** Empty means "none"; anything else must be a number. */
function amountOf(text: string): number | null | "bad" {
  if (text.trim() === "") return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : "bad";
}

/**
 * Phase 36: what the person types for the return on cost: the default hourly rate, whether their
 * review time counts, and the people (groups of hosts with a monthly limit). Money stays in the app.
 */
export function RoiSettingsPanel(props: Readonly<{ store: AppStore }>) {
  const { store } = props;
  const t = useT();
  const hosts = useStoreSlice(store, ["hosts", "roiRevision"]).hosts;
  const [tick, setTick] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const settings = store.roi.data();
  const [rate, setRate] = useState(
    settings.defaultRate === null ? "" : String(settings.defaultRate),
  );
  const [cap, setCap] = useState(String(settings.reviewCapMinutes));
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [tokenLimit, setTokenLimit] = useState("");
  const [costLimit, setCostLimit] = useState("");
  const ids = {
    rate: useId(),
    cap: useId(),
    name: useId(),
    hosts: useId(),
    tokens: useId(),
    cost: useId(),
  };

  /** Runs a change of the settings; a refusal is told by its reason. */
  const run = (change: () => void) => {
    try {
      change();
      setMessage(null);
      setTick((n) => n + 1);
    } catch (error) {
      setMessage(
        error instanceof RoiSettingsError
          ? t(`roiUi.settingsPanel.error.${error.reason}` as Key)
          : t("roiUi.settingsPanel.error.number"),
      );
    }
  };
  const withNumber = (text: string, apply: (n: number | null) => void) => {
    const n = amountOf(text);
    if (n === "bad")
      return run(() => {
        throw new RoiSettingsError("number");
      });
    run(() => apply(n));
  };

  return (
    <Panel
      title={t("roiUi.settingsPanel.title")}
      label={t("roiUi.settingsPanel.title")}
      slot="roi-settings"
    >
      {message && (
        <p role="alert" className="text-destructive text-sm">
          {message}
        </p>
      )}
      <div data-slot="setting-row" className="setting-row">
        <label htmlFor={ids.rate}>{t("roiUi.settingsPanel.defaultRate")}</label>
        <div className="team-row">
          <Input
            id={ids.rate}
            inputMode="decimal"
            className="h-8 w-28"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() => withNumber(rate, (n) => store.roi.setDefaultRate(n))}
          >
            {t("roiUi.settingsPanel.saveRate")}
          </Button>
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={settings.countReview}
          onChange={(e) => run(() => store.roi.setCountReview(e.target.checked))}
        />
        {t("roiUi.settingsPanel.countReview")}
      </label>
      <div data-slot="setting-row" className="setting-row">
        <label htmlFor={ids.cap}>{t("roiUi.settingsPanel.reviewCap")}</label>
        <div className="team-row">
          <Input
            id={ids.cap}
            inputMode="numeric"
            className="h-8 w-20"
            value={cap}
            onChange={(e) => setCap(e.target.value)}
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() => run(() => store.roi.setReviewCap(Number(cap)))}
          >
            {t("roiUi.settingsPanel.saveCap")}
          </Button>
        </div>
      </div>
      <h4 className="font-medium text-sm">{t("roiUi.settingsPanel.peopleTitle")}</h4>
      {settings.people.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm">
          {settings.people.map((p) => (
            <li key={p.id} className="flex items-center gap-2">
              <span>{p.name}</span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => run(() => store.roi.removePerson(p.id))}
              >
                {t("roiUi.settingsPanel.removePerson", { name: p.name })}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div data-slot="setting-row" className="setting-row">
        <label htmlFor={ids.name}>{t("roiUi.settingsPanel.personName")}</label>
        <Input
          id={ids.name}
          className="h-8 w-40"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <fieldset aria-labelledby={ids.hosts} className="m-0 min-w-0 border-0 p-0">
        <div data-slot="setting-row" className="setting-row">
          <span id={ids.hosts}>{t("roiUi.settingsPanel.personHosts")}</span>
          <div className="team-row">
            {hosts.map((h) => (
              <label key={h.id} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={picked.includes(h.id)}
                  disabled={store.roi.personOf(h.id) !== null}
                  onChange={(e) =>
                    setPicked(
                      e.target.checked ? [...picked, h.id] : picked.filter((id) => id !== h.id),
                    )
                  }
                />
                {h.name}
              </label>
            ))}
          </div>
        </div>
      </fieldset>
      <div data-slot="setting-row" className="setting-row">
        <label htmlFor={ids.tokens}>{t("roiUi.settingsPanel.tokenLimit")}</label>
        <Input
          id={ids.tokens}
          inputMode="numeric"
          className="h-8 w-32"
          value={tokenLimit}
          onChange={(e) => setTokenLimit(e.target.value)}
        />
      </div>
      <div data-slot="setting-row" className="setting-row">
        <label htmlFor={ids.cost}>{t("roiUi.settingsPanel.costLimit")}</label>
        <Input
          id={ids.cost}
          inputMode="decimal"
          className="h-8 w-28"
          value={costLimit}
          onChange={(e) => setCostLimit(e.target.value)}
        />
      </div>
      <Button
        size="sm"
        variant="outline"
        className="self-start"
        onClick={() => {
          const tokens = amountOf(tokenLimit);
          const cost = amountOf(costLimit);
          if (tokens === "bad" || cost === "bad")
            return run(() => {
              throw new RoiSettingsError("person_limit_invalid");
            });
          run(() => {
            store.roi.addPerson({ name, hostIds: picked, tokenLimit: tokens, costLimit: cost });
            setName("");
            setPicked([]);
            setTokenLimit("");
            setCostLimit("");
          });
        }}
      >
        {t("roiUi.settingsPanel.addPerson")}
      </Button>
    </Panel>
  );
}
