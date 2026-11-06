import solidPlugin from "@opentui/solid/bun-plugin"

const result: Awaited<ReturnType<typeof Bun.build>> = await Bun.build({
  entrypoints: ["src/tui.tsx"],
  outdir: "dist",
  target: "bun",
  format: "esm",
  external: ["@opencode/*", "@opentui/*", "solid-js", "solid-js/*"],
  plugins: [solidPlugin],
})

if (!result.success) throw new AggregateError(result.logs, "TUI build failed")
