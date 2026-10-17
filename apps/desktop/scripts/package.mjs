import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build, Platform } from "electron-builder";

const appDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(appDirectory, "../..");
const operatingSystem = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : "linux";
const extension = process.platform === "win32" ? ".exe" : "";
const configuration = process.env.CMAKE_BUILD_TYPE === "Debug" ? "Debug" : "Release";
const preset = `${operatingSystem}-${configuration.toLowerCase()}`;
const executable = `sir-kevin-audio-engine${extension}`;
const enginePath = path.join(repositoryRoot, "engine", "build", preset, "bin", ...(process.platform === "win32" ? [configuration] : []), executable);

if (!fs.existsSync(enginePath)) {
  throw new Error(`Native audio engine not found at ${enginePath}. Build it with the ${preset} CMake preset first.`);
}

await build({
  targets: Platform.current().createTarget(),
  config: {
    appId: "com.sirkevin.virtualdj.native",
    productName: "SIR. KEVIN VIRTUAL DJ (Native Engine Preview)",
    directories: {
      app: appDirectory,
      output: path.join(repositoryRoot, "dist", "native-app")
    },
    files: [
      "dist/renderer/**/*",
      "dist/electron/**/*.cjs",
      "package.json"
    ],
    extraResources: [{ from: enginePath, to: path.join("engine", executable) }],
    win: { target: ["nsis"] },
    nsis: {
      oneClick: false,
      perMachine: false,
      allowToChangeInstallationDirectory: true,
      createDesktopShortcut: true,
      createStartMenuShortcut: true,
      shortcutName: "SIR. KEVIN VIRTUAL DJ (Native Engine Preview)"
    }
  }
});
