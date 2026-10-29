/** In-app confirmation (never `window.confirm`, which blocks the webview). */
export function ConfirmDialog(props: {
  message: string;
  warning?: string | null;
  onConfirm(): void;
  onCancel(): void;
}) {
  return (
    <div role="dialog" aria-label="Confirmar" aria-modal="true" className="dialog">
      <p>{props.message}</p>
      {props.warning && <p className="warning">{props.warning}</p>}
      <div className="row">
        <button type="button" className="primary" onClick={props.onConfirm}>
          Confirmar
        </button>
        <button type="button" onClick={props.onCancel}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
