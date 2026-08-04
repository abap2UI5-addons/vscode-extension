// Web-build shim: the linter only uses fileURLToPath on import.meta.url to
// compute a default path the web entry never reads from.
module.exports = {
  fileURLToPath: (u) => String(u).replace(/^file:\/\//, ""),
  pathToFileURL: (p) => ({ href: "file://" + String(p) }),
};
