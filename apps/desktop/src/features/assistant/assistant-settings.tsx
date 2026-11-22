import {
  type AssistantKind,
  type AssistantProfile,
  type AssistantProvider,
  KIND_SPECS,
  type ModelOption,
} from "@flightdeck/protocol";
import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import type { Key, T } from "@/i18n/index";
import type { AppStore } from "@/lib/app-store";
import { useStoreSlice } from "@/lib/use-store";
import { hostsWith } from "@/lib/version";
import { ConfirmDialog } from "@/shared/feedback/index.ts";
import { NativeSelect, Panel } from "@/shared/layout/index.ts";
import {
  type AssistantPrefs,
  confirmHost,
  modelFor,
  needsHostConfirm,
  profileFor,
} from "./domain/assistant-prefs.ts";
import { failureOf, refusalText } from "./domain/refusal-text.ts";
import { KeyField } from "./key-field.tsx";
import { ModelPicker } from "./model-picker.tsx";

const HOSTS_KEYS = ["hosts"] as const;
const OPENROUTER_PRIVACY = "https://openrouter.ai/docs/guides/privacy/data-collection";
const PROFILES: AssistantProfile[] = ["quick", "careful"];

/** The host provider's models: the Claude Code ids that are current, apart from what the host defaults to. */
const HOST_MODELS: ModelOption[] = [
  { id: "claude-fable-5-2", label: "Fable 5.2" },
  { id: "claude-opus-5-5", label: "Opus 5.5" },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5" },
  { id: "claude-haiku-5-5", label: "Haiku 5.5" },
];

/** A kind's name; a dictionary key has no dot, so `prompt.plain` is `prompt_plain` there. */
const kindLabel = (t: T, kind: AssistantKind) =>
  t(`assistantKinds.${kind.replace(".", "_")}` as Key);

/** The kinds of text a profile covers now: the defaults, as moved in Advanced. */
const kindsOf = (t: T, prefs: AssistantPrefs, profile: AssistantProfile) =>
  (Object.keys(KIND_SPECS) as AssistantKind[])
    .filter((kind) => profileFor(prefs, kind) === profile)
    .map((kind) => kindLabel(t, kind))
    .join(", ");

/** The model a profile will use, by the name the list gives it when the list has it. */
const modelInUse = (
  prefs: AssistantPrefs,
  provider: AssistantProvider,
  profile: AssistantProfile,
  options: ModelOption[] | null,
) => {
  const id = modelFor(prefs, provider, profile);
  return options?.find((option) => option.id === id)?.label ?? id;
};

const onLinux = () =>
  typeof navigator !== "undefined" &&
  /linux/i.test(navigator.userAgent) &&
  !/android/i.test(navigator.userAgent);

/** The models of an API provider, from the provider through the shell (null while loading). */
function useModels(
  store: AppStore,
  t: T,
  provider: AssistantProvider | null,
  /** Whether the provider has a key: a key saved or removed asks for the list again. */
  keyed: boolean,
) {
  const [state, setState] = useState<{ options: ModelOption[] | null; error?: string }>({
    options: null,
  });
  const [attempt, setAttempt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` asks for the list again
  useEffect(() => {
    if (provider === null || provider === "host") return;
    let current = true;
    setState({ options: null });
    store.assistant.models(provider).then(
      (options) => current && setState({ options }),
      (error) => {
        if (!current) return;
        const failure = failureOf(error);
        // No key yet is not a refusal to repeat: Settings is where it is saved.
        const text =
          failure.reason === "assistant_not_configured"
            ? t("assistantSettings.modelsNoKey")
            : refusalText(t, failure);
        setState({ options: [], error: text });
      },
    );
    return () => {
      current = false;
    };
  }, [store, t, provider, attempt, keyed]);
  return { ...state, retry: () => setAttempt((n) => n + 1) };
}

/** Where the AI assistant is set up: the provider, its key, the models and the profile of each kind of text (issue #155). */
export function AssistantSettings(props: Readonly<{ store: AppStore; t: T }>) {
  const { store, t } = props;
  const prefs = useSyncExternalStore(store.assistant.subscribe, () => store.assistant.prefs());
  const keys = useSyncExternalStore(store.assistant.subscribe, () => store.assistant.keys());
  const { hosts } = useStoreSlice(store, HOSTS_KEYS);
  const apiSupported = store.assistant.supported;
  const [confirming, setConfirming] = useState<{ hostId: string; provider: boolean } | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const pickerId = useId();
  const privacyId = useId();
  // A wand that found no provider sent the person here: say why, once.
  const [setupNotice] = useState(() => store.assistant.wantsSetup());
  useEffect(() => {
    if (setupNotice) store.assistant.setupShown();
  }, [setupNotice, store]);
  const models = useModels(
    store,
    t,
    prefs.provider,
    prefs.provider === "anthropic" || prefs.provider === "openrouter"
      ? keys[prefs.provider]
      : false,
  );

  const able = hostsWith(hosts, "assistant");
  const hostId = able.find((host) => host.id === prefs.hostId)?.id ?? able[0]?.id ?? null;
  const hostName = able.find((host) => host.id === hostId)?.name;
  const nameOf = (id: string) => hosts.find((host) => host.id === id)?.name ?? id;

  const choose = (provider: AssistantProvider) => {
    if (provider === "host" && hostId && needsHostConfirm(prefs, hostId)) {
      setConfirming({ hostId, provider: true });
      return;
    }
    store.assistant.setPrefs({ provider, ...(provider === "host" && hostId ? { hostId } : {}) });
  };
  const pickHost = (id: string) => {
    if (needsHostConfirm(prefs, id)) setConfirming({ hostId: id, provider: false });
    else store.assistant.setPrefs({ hostId: id });
  };
  const confirmed = () => {
    if (!confirming) return;
    store.assistant.setPrefs({
      hostId: confirming.hostId,
      ...(confirming.provider ? { provider: "host" as const } : {}),
      confirmedHosts: confirmHost(prefs, confirming.hostId).confirmedHosts,
    });
    setConfirming(null);
  };

  const setModel = (provider: AssistantProvider, profile: AssistantProfile, id: string | null) => {
    const mine = { ...prefs.models[provider] };
    if (id === null) delete mine[profile];
    else mine[profile] = id;
    store.assistant.setPrefs({ models: { ...prefs.models, [provider]: mine } });
  };
  const setProfile = (kind: AssistantKind, profile: AssistantProfile) =>
    store.assistant.setPrefs({ profiles: { ...prefs.profiles, [kind]: profile } });

  const radio = (provider: AssistantProvider, label: string, line: string) => (
    <div key={provider} className="flex flex-col gap-1">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="radio"
          name="assistant-provider"
          aria-describedby={`${privacyId}-${provider}`}
          checked={prefs.provider === provider}
          onChange={() => choose(provider)}
        />
        {label}
      </label>
      <p id={`${privacyId}-${provider}`} className="ml-6 text-muted-foreground text-xs">
        {line}
      </p>
    </div>
  );

  const providerModels: ModelOption[] | null =
    prefs.provider === "host" ? HOST_MODELS : models.options;
  return (
    <Panel title={t("assistantSettings.title")}>
      {setupNotice && (
        <p role="note" className="text-sm">
          {t("assistantSettings.setupNotice")}
        </p>
      )}
      <p className="text-muted-foreground text-xs">{t("assistantSettings.hint")}</p>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={prefs.enabled}
          onChange={(e) => store.assistant.setPrefs({ enabled: e.target.checked })}
        />
        {t("assistantSettings.wand")}
      </label>
      <fieldset className="flex flex-col gap-3 border-0 p-0">
        <legend className="mb-1 font-medium text-sm">{t("assistantSettings.provider")}</legend>
        {radio(
          "host",
          t("assistantSettings.host"),
          hostName
            ? t("assistantSettings.privacyHost", { host: hostName })
            : t("assistantSettings.privacyHostNone"),
        )}
        {able.length === 0 && <p className="ml-6 text-sm">{t("assistantSettings.noHost")}</p>}
        {able.length > 1 && hostId && (
          <div className="ml-6 flex items-center gap-2 text-sm">
            <label htmlFor={pickerId}>{t("assistantSettings.hostPicker")}</label>
            <NativeSelect
              id={pickerId}
              inline
              value={hostId}
              onChange={(e) => pickHost(e.target.value)}
            >
              {able.map((host) => (
                <option key={host.id} value={host.id}>
                  {host.name}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}
        {apiSupported ? (
          <>
            {radio(
              "anthropic",
              t("assistantSettings.anthropic"),
              t("assistantSettings.privacyAnthropic"),
            )}
            <div className="ml-6">
              <KeyField store={store} t={t} provider="anthropic" name="Anthropic" />
            </div>
            {radio(
              "openrouter",
              t("assistantSettings.openrouter"),
              t("assistantSettings.privacyOpenrouter"),
            )}
            <div className="ml-6 flex flex-col gap-2">
              <KeyField store={store} t={t} provider="openrouter" name="OpenRouter" />
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={prefs.openrouterPrivate}
                  onChange={(e) =>
                    store.assistant.setPrefs({ openrouterPrivate: e.target.checked })
                  }
                />
                {t("assistantSettings.openrouterPrivate")}
              </label>
              <div>
                <Button variant="link" size="sm" onClick={() => store.openLink(OPENROUTER_PRIVACY)}>
                  {t("assistantSettings.privacyPage")}
                </Button>
              </div>
            </div>
            {onLinux() && (
              <p className="text-muted-foreground text-xs">{t("assistantSettings.linux")}</p>
            )}
          </>
        ) : (
          <p className="text-muted-foreground text-xs">{t("assistantSettings.webOnly")}</p>
        )}
      </fieldset>
      {prefs.provider && (
        <div className="flex flex-col gap-3">
          <h3 className="font-medium text-sm">{t("assistantSettings.models")}</h3>
          {PROFILES.map((profile) => (
            <div key={profile} className="flex flex-col gap-1">
              <ModelPicker
                t={t}
                label={t(`assistantSettings.${profile}` as Key)}
                defaultLabel={t("assistantSettings.defaultModel")}
                options={providerModels}
                value={prefs.models[prefs.provider as AssistantProvider]?.[profile] ?? null}
                onChange={(id) => setModel(prefs.provider as AssistantProvider, profile, id)}
                {...(models.error !== undefined && prefs.provider !== "host"
                  ? { error: models.error, onRetry: models.retry }
                  : {})}
              />
              {kindsOf(t, prefs, profile) !== "" && (
                <p className="text-muted-foreground text-xs">
                  {t("assistantSettings.usedFor", { kinds: kindsOf(t, prefs, profile) })}
                </p>
              )}
              <p className="text-muted-foreground text-xs">
                {t("assistantSettings.modelInUse", {
                  model: modelInUse(
                    prefs,
                    prefs.provider as AssistantProvider,
                    profile,
                    providerModels,
                  ),
                })}
              </p>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-col gap-2">
        <Button
          variant="outline"
          size="sm"
          aria-expanded={advanced}
          onClick={() => setAdvanced((open) => !open)}
        >
          {t("assistantSettings.advanced")}
        </Button>
        {advanced && (
          <>
            <p className="text-muted-foreground text-xs">{t("assistantSettings.advancedHint")}</p>
            <table className="text-sm">
              <thead>
                <tr>
                  <th className="text-left">{t("assistantSettings.kind")}</th>
                  <th className="text-left">{t("assistantSettings.profile")}</th>
                </tr>
              </thead>
              <tbody>
                {(Object.keys(KIND_SPECS) as AssistantKind[]).map((kind) => (
                  <tr key={kind}>
                    <th scope="row" className="text-left font-normal">
                      {kindLabel(t, kind)}
                    </th>
                    <td>
                      <NativeSelect
                        inline
                        compact
                        aria-label={kindLabel(t, kind)}
                        value={profileFor(prefs, kind)}
                        onChange={(e) => setProfile(kind, e.target.value as AssistantProfile)}
                      >
                        <option value="quick">{t("assistantSettings.profileQuick")}</option>
                        <option value="careful">{t("assistantSettings.profileCareful")}</option>
                      </NativeSelect>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
      {confirming && (
        <ConfirmDialog
          message={t("assistantSettings.hostConfirm", { host: nameOf(confirming.hostId) })}
          confirmLabel={t("assistantSettings.hostConfirmYes", { host: nameOf(confirming.hostId) })}
          onCancel={() => setConfirming(null)}
          onConfirm={confirmed}
        />
      )}
    </Panel>
  );
}
