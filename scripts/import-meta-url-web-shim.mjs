// esbuild inject shim for the WEB bundle: import.meta.url without require()
// or __filename - the value only feeds path math nothing ever reads.
export const import_meta_url = "file:///web/extension.js";
