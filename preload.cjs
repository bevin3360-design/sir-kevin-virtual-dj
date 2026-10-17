const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("sirKevinSampler", {
  getState: () => ipcRenderer.invoke("sampler:get-state"),
  readSample: (index) => ipcRenderer.invoke("sampler:read-sample", index),
  chooseSample: (index) => ipcRenderer.invoke("sampler:choose-sample", index),
  clearSample: (index) => ipcRenderer.invoke("sampler:clear-sample", index),
  saveSettings: (settings) => ipcRenderer.invoke("sampler:save-settings", settings)
});
