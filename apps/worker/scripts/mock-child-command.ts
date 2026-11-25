/** Runs a test's CLI fixture through Node, keeping the original argv, stdin, and subprocess options. */
export function mockChildCommand(command: string, fixture: string, nodeScript?: string): string[] {
  const install = `
    import childProcess from "node:child_process";
    import { syncBuiltinESMExports } from "node:module";
    const spawn = childProcess.spawnSync;
    childProcess.spawnSync = (file, args, options) => {
      if (file === ${JSON.stringify(command)}) return spawn(process.execPath, [${JSON.stringify(fixture)}, ...args], options);
      const script = ${JSON.stringify(nodeScript ?? null)};
      if (script && file === process.execPath && args[0]?.replaceAll(String.fromCharCode(92), "/").endsWith(script))
        return spawn(process.execPath, [${JSON.stringify(fixture)}, ...args.slice(1)], options);
      return spawn(file, args, options);
    };
    syncBuiltinESMExports();
  `;
  return ["--import", "data:text/javascript," + encodeURIComponent(install)];
}
