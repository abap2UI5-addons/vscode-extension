const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

/** The data the bundled view checker reads at runtime ships next to the
 *  bundle: the UI5 metadata snapshot for the property gate, and the typed
 *  builder's method -> control mapping for the reconstruction. */
function copyData() {
  const data = path.join(
    path.dirname(require.resolve("@abap2ui5/linter/properties")),
    "..",
    "data"
  );
  fs.mkdirSync("dist", { recursive: true });
  for (const file of ["properties.json", "xml-view.json"]) {
    fs.copyFileSync(path.join(data, file), path.join("dist", file));
  }
}

async function main() {
  copyData();
  const ctx = await esbuild.context({
    entryPoints: ["src/extension.ts"],
    bundle: true,
    format: "cjs",
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: "node",
    outfile: "dist/extension.js",
    // vscode is provided by the runtime, it must not be bundled.
    external: ["vscode"],
    // The bundled @abap2ui5/linter modules use import.meta.url, which
    // does not exist in a CJS bundle - substitute a __filename-based URL.
    define: { "import.meta.url": "import_meta_url" },
    inject: ["scripts/import-meta-url-shim.mjs"],
    logLevel: "info",
  });

  if (watch) {
    await ctx.watch();
    console.log("[watch] esbuild is watching for changes...");
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
