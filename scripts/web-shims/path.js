// Web-build shim: enough of `path` for module-load-time constants (the
// linter computes its default snapshot path on import). Pure string work.
const join = (...parts) => parts.filter(Boolean).join("/").replace(/\/+/g, "/");
const dirname = (p) => p.replace(/\/[^/]*$/, "") || "/";
const basename = (p) => p.replace(/^.*\//, "");
module.exports = { join, dirname, basename, sep: "/", delimiter: ":" };
