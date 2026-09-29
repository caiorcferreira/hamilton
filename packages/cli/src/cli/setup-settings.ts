import * as Yaml from "yaml";

export function buildSettingsYaml(
  modelAliases?: Record<string, string>,
): string {
  const doc = new Yaml.Document();
  doc.contents = {
    extensions: [
      { name: "rtk", enabled: true },
      { name: "lsp", enabled: true },
      { name: "git", enabled: true },
    ],
    lsp: {
      servers: {
        biome: {
          command: ["biome", "lsp-proxy"],
          extensions: [
            ".astro",
            ".css",
            ".ts",
            ".tsx",
            ".js",
            ".jsx",
            ".json",
            ".jsonc",
            ".html",
            ".vue",
            ".mjs",
            ".mts",
            ".cjs",
            ".cts",
          ],
        },
        ruff: {
          command: ["ruff", "server"],
          extensions: [".py", ".pyi"],
        },
        typescript: {
          command: ["typescript-language-server", "--stdio"],
          extensions: [
            ".ts",
            ".tsx",
            ".js",
            ".jsx",
            ".mjs",
            ".cjs",
            ".mts",
            ".cts",
          ],
        },
        python: {
          command: ["pylsp"],
          extensions: [".py", ".pyi"],
        },
        yaml: {
          command: ["yaml-language-server", "--stdio"],
          extensions: [".yaml", ".yml"],
        },
        go: {
          command: ["gopls", "serve"],
          extensions: [".go"],
        },
      },
    },
  } as any;
  (doc.contents as any).telemetry = { disableStores: [] };
  (doc.contents as any).script = { maxOutputBytes: 65536 };
  if (modelAliases && Object.keys(modelAliases).length > 0) {
    (doc.contents as any).models = { aliases: modelAliases };
  }
  return String(doc);
}
