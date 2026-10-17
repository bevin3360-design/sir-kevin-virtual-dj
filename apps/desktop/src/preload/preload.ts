import { contextBridge, ipcRenderer } from "electron";
import type {
  DeckId,
  EngineCommand,
  EngineEvent,
  EngineStatus,
  LibraryTrack
} from "../../../../packages/shared/src/protocol";

const audioEngineApi = {
  getStatus: (): Promise<EngineStatus> => ipcRenderer.invoke("engine:get-status"),
  retry: (): Promise<EngineStatus> => ipcRenderer.invoke("engine:retry"),
  sendCommand: (command: EngineCommand): Promise<EngineEvent> =>
    ipcRenderer.invoke("engine:send-command", command),
  chooseTrack: (deckId: DeckId): Promise<string | null> =>
    ipcRenderer.invoke("engine:choose-track", deckId),
  getLibraryTracks: (): Promise<LibraryTrack[]> => ipcRenderer.invoke("library:get-tracks"),
  addLibraryFolder: (): Promise<LibraryTrack[]> => ipcRenderer.invoke("library:add-folder"),
  loadLibraryTrack: (deckId: DeckId, trackPath: string): Promise<void> =>
    ipcRenderer.invoke("library:load-track", deckId, trackPath),
  onEvent: (callback: (event: EngineEvent) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: EngineEvent) => callback(payload);
    ipcRenderer.on("engine:event", listener);
    return () => ipcRenderer.removeListener("engine:event", listener);
  },
  onStatus: (callback: (status: EngineStatus) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: EngineStatus) => callback(payload);
    ipcRenderer.on("engine:status", listener);
    return () => ipcRenderer.removeListener("engine:status", listener);
  }
};

contextBridge.exposeInMainWorld("sirKevinAudioEngine", audioEngineApi);
