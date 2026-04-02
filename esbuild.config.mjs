import esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const ctx = await esbuild.context({
  entryPoints: ["src/main.js"],
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node18",
  outfile: "main.js",
  external: ["obsidian", "electron", "@codemirror/*"],
  logLevel: "info",
  banner: {
    js: '"use strict";',
  },
});

if (watch) {
  await ctx.watch();
  console.log("Watching src/ for changes...");
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
