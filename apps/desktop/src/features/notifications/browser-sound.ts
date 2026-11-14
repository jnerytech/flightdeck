import type { SoundDeps } from "./domain/notify-sound.ts";

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
