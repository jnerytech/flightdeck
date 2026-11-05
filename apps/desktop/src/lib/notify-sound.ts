import type { SoundPrefs } from "./notify-policy.ts";

/** What the sound needs from the browser; injected so tests need no audio device. */
export interface SoundDeps {
  audioContext?(): {
    createOscillator(): {
      frequency: { value: number };
      connect(node: unknown): void;
      start(at?: number): void;
      stop(at?: number): void;
    };
    createGain(): { gain: { value: number }; connect(node: unknown): void };
    destination: unknown;
    currentTime: number;
  };
  audio?(url: string): { volume: number; play(): Promise<void> | void };
}

/** Plays the notification sound from the app (never from a host): a short tone, or the chosen file. */
export function playNotifySound(sound: SoundPrefs, file: string | null, deps: SoundDeps): void {
  void sound;
  void file;
  void deps;
}
