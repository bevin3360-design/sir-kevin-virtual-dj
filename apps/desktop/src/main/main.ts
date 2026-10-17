import { app, BrowserWindow, dialog, ipcMain } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  isDeckIdValue,
  parseEngineCommand,
  type EngineCommand,
  type LibraryTrack
} from "../../../../packages/shared/src/protocol";
import { EngineManager } from "./engine-manager";

const currentDirectory = __dirname;
const engine = new EngineManager();
const audioExtensions = new Set([".aiff", ".aif", ".flac", ".mp3", ".ogg", ".wav"]);
let mainWindow: BrowserWindow | null = null;

function getLibraryFilePath(): string {
  return path.join(app.getPath("userData"), "native-library.json");
}

async function readLibraryTracks(): Promise<LibraryTrack[]> {
  let contents: string;
  try {
    contents = await fs.readFile(getLibraryFilePath(), "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
  const parsed: unknown = JSON.parse(contents);
  if (
    !Array.isArray(parsed) ||
    !parsed.every((track) =>
      typeof track === "object" &&
      track !== null &&
      typeof track.path === "string" &&
      typeof track.title === "string" &&
      typeof track.artist === "string" &&
      typeof track.extension === "string"
    )
  ) {
    throw new Error("The local music library file is invalid. Move native-library.json out of the app data folder and add your music folder again.");
  }
  return parsed;
}

async function writeLibraryTracks(tracks: LibraryTrack[]): Promise<void> {
  const filePath = getLibraryFilePath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  await fs.writeFile(temporaryPath, JSON.stringify(tracks), "utf8");
  await fs.rename(temporaryPath, filePath);
}

async function scanAudioFolder(folderPath: string): Promise<LibraryTrack[]> {
  const tracks: LibraryTrack[] = [];
  const pendingFolders = [folderPath];
  const maximumFiles = 100_000;
  let visitedEntries = 0;

  while (pendingFolders.length > 0) {
    const currentFolder = pendingFolders.pop()!;
    const entries = await fs.readdir(currentFolder, { withFileTypes: true });
    for (const entry of entries) {
      if (++visitedEntries > maximumFiles) {
        throw new Error(`Folder scan stopped after ${maximumFiles.toLocaleString()} entries to keep the app responsive.`);
      }
      const entryPath = path.join(currentFolder, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith(".")) {
        pendingFolders.push(entryPath);
      } else if (entry.isFile() && audioExtensions.has(path.extname(entry.name).toLowerCase())) {
        const fileName = path.basename(entry.name, path.extname(entry.name));
        const separator = fileName.indexOf(" - ");
        tracks.push({
          path: entryPath,
          artist: separator > 0 ? fileName.slice(0, separator).trim() : "",
          title: separator > 0 ? fileName.slice(separator + 3).trim() : fileName,
          extension: path.extname(entry.name).slice(1).toUpperCase()
        });
      }
    }
  }
  return tracks;
}

function isTrustedRenderer(sender: Electron.WebContents, senderUrl: string): boolean {
  if (!mainWindow || sender !== mainWindow.webContents) return false;
  try {
    const url = new URL(senderUrl);
    if (process.env.SKVDJ_RENDERER_URL) return url.origin === new URL(process.env.SKVDJ_RENDERER_URL).origin;
    return url.protocol === "file:" &&
      path.resolve(fileURLToPath(url)) === path.resolve(app.getAppPath(), "dist", "renderer", "index.html");
  } catch {
    return false;
  }
}

function assertTrustedSender(event: Electron.IpcMainInvokeEvent): void {
  if (!isTrustedRenderer(event.sender, event.senderFrame?.url ?? "")) {
    throw new Error("Rejected IPC request from an untrusted renderer.");
  }
}

function publishToRenderer(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function registerIpcHandlers(): void {
  ipcMain.handle("engine:get-status", (event) => {
    assertTrustedSender(event);
    return engine.getStatus();
  });
  ipcMain.handle("engine:retry", async (event) => {
    assertTrustedSender(event);
    try {
      await engine.start();
      return engine.getStatus();
    } catch {
      return engine.getStatus();
    }
  });
  ipcMain.handle("engine:send-command", async (event, payload: unknown) => {
    assertTrustedSender(event);
    const command = parseEngineCommand(payload);
    if (command.type === "deck.load") throw new Error("Use the audio-file picker to load tracks.");
    return engine.send(command);
  });
  ipcMain.handle("engine:choose-track", async (event, deckId: unknown) => {
    assertTrustedSender(event);
    if (!isDeckIdValue(deckId)) throw new Error("Invalid deck ID.");
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: `Load track into ${deckId.toUpperCase()}`,
      properties: ["openFile"],
      filters: [{
        name: "Audio files",
        extensions: ["aiff", "aif", "flac", "mp3", "ogg", "wav"]
      }]
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const command: EngineCommand = { type: "deck.load", deckId, path: result.filePaths[0] };
    await engine.send(command);
    return path.basename(result.filePaths[0]);
  });
  ipcMain.handle("library:get-tracks", async (event) => {
    assertTrustedSender(event);
    return readLibraryTracks();
  });
  ipcMain.handle("library:add-folder", async (event) => {
    assertTrustedSender(event);
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: "Add a music folder to the local library",
      properties: ["openDirectory"]
    });
    if (result.canceled || result.filePaths.length === 0) return readLibraryTracks();
    const [existing, discovered] = await Promise.all([
      readLibraryTracks(),
      scanAudioFolder(result.filePaths[0])
    ]);
    const tracksByPath = new Map(existing.map((track) => [path.resolve(track.path).toLowerCase(), track]));
    for (const track of discovered)
      tracksByPath.set(path.resolve(track.path).toLowerCase(), track);
    const tracks = [...tracksByPath.values()].sort((left, right) =>
      left.artist.localeCompare(right.artist) || left.title.localeCompare(right.title)
    );
    await writeLibraryTracks(tracks);
    return tracks;
  });
  ipcMain.handle("library:load-track", async (event, deckId: unknown, trackPath: unknown) => {
    assertTrustedSender(event);
    if (!isDeckIdValue(deckId) || typeof trackPath !== "string" || trackPath.length > 32_768)
      throw new Error("Invalid library track selection.");
    const tracks = await readLibraryTracks();
    const selected = tracks.find((track) => path.resolve(track.path).toLowerCase() === path.resolve(trackPath).toLowerCase());
    if (!selected) throw new Error("That file is not in the local music library. Add its folder again and retry.");
    await engine.send({ type: "deck.load", deckId, path: selected.path });
  });
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 980,
    minWidth: 720,
    minHeight: 700,
    backgroundColor: "#080c14",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(currentDirectory, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, targetUrl) => {
    if (!isTrustedRenderer(mainWindow!.webContents, targetUrl)) event.preventDefault();
  });

  if (process.env.SKVDJ_RENDERER_URL) {
    await mainWindow.loadURL(process.env.SKVDJ_RENDERER_URL);
  } else {
    await mainWindow.loadFile(path.join(app.getAppPath(), "dist", "renderer", "index.html"));
  }

  mainWindow.on("closed", () => { mainWindow = null; });
}

app.whenReady().then(async () => {
  registerIpcHandlers();
  engine.on("event", (event) => publishToRenderer("engine:event", event));
  engine.on("status", (status) => publishToRenderer("engine:status", status));
  try {
    await engine.start();
    await engine.send({ type: "devices.list" });
  } catch (error) {
    console.error("Native audio engine startup failed:", error);
  }
  await createWindow();
});

app.on("before-quit", () => {
  void engine.shutdown();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});
