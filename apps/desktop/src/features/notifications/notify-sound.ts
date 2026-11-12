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

/** A short tone: the system default, made in the app so it needs no file and no host. */
function tone(volume: number, deps: SoundDeps): void {
  const context = deps.audioContext?.();
  if (!context) return;
  const gain = context.createGain();
  gain.gain.value = volume;
  gain.connect(context.destination);
  const osc = context.createOscillator();
  osc.frequency.value = 880;
  osc.connect(gain);
  osc.start(context.currentTime);
  osc.stop(context.currentTime + 0.18);
}

/** Plays the notification sound from the app (never from a host): a short tone, or the chosen file. */
export function playNotifySound(sound: SoundPrefs, file: string | null, deps: SoundDeps): void {
  if (sound.mode === "off") return;
  try {
    if (sound.mode === "file" && file && deps.audio) {
      const audio = deps.audio(file);
      audio.volume = sound.volume;
      // A browser may refuse to play before the person has touched the page: that is not an error.
      void Promise.resolve(audio.play()).catch(() => {});
    } else tone(sound.volume, deps);
  } catch {
    // No audio device, or the browser refused: the notification itself still went out.
  }
}

/** The browser's own audio, when there is one. */
export function browserSound(): SoundDeps {
  const w = globalThis as unknown as {
    AudioContext?: new () => ReturnType<NonNullable<SoundDeps["audioContext"]>>;
    Audio?: new (url: string) => { volume: number; play(): Promise<void> | void };
  };
  let context: ReturnType<NonNullable<SoundDeps["audioContext"]>> | undefined;
  return {
    ...(w.AudioContext
      ? {
          audioContext: () => {
            const Ctor = w.AudioContext as NonNullable<typeof w.AudioContext>;
            context ??= new Ctor();
            return context;
          },
        }
      : {}),
    ...(w.Audio
      ? { audio: (url: string) => new (w.Audio as NonNullable<typeof w.Audio>)(url) }
      : {}),
  };
}
