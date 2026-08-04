// Web-build shim: `fs` exists so the modules that import it load in the
// browser extension host. Nothing may actually call it there - the web entry
// feeds the snapshot through vscode.workspace.fs instead.
const fail = (name) => () => {
  throw new Error(`fs.${name} is not available in the web build`);
};
module.exports = {
  readFileSync: fail("readFileSync"),
  existsSync: () => false,
  writeFileSync: fail("writeFileSync"),
  mkdtempSync: fail("mkdtempSync"),
  rmSync: fail("rmSync"),
};
