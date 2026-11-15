const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ascend", {
  desktop: true,
  hideQuick: () => ipcRenderer.send("quick:hide"),
  chooseFolder: (defaultPath) => ipcRenderer.invoke("dialog:folder", defaultPath),
  syncCalendar: () => ipcRenderer.invoke("calendar:sync"),
});
