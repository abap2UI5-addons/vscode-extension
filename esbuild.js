const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");
const tests = process.argv.includes("--tests");
const webTests = process.argv.includes("--webtest");

/** The UI5 metadata snapshot of the bundled view checker ships next to the
 *  bundle - the property gate reads it at runtime. */
function copySnapshot() {
  const src = path.join(
    path.dirname(require.resolve("@abap2ui5/linter/properties")),
    "..",
    "data",
    "properties.json"
  );
  fs.mkdirSync("dist", { recursive: true });
  fs.copyFileSync(src, path.join("dist", "properties.json"));
}

/* Shared with the test build: the linter's ESM modules use import.meta.url,
 * which does not exist in a CJS bundle. */
const ESM_IN_CJS = {
  define: { "import.meta.url": "import_meta_url" },
  inject: ["scripts/import-meta-url-shim.mjs"],
};

/**
 * The test bundle. `node --test` runs plain JavaScript, so the TypeScript
 * sources go through the same bundler the extension does - which also means
 * the tests exercise the modules exactly as they are shipped. Only modules
 * that do not import `vscode` can be tested this way, and that is precisely
 * the boundary the pure helpers were extracted along.
 */
async function buildTests() {
  const dir = "src/test";
  const entryPoints = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".test.ts"))
    .map((f) => path.join(dir, f));
  await esbuild.build({
    entryPoints,
    bundle: true,
    format: "cjs",
    platform: "node",
    outdir: "dist-test",
    outExtension: { ".js": ".cjs" },
    sourcemap: true,
    external: ["vscode", "node:test", "node:assert"],
    logLevel: "info",
    ...ESM_IN_CJS,
  });
  // The property-gate tests read the snapshot from next to the bundle.
  fs.copyFileSync(
    path.join("dist", "properties.json"),
    path.join("dist-test", "properties.json")
  );
}

/**
 * The web extension host bundle (vscode.dev, browser-based BAS): the same
 * sources, platform `browser`. The node builtins some modules import at load
 * time (the linter computes a default snapshot path with fs/path/url) are
 * aliased to shims that load fine and are never called - the web entry feeds
 * the snapshot through `vscode.workspace.fs` instead.
 */
function webConfig() {
  return {
    entryPoints: ["src/web/extension.ts"],
    bundle: true,
    format: "cjs",
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: "browser",
    outfile: "dist/web/extension.js",
    external: ["vscode"],
    alias: {
      fs: "./scripts/web-shims/fs.js",
      path: "./scripts/web-shims/path.js",
      url: "./scripts/web-shims/url.js",
    },
    define: {
      "import.meta.url": "import_meta_url",
      // A browser worker has neither; they only feed module-load-time path
      // constants nothing in the web graph ever reads (snapshot.ts resolves
      // its file next to the bundle, but the web entry feeds the snapshot
      // through vscode.workspace.fs instead). Without the define the bare
      // identifier throws at load time - the web smoke test caught exactly
      // that.
      __dirname: '"/web"',
      __filename: '"/web/extension.js"',
    },
    inject: ["scripts/import-meta-url-web-shim.mjs"],
    logLevel: "info",
  };
}

async function main() {
  copySnapshot();
  if (tests) {
    await buildTests();
    return;
  }
  if (webTests) {
    // The suite @vscode/test-web loads inside the browser host - next to
    // the web bundle it exercises.
    await esbuild.build({
      ...webConfig(),
      entryPoints: ["src/web/test/suite.ts"],
      outfile: "dist/web/test.js",
    });
    return;
  }
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
    ...ESM_IN_CJS,
    logLevel: "info",
  });
  const webCtx = await esbuild.context(webConfig());

  if (watch) {
    await ctx.watch();
    await webCtx.watch();
    console.log("[watch] esbuild is watching for changes...");
  } else {
    await ctx.rebuild();
    await webCtx.rebuild();
    await ctx.dispose();
    await webCtx.dispose();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
