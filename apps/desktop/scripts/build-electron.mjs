import { build } from "esbuild";

await build({
  entryPoints: {
    main: "src/main/main.ts",
    preload: "src/preload/preload.ts"
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron"],
  outdir: "dist/electron",
  entryNames: "[name]",
  outExtension: { ".js": ".cjs" },
  sourcemap: true
});
