import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import { defineConfig, type Plugin } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * ../data/maps.json (照合DB本体) を public/maps.json へコピーするプラグイン。
 * maps.json はリポジトリの正であるルート data/ 側だけを保持し、web/public/maps.json は
 * ビルド成果物としてのみ生成する（.gitignore 対象・コミットしない）。
 */
function copyMapsJson(): Plugin {
  const srcPath = path.resolve(here, "../data/maps.json");
  const destPath = path.resolve(here, "public/maps.json");
  const copy = () => {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.copyFileSync(srcPath, destPath);
  };
  return {
    name: "copy-maps-json",
    buildStart() {
      copy();
    },
    configureServer() {
      copy();
    },
  };
}

export default defineConfig({
  define: {
    __BUILD_ID__: JSON.stringify(
      new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC",
    ),
  },
  base: "./",
  plugins: [copyMapsJson()],
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        main: path.resolve(here, "index.html"),
        desktop: path.resolve(here, "desktop.html"),
      },
    },
  },
});
