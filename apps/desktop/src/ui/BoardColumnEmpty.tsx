/**
 * What an empty board column shows: a quiet dashed box that says it is empty and still adds a card
 * when pressed (`label` names that for assistive technology).
 */
export function BoardColumnEmpty(props: { label: string; text: string; onAdd(): void }) {
  return (
    <button
      type="button"
      aria-label={props.label}
      className="column-empty border-dashed"
      onClick={props.onAdd}
    >
      {props.text}
    </button>
  );
}
