const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ascend", {
  desktop: true,
  hideQuick: () => ipcRenderer.send("quick:hide"),
});
