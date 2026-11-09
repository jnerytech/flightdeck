/** The demo's online hosts: the daemons it really starts (the other hosts are fakes that are not online). */
export const DEMO_ONLINE_HOSTS: readonly string[] = ["alfa", "beta", "gama"];

/** What one demo host answers that the others do not, so the Compare hosts table has a majority and an outlier. */
export interface DemoHostSetup {
  /** Whether the service manager says flightdeckd is installed as a service (Start at boot). */
  serviceInstalled: boolean;
}

/**
 * Two hosts agree and the third differs: with only alfa and beta online the table could only tie and
 * mark nothing. alfa keeps the service not installed, since the Start at boot journey reads it there
 * (#1200); gama is the outlier. The answer comes from the host's service manager, so it needs systemd
 * where the demo runs: without it every host reads Off and nothing is marked, but nothing breaks.
 */
export function demoHostSetup(name: string): DemoHostSetup {
  return { serviceInstalled: name === "gama" };
}
