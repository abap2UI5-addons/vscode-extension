// esbuild inject shim: makes `import.meta.url` valid inside the CJS bundle
// (used by the bundled @abap2ui5/view-check modules at load time).
export const import_meta_url = require("url").pathToFileURL(__filename).href;
