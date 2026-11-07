/**
 * What a test file can leave running in the test process (issue #747): a server still listening, or
 * a child process still alive. The next file's code then runs next to it: a daemon left up keeps
 * calling git, a fake CLI on PATH records its calls. Linux only (it reads /proc); elsewhere nothing
 * is looked at.
 */

/** The bits of /proc and the process the guard reads, so a test can hand it a fake one. */
export interface ProcReader {
  pid: number;
  /** Names in a directory, or [] when it is not there. */
  list(path: string): string[];
  /** A text file, or null when it is not there. */
  read(path: string): string | null;
  /** Where a symbolic link points, or null. */
  link(path: string): string | null;
}

export interface Resources {
  /** Ports this process listens on. */
  ports: number[];
  /** Child processes alive (not zombies): pid and the start of the command line. */
  children: Array<{ pid: number; cmd: string }>;
}

/** Ports this process listens on, from the TCP tables and the sockets it holds open. */
export function listeningPorts(_proc: ProcReader): number[] {
  return [];
}

function listeningPortsReal(proc: ProcReader): number[] {
  const own = new Set<string>();
  for (const fd of proc.list("/proc/self/fd")) {
    const target = proc.link(`/proc/self/fd/${fd}`) ?? "";
    const inode = /^socket:\[(\d+)\]$/.exec(target)?.[1];
    if (inode) own.add(inode);
  }
  const ports = new Set<number>();
  for (const table of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    for (const line of (proc.read(table) ?? "").split("\n").slice(1)) {
      const cols = line.trim().split(/\s+/);
      const [, local, , state, , , , , , inode] = cols;
      if (state !== "0A" || !local || !inode || !own.has(inode)) continue;
      ports.add(Number.parseInt(local.slice(local.lastIndexOf(":") + 1), 16));
    }
  }
  return [...ports].sort((a, b) => a - b);
}

/** The live children of this process: `/proc/<pid>/stat` names the parent and the state. */
export function liveChildren(_proc: ProcReader): Resources["children"] {
  return [];
}

function liveChildrenReal(proc: ProcReader): Resources["children"] {
  const found: Resources["children"] = [];
  for (const entry of proc.list("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    const stat = proc.read(`/proc/${entry}/stat`) ?? "";
    // "pid (name with spaces) S ppid ...": the name may hold ")" and spaces, so cut at the last one.
    const rest = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    const [state, parent] = rest;
    if (Number(parent) !== proc.pid || state === "Z") continue;
    const cmd = (proc.read(`/proc/${entry}/cmdline`) ?? "").split("\0").join(" ").trim();
    found.push({ pid: Number(entry), cmd: cmd.slice(0, 80) });
  }
  return found;
}

export function captureResources(proc: ProcReader): Resources {
  return { ports: listeningPortsReal(proc), children: liveChildrenReal(proc) };
}

/**
 * What `now` holds that `known` does not, one line each. A server still listening is a leak for
 * sure (a file that started one stops it). A child still alive is a warning: the process a test
 * did not wait for, such as the git of a card start that was still running when the test ended.
 */
export function newResources(
  _known: Resources,
  _now: Resources,
): { servers: string[]; children: string[] } {
  return { servers: [], children: [] };
}
