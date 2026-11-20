// The one launcher of the npm tarball (#3541). `fd.js` and `flightdeckd.js` call `main` with their
// own name, because npm's Windows shims run `node <file>` and so `argv[1]` cannot tell the two apart.
// Plain Node, nothing imported from the repository: it runs on the person's machine.
const { spawn } = require("node:child_process");
const os = require("node:os");
const path = require("node:path");

/** The binary file of each `<platform>-<arch>` the tarball carries, next to this file. */
const BINARIES = {
  "linux-x64": "flightdeckd-linux-x64",
  "linux-arm64": "flightdeckd-linux-arm64",
  "win32-x64": "flightdeckd-windows-x64.exe",
};

function binaryFor(platform, arch) {
  const key = `${platform}-${arch}`;
  return Object.hasOwn(BINARIES, key) ? BINARIES[key] : null;
}

/** The binary's exit code, or 128 plus the number of the signal that ended it. */
function exitCodeOf(code, signal) {
  if (typeof code === "number") return code;
  const number = signal ? os.constants.signals[signal] : undefined;
  return number === undefined ? 1 : 128 + number;
}

/**
 * Runs the binary of this platform with the person's arguments. The binary path comes from the
 * package folder and the table above, never from the arguments or the environment, and there is no
 * shell: each argument reaches the binary as one argument.
 */
function launch(name, deps) {
  const file = binaryFor(deps.platform, deps.arch);
  if (file === null) {
    const supported = Object.keys(BINARIES).join(", ");
    deps.stderr(
      `flightdeckd: no binary for ${deps.platform}-${deps.arch} (supported: ${supported})`,
    );
    deps.exit(1);
    return;
  }
  const target = path.join(deps.dir, file);
  // `fd <subcommand>` is `flightdeckd <subcommand>`: the binary reads the word `fd` as its alias.
  const args = name === "fd" ? ["fd", ...deps.argv] : deps.argv;
  const child = deps.spawn(target, args, { stdio: "inherit" });
  // The terminal sends Ctrl-C to the binary too, so the launcher only has to stay alive; a stop sent
  // to the launcher alone is passed on, so a plain `kill` still ends the command.
  deps.trap("SIGINT", () => undefined);
  deps.trap("SIGTERM", () => child.kill("SIGTERM"));
  child.on("error", (error) => {
    deps.stderr(`flightdeckd: cannot run ${target}: ${error.message}`);
    deps.exit(1);
  });
  child.on("exit", (code, signal) => deps.exit(exitCodeOf(code, signal)));
}

function main(name) {
  launch(name, {
    dir: __dirname,
    platform: process.platform,
    arch: process.arch,
    argv: process.argv.slice(2),
    spawn,
    stderr: (line) => process.stderr.write(`${line}\n`),
    exit: (code) => process.exit(code),
    trap: (signal, handler) => process.on(signal, handler),
  });
}

module.exports = { BINARIES, binaryFor, exitCodeOf, launch, main };
