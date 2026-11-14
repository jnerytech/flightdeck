import type { SshTestResult } from "@flightdeck/protocol";

/** What ssh printed, in words for the person. */
export function translate(stderr: string, code: number): SshTestResult {
  const failed = (error: string, reason?: string, params?: Record<string, string | number>) => ({
    ok: false,
    error,
    ...(reason ? { reason } : {}),
    ...(params ? { params } : {}),
  });
  if (/Permission denied/i.test(stderr)) return failed("authentication refused", "ssh_test_auth");
  if (/Connection refused/i.test(stderr)) return failed("connection refused", "ssh_test_refused");
  if (/Could not resolve hostname/i.test(stderr)) {
    return failed("host not found", "ssh_test_host_unknown");
  }
  if (/timed out/i.test(stderr)) return failed("timed out", "ssh_test_timeout");
  if (/Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(stderr)) {
    return failed("the server key differs from the saved one", "ssh_test_hostkey");
  }
  const last = stderr.trim().split(/\r?\n/).at(-1) ?? "";
  return last === ""
    ? failed(`ssh exited with code ${code}`, "ssh_test_exit", { code })
    : failed(last.slice(0, 200));
}
