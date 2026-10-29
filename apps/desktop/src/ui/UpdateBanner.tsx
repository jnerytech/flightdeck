import type { AppState, AppStore } from "../lib/app-store.ts";

/**
 * Phase 9: a newer app version on offer, with its notes, or why looking for one failed. With
 * daemons behind as well, it suggests updating the app first.
 */
export function UpdateBanner(props: { store: AppStore; state: AppState }) {
  const { store, state } = props;
  const { offer, error } = state.appUpdate;
  if (!offer && !error) return null;
  const daemonsBehind = state.hosts.some((h) => h.hostInfo?.update?.available);
  return (
    <section aria-label="Atualização do app" className="update-banner">
      {offer && (
        <>
          <strong>{`Flightdeck ${offer.version} disponível`}</strong>
          {offer.notes && <p>{offer.notes}</p>}
          {daemonsBehind && (
            <p className="muted">Atualize primeiro o app e depois os daemons dos hosts.</p>
          )}
          <button type="button" className="primary" onClick={() => void store.installAppUpdate()}>
            Instalar e reiniciar
          </button>
          <button type="button" onClick={() => store.dismissAppUpdate()}>
            Depois
          </button>
        </>
      )}
      {error && <p className="warning">{error}</p>}
    </section>
  );
}
