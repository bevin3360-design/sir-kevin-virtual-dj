const { app, BrowserWindow, Menu, shell, dialog, ipcMain } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { fileURLToPath } = require("node:url");

const sampleExtensions = new Set(["aac", "flac", "m4a", "mp3", "oga", "ogg", "wav", "webm"]);
const emptySamplerState = () => ({
  pads: Array.from({ length: 8 }, () => ({ id: null, name: "", extension: "", loop: false, volume: 1 }))
});

function samplerDirectory() {
  return path.join(app.getPath("userData"), "sampler-samples");
}

function samplerStatePath() {
  return path.join(app.getPath("userData"), "sampler-state.json");
}

function validateSender(event) {
  const frameUrl = event.senderFrame?.url;
  if (!frameUrl || path.resolve(fileURLToPath(new URL(frameUrl))) !== path.join(__dirname, "index.html")) {
    throw new Error("Sampler request rejected from an untrusted page.");
  }
}

function validatePadIndex(index) {
  if (!Number.isInteger(index) || index < 0 || index >= 8) {
    throw new Error("Invalid sampler pad.");
  }
}

function validateSampleMetadata(sample) {
  if (!sample || !/^[\da-f-]{36}$/i.test(sample.id) || !sampleExtensions.has(sample.extension)) {
    throw new Error("Invalid saved sampler assignment.");
  }
}

async function readSamplerState() {
  try {
    const text = await fs.readFile(samplerStatePath(), "utf8");
    const state = JSON.parse(text);
    if (!Array.isArray(state.pads) || state.pads.length !== 8) {
      throw new Error("Sampler settings file has an invalid format.");
    }
    return state;
  } catch (error) {
    if (error.code === "ENOENT") return emptySamplerState();
    throw error;
  }
}

async function writeSamplerState(state) {
  await fs.mkdir(app.getPath("userData"), { recursive: true });
  const target = samplerStatePath();
  const temporary = `${target}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(state, null, 2), "utf8");
  await fs.rename(temporary, target);
}

async function removeStoredSample(sample) {
  if (!sample?.id) return;
  validateSampleMetadata(sample);
  await fs.rm(path.join(samplerDirectory(), `${sample.id}.${sample.extension}`), { force: true });
}

ipcMain.handle("sampler:get-state", async (event) => {
  validateSender(event);
  const state = await readSamplerState();
  state.pads.forEach((pad) => { if (pad.id) validateSampleMetadata(pad); });
  return state;
});

ipcMain.handle("sampler:read-sample", async (event, index) => {
  validateSender(event);
  validatePadIndex(index);
  const pad = (await readSamplerState()).pads[index];
  if (!pad.id) return null;
  validateSampleMetadata(pad);
  const data = await fs.readFile(path.join(samplerDirectory(), `${pad.id}.${pad.extension}`));
  return { name: pad.name, data: new Uint8Array(data) };
});

ipcMain.handle("sampler:choose-sample", async (event, index) => {
  validateSender(event);
  validatePadIndex(index);
  const parent = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(parent, {
    title: `Load sample into Pad ${index + 1}`,
    properties: ["openFile"],
    filters: [{ name: "Audio samples", extensions: Array.from(sampleExtensions) }]
  });
  if (result.canceled || result.filePaths.length === 0) return null;

  const sourcePath = result.filePaths[0];
  const extension = path.extname(sourcePath).slice(1).toLowerCase();
  if (!sampleExtensions.has(extension)) throw new Error("Choose a supported audio sample file.");
  const stats = await fs.stat(sourcePath);
  if (!stats.isFile() || stats.size === 0) throw new Error("The selected sample is empty or is not a file.");

  const state = await readSamplerState();
  const previous = state.pads[index];
  const sample = {
    id: randomUUID(),
    name: path.basename(sourcePath),
    extension,
    loop: Boolean(previous.loop),
    volume: Number.isFinite(previous.volume) ? Math.max(0, Math.min(1, previous.volume)) : 1
  };
  await fs.mkdir(samplerDirectory(), { recursive: true });
  await fs.copyFile(sourcePath, path.join(samplerDirectory(), `${sample.id}.${extension}`));
  state.pads[index] = sample;
  try {
    await writeSamplerState(state);
  } catch (error) {
    await removeStoredSample(sample);
    throw error;
  }
  await removeStoredSample(previous);
  return { index, ...sample };
});

ipcMain.handle("sampler:clear-sample", async (event, index) => {
  validateSender(event);
  validatePadIndex(index);
  const state = await readSamplerState();
  const previous = state.pads[index];
  state.pads[index] = { ...previous, id: null, name: "", extension: "" };
  await writeSamplerState(state);
  await removeStoredSample(previous);
});

ipcMain.handle("sampler:save-settings", async (event, settings) => {
  validateSender(event);
  if (!Array.isArray(settings)) throw new Error("Invalid sampler settings.");
  const state = await readSamplerState();
  for (const setting of settings) {
    validatePadIndex(setting.pad);
    if (typeof setting.loop !== "boolean" || !Number.isFinite(setting.volume)) {
      throw new Error("Invalid sampler pad settings.");
    }
    state.pads[setting.pad].loop = setting.loop;
    state.pads[setting.pad].volume = Math.max(0, Math.min(1, setting.volume));
  }
  await writeSamplerState(state);
});

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const [window] = BrowserWindow.getAllWindows();
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });

  function createWindow() {
    const window = new BrowserWindow({
      width: 1440,
      height: 920,
      minWidth: 360,
      minHeight: 640,
      icon: path.join(__dirname, "sir-kevin-icon.ico"),
      backgroundColor: "#080c14",
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });

    window.webContents.setWindowOpenHandler(({ url }) => {
      try {
        if (new URL(url).protocol === "https:") {
          shell.openExternal(url).catch((error) => console.error("Could not open external link:", error));
        } else {
          console.error("Rejected non-HTTPS external link:", url);
        }
      } catch (error) {
        console.error("Rejected invalid external URL:", error);
      }
      return { action: "deny" };
    });
    window.loadFile(path.join(__dirname, "index.html"));
  }

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    app.setAppUserModelId("com.sirkevin.virtualdj");
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
