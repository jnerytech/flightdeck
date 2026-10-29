import type { QuotaHistory, QuotaState, QuotaWindow } from "@flightdeck/protocol";

export const WINDOW_LABELS: Record<string, string> = { five_hour: "5 horas", seven_day: "7 dias" };

/** How many hours of samples each window's chart shows. */
export const HISTORY_HOURS: Record<string, number> = { five_hour: 24, seven_day: 168 };

/** "no ritmo atual, a janela de 5 h esgota às 16:00", or why it does not. */
export function projectionText(
  window: string,
  projection: QuotaHistory["projection"],
  formatTime: (iso: string) => string,
): string {
  if (!projection) return "poucas leituras para projetar";
  const label = window === "five_hour" ? "5 h" : (WINDOW_LABELS[window] ?? window);
  if (projection.exhaustsAt) {
    return `no ritmo atual, a janela de ${label} esgota às ${formatTime(projection.exhaustsAt)}`;
  }
  return `não esgota antes de ${formatTime(projection.resetsAt ?? "")}`;
}

/** The two windows the app shows for every host, in order. */
export const SHOWN = ["five_hour", "seven_day"];

export interface QuotaBar {
  window: string;
  label: string;
  /** Fraction from 0 to 1; 0 without a reading. */
  value: number;
  /** At or over `pauseAt` (or rejected): new cards wait. */
  hot: boolean;
  text: string;
}

/** "lida agora", "lida há 12 min", "lida há 3 h". */
export function readingAge(readAt: string, now: number): string {
  const minutes = Math.floor((now - Date.parse(readAt)) / 60_000);
  if (minutes < 1) return "lida agora";
  return minutes < 60 ? `lida há ${minutes} min` : `lida há ${Math.floor(minutes / 60)} h`;
}

/** At or over the host's `pauseAt`, or rejected by the plan. */
export function isHot(window: QuotaWindow, pauseAt: number | null): boolean {
  if (pauseAt === null) return false;
  return window.status === "rejected" || (window.utilization ?? 0) >= pauseAt;
}

/** Percentage, reset time and age of the 5-hour and 7-day windows of a host. */
export function quotaBars(
  quota: QuotaState | undefined,
  now: number,
  formatTime: (iso: string) => string,
): QuotaBar[] {
  return SHOWN.map((window) => {
    const label = WINDOW_LABELS[window] as string;
    const reading = quota?.windows.find((w) => w.window === window);
    if (!reading) return { window, label, value: 0, hot: false, text: `${label}: sem leitura` };
    const parts = [
      `${label}: ${Math.round((reading.utilization ?? 0) * 100)}%`,
      ...(reading.resetsAt ? [`reinicia às ${formatTime(reading.resetsAt)}`] : []),
      readingAge(reading.readAt, now),
    ];
    return {
      window,
      label,
      value: reading.utilization ?? 0,
      hot: isHot(reading, quota?.pauseAt ?? null),
      text: parts.join(" · "),
    };
  });
}
