/** The one live region of the board: how many cards are selected and what an action left to say. */
export function BoardStatus(props: { text: string }) {
  return (
    <div role="status" data-slot="board-status" className="sr-only">
      {props.text}
    </div>
  );
}
