import type { SessionRecap } from "@flightdeck/protocol";
import {
  type Attention,
  BackupScheduler,
  type BackupSlice,
  googleConfig,
  wireBackup,
} from "../../features/backup/index.ts";
import {
  type ClientScopeSlice,
  Clients,
  knownProjects,
  UNASSIGNED,
  wireClientScope,
} from "../../features/clients/index.ts";
import { type ClientBudgetsSlice, wireClientBudgets } from "../../features/costs/index.ts";
import type { InboxSlice } from "../../features/inbox/index.ts";
import type { ProjectsSlice } from "../../features/projects/index.ts";
import { type RoiSlice, wireRoi } from "../../features/roi/index.ts";
import { RoiSettings } from "../../features/roi/roi-settings.ts";
import { hubRows } from "../../features/sessions/index.ts";
import {
  Vault,
  type VaultApprovalsSlice,
  VaultRules,
  type VaultRulesSlice,
  VaultScanSlice,
  type VaultSecretsSlice,
  VaultUsageLog,
  wireVaultApprovals,
  wireVaultRules,
  wireVaultSecrets,
} from "../../features/vault/index.ts";
import { WebhookFeed } from "../../features/webhook/webhook-feed.ts";
import { Webhooks } from "../../features/webhook/webhooks.ts";
import type { AppState, AppStoreOptions } from "../../lib/app-state.ts";
import type { AppKernel } from "../../lib/kernel.ts";
import type { Platform, WebhookRequest, WebhookResponse } from "../../platform/types.ts";

/**
 * The vault, what is asked of it, the backups that carry it, and the clients its rules are scoped
 * to, with what each client spends and earns and the webhooks that report it (#2376).
 */
export interface VaultSlices {
  /** Phase 16: the vault, whose values live in the system keyring. */
  readonly vault: Vault;
  /** The daemon's requests for a secret: the policy, the queue and the outcome listeners. */
  readonly vaultApprovals: VaultApprovalsSlice;
  /** The vault's secrets and their `.fdvault` file; `state.secrets` is the list the screens read. */
  readonly secrets: VaultSecretsSlice;
  /** What the app's log and the screens must never show: the hosts' tokens and the vault's values. */
  readonly scan: VaultScanSlice;
  /** Phase 19: each secret's usage rules, kept with the vault and handed to the hosts (#1596). */
  readonly vaultRules: VaultRulesSlice;
  /** Phase 16: what was asked of the vault, kept in `storage`. */
  readonly usage: VaultUsageLog;
  /** Issue #1264: scheduled backups to a picked folder (the desktop app only). */
  readonly backupScheduler: BackupScheduler;
  /** The whole-app backup file: save, read, compare and restore (#1596). */
  readonly backup: BackupSlice;
  /** Phase 29: the clients, their rules and overrides, kept by the app. */
  readonly clients: Clients;
  /** Which client the person works for: the selection of the work screens and each project's client (#1596). */
  readonly clientScope: ClientScopeSlice;
  /** What each client with a month limit spent against it (phase 9, #1596). */
  readonly clientBudgets: ClientBudgetsSlice;
  /** Phase 36: the rates, the plan price and the people, kept by the app. */
  readonly roi: RoiSettings;
  /** The ROI figures: the day they end on, each host's summary and a project's money (#1596). */
  readonly roiFigures: RoiSlice;
  /** Phase 30: the webhook targets and the sending. */
  readonly webhooks: Webhooks;
  /** What the webhooks are told: each session, permission and budget event, with its client. */
  readonly webhookFeed: WebhookFeed;
}

/** What the vault slices read from the rest of the store; each is read when a slice asks, so a slice built later is fine. */
interface VaultDeps {
  platform: Platform;
  /** The store's options: the vault's policy and work factor, and the Google backup config. */
  options: AppStoreOptions;
  /** The notification center (the bell). */
  notify: InboxSlice["notify"];
  /** Tells the state what the vault was asked, after the log changed. */
  keepUsage: () => void;
  /** Copies a text through the machine's clipboard slice. */
  copyText: (text: string) => Promise<boolean>;
  /** Today's date, as the store reads it. */
  today: () => string;
  /** The key one project goes by on every screen. */
  keyOf: ProjectsSlice["keyOf"];
  /** Posts a webhook through an online host that can. */
  relay: (request: WebhookRequest) => Promise<WebhookResponse>;
  /** The summary of a session of a host; null when the host cannot give one. */
  recap: (
    hostId: string,
    claudeSessionId: string,
    extra: { question?: string },
  ) => Promise<SessionRecap | null>;
  /** Tells the state the ROI settings changed. */
  roiChanged: () => void;
}

/** The client of a folder or project for the webhooks and the ROI, or null when it has none. */
const clientOrNull = (clientId: string): string | null =>
  clientId === UNASSIGNED ? null : clientId;

/**
 * Builds the client slices; the vault's rules follow the clients' scope, so the two are built
 * together (#2376). `scopeChanged` tells the vault's rules a client's folders changed.
 */
function composeClients(
  kernel: AppKernel<AppState>,
  deps: VaultDeps & { scopeChanged: () => void },
): Pick<
  VaultSlices,
  "clients" | "clientScope" | "clientBudgets" | "roi" | "roiFigures" | "webhooks" | "webhookFeed"
> {
  const { platform } = deps;
  // The slices refer to each other through closures that run only after this function returns,
  // so a `const` declared further down is read late, never during construction.
  const clients: Clients = new Clients(platform, { onChange: () => clientScope.sync() });
  const roi = new RoiSettings(platform, { onChange: deps.roiChanged });
  const webhooks = new Webhooks({ platform, send: deps.relay, summaryFor: deps.recap });
  const clientScope: ClientScopeSlice = wireClientScope(kernel, {
    storage: platform.storage,
    clients: () => clients,
    projects: () =>
      knownProjects([
        ...hubRows(kernel.state()),
        ...Object.entries(kernel.state().projects).flatMap(([hostId, list]) =>
          list.map((p) => ({ hostId, cwd: p.path, projectKey: deps.keyOf(hostId, p) })),
        ),
      ]),
    changed: () => {
      deps.scopeChanged();
      clientBudgets.onLimitsChanged();
    },
  });
  const webhookFeed = new WebhookFeed(webhooks, (hostId, cwd) =>
    clientOrNull(cwd ? clientScope.get().clientOfFolder(hostId, cwd) : UNASSIGNED),
  );
  const clientBudgets: ClientBudgetsSlice = wireClientBudgets(kernel, {
    storage: platform.storage,
    limits: () => clients.budgets(),
    today: deps.today,
    scope: () => clientScope.get(),
    clients: () => kernel.state().clientList,
    feed: (name, clientId, percent, limit) =>
      webhookFeed.clientBudget(name, clientId, percent, limit),
    notify: (notification, clientId) =>
      deps.notify(notification, { name: "costs", client: clientId }, undefined, {
        event: "budget-quota",
      }),
  });
  return {
    clients,
    clientScope,
    clientBudgets,
    roi,
    roiFigures: wireRoi(kernel, {
      clientOf: (projectKey) => clientOrNull(clientScope.get().clientOf(projectKey)),
      settings: () => roi,
    }),
    webhooks,
    webhookFeed,
  };
}

/**
 * Builds the vault slices and the client slices. Every slice is built through its own domain's
 * entry; the store keeps only what it owns (#2376).
 */
export function composeVault(kernel: AppKernel<AppState>, deps: VaultDeps): VaultSlices {
  const { platform, options } = deps;
  const vault = new Vault(platform);
  const usage = new VaultUsageLog(platform);
  const backupScheduler = new BackupScheduler(platform, {
    // Issue #1327: a scheduled backup that cannot go reaches the bell, and a click opens its settings.
    onAttention: (kind: Attention) => {
      const t = kernel.t();
      deps.notify(
        {
          title: t(`backupSchedule.attention.${kind}.title`),
          body: t(`backupSchedule.attention.${kind}.body`),
        },
        { name: "settings", section: "backup" },
      );
    },
    google: options.google ?? { config: googleConfig() },
    ...(options.vaultWorkFactor !== undefined && { workFactor: options.vaultWorkFactor }),
  });
  const vaultRules: VaultRulesSlice = wireVaultRules(kernel, {
    rules: new VaultRules(platform.storage),
    secrets: () => vault.list(),
    clients: () => kernel.state().clientList,
    projectKeysOf: (clientId) => clientSlices.clientScope.get().projectKeysOf(clientId),
    fail: (error, text) => kernel.fail(error, text),
    success: (text) => kernel.success(text),
  });
  const clientSlices = composeClients(kernel, {
    ...deps,
    scopeChanged: () => vaultRules.scopeChanged(),
  });
  return {
    ...clientSlices,
    vault,
    usage,
    backupScheduler,
    vaultRules,
    vaultApprovals: wireVaultApprovals(kernel, {
      vault,
      optionsPolicy: () => options.vaultPolicy,
      notify: (title, body) => deps.notify({ title, body, event: "needs-you" }),
      recorded: (outcome) => {
        usage.recordOutcome(outcome);
        deps.keepUsage();
      },
    }),
    secrets: wireVaultSecrets(kernel, {
      vault,
      workFactor: () => options.vaultWorkFactor,
      saveFile: (name, text) => platform.saveFile(name, text),
      pickFile: () => platform.vault.pickFile(),
      fail: (error) => kernel.fail(error),
      copyText: deps.copyText,
      clearClipboardIn: (ms) => {
        setTimeout(() => void platform.copyText("").catch(() => {}), ms);
      },
    }),
    scan: new VaultScanSlice({ vault }),
    backup: wireBackup(kernel, {
      platform,
      scheduler: backupScheduler,
      vaultWorkFactor: options.vaultWorkFactor,
    }),
  };
}
