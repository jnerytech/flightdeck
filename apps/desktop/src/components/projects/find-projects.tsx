import type { AppStore } from "@/lib/app-store";

/** "Find my projects": scan the allowed folders for git repositories, or clone one from a URL. */
export function FindProjects(_props: { store: AppStore; hostId: string; onAdded(): void }) {
  return null;
}
