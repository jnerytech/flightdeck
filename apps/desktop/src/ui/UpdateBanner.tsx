import type { AppState, AppStore } from "../lib/app-store.ts";

/** Phase 9: a newer app version on offer, with its notes, or why looking for one failed. */
export function UpdateBanner(props: { store: AppStore; state: AppState }) {
  const { store, state } = props;
  const { offer, error } = state.appUpdate;
  if (!offer && !error) return null;
  return (
    <section aria-label="Atualização do app" className="update-banner">
      {offer && (
        <>
          <strong>{`Flightdeck ${offer.version} disponível`}</strong>
          {offer.notes && <p>{offer.notes}</p>}
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
