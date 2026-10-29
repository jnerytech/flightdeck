import type { BoardColumn, Card, Project } from "@flightdeck/protocol";
import { useEffect, useRef, useState } from "react";
import type { AppState, AppStore } from "../lib/app-store.ts";
import {
  CHECK_LABELS,
  COLUMNS,
  filterCards,
  PR_LABELS,
  positionBefore,
  projectCards,
} from "../lib/board.ts";
import { StatusBadge } from "./StatusBadge.tsx";

function CardTile(props: {
  card: Card;
  formatTime(iso: string): string;
  onOpen(): void;
  onDragStart(): void;
  onDropOn(): void;
}) {
  const { card } = props;
  return (
    <li
      draggable
      aria-label={`Card ${card.title}`}
      className="board-card"
      onDragStart={props.onDragStart}
      onDrop={(e) => {
        e.stopPropagation();
        props.onDropOn();
      }}
    >
      <button type="button" onClick={props.onOpen}>
        {card.title}
      </button>
      <div className="badges">
        {card.sessionStatus && <StatusBadge status={card.sessionStatus} />}
        {card.queued && <span className="badge badge-muted">na fila</span>}
        {card.queueReason === "quota" && (
          <span className="badge badge-warn">
            {card.quotaUntil
              ? `aguardando cota até ${props.formatTime(card.quotaUntil)}`
              : "aguardando cota"}
          </span>
        )}
        {card.prState && <span className="badge">{PR_LABELS[card.prState]}</span>}
        {card.checksState && <span className="badge">{CHECK_LABELS[card.checksState]}</span>}
      </div>
      {card.notice && <p className="notice">{card.notice}</p>}
    </li>
  );
}

/** A project's board: five columns, drag and drop between and within them, text filter. */
export function BoardView(props: {
  store: AppStore;
  state: AppState;
  hostId: string;
  projectId: string;
  onOpenCard(cardId: string): void;
}) {
  const { store, hostId, projectId } = props;
  const [project, setProject] = useState<Project | null>(null);
  const [filter, setFilter] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  /**
   * Card being dragged. A ref, not state: the drop may come before a re-render. Not in
   * DataTransfer either, which some webviews leave empty.
   */
  const dragging = useRef<string | null>(null);

  useEffect(() => {
    void store.hostCommand(hostId, "board.get", { projectId }).then((board) => {
      if (board) setProject(board.project);
    });
  }, [store, hostId, projectId]);

  const all = projectCards(props.state, hostId, projectId);
  const shown = filterCards(all, filter);

  const drop = (column: BoardColumn, targetId?: string) => {
    const cardId = dragging.current;
    if (!cardId) return;
    const others = all.filter((card) => card.column === column && card.id !== cardId);
    const position = targetId ? positionBefore(others, targetId) : undefined;
    dragging.current = null;
    void store.hostCommand(hostId, "card.move", {
      cardId,
      column,
      ...(position !== undefined ? { position } : {}),
    });
  };

  const create = () => {
    if (!title.trim()) return;
    void store.hostCommand(hostId, "card.create", { projectId, title: title.trim(), description });
    setTitle("");
    setDescription("");
  };

  return (
    <section className="board">
      <h2>{`Board de ${project?.name ?? ""}`}</h2>
      <div className="row">
        <input
          aria-label="Filtrar cards"
          placeholder="Filtrar"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <input
          aria-label="Título do card"
          placeholder="Título"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <input
          aria-label="Descrição do card"
          placeholder="Descrição"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <button type="button" className="primary" onClick={create}>
          Criar card
        </button>
      </div>
      <div className="columns">
        {COLUMNS.map(({ id, label }) => (
          <section
            key={id}
            aria-label={label}
            className="column"
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => drop(id)}
          >
            <h3>{label}</h3>
            <ul>
              {shown
                .filter((card) => card.column === id)
                .map((card) => (
                  <CardTile
                    key={card.id}
                    card={card}
                    formatTime={(iso) => store.formatTime(iso)}
                    onOpen={() => props.onOpenCard(card.id)}
                    onDragStart={() => {
                      dragging.current = card.id;
                    }}
                    onDropOn={() => drop(id, card.id)}
                  />
                ))}
            </ul>
          </section>
        ))}
      </div>
    </section>
  );
}
