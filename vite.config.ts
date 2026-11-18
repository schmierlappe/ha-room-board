import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { transform } from "esbuild";
import { defineConfig, type Plugin } from "vite";
import solid from "vite-plugin-solid";

/* The widgets import their stylesheets for the side effect. Inside a card the
   CSS has to go into the card's shadow root, so each import becomes a call
   that hands the text to src/ha/css.ts. */
function cssIntoCard(): Plugin {
  const prefix = "\0card-css:";
  const registry = resolve(__dirname, "src/ha/css.ts");
  return {
    name: "css-into-card",
    enforce: "pre",
    async resolveId(source, importer) {
      if (!importer || !source.endsWith(".css")) return null;
      const found = await this.resolve(source, importer, { skipSelf: true });
      /* Not ending in .css, or Vite's own CSS handling would take it. */
      return found ? `${prefix}${found.id}.js` : null;
    },
    async load(id) {
      if (!id.startsWith(prefix)) return null;
      const file = id.slice(prefix.length, -".js".length);
      this.addWatchFile(file);
      const { code: css } = await transform(readFileSync(file, "utf8"), { loader: "css", minify: true });
      return `import { addCss } from ${JSON.stringify(registry)};\naddCss(${JSON.stringify(css)});`;
    },
  };
}

/* A card is loaded as it is, not bundled again, so it is minified in full:
   Vite leaves the whitespace of an ES library build alone. */
function minifyCard(): Plugin {
  return {
    name: "minify-card",
    apply: "build",
    async renderChunk(code) {
      const out = await transform(code, { minify: true, format: "esm", target: "es2022" });
      return { code: out.code, map: null };
    },
  };
}

export default defineConfig({
  resolve: {
    alias: { "@glasshome/widget-sdk": resolve(__dirname, "src/ha/sdk.tsx") },
  },
  plugins: [cssIntoCard(), solid({ solid: { delegateEvents: false } }), minifyCard()],
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, "src/card.tsx"),
      formats: ["es"],
      fileName: () => "room-board-card.js",
    },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
