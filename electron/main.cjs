/**
 * ASCEND desktop shell.
 *
 * Starts the bundled Next.js server on a private local port, shows it in a
 * window, and adds a menu-bar icon (timer, one-click logging) and a global
 * quick-entry shortcut. All data lives in ~/Library/Application Support/ASCEND.
 */
const { app, BrowserWindow, Menu, Notification, Tray, dialog, globalShortcut, ipcMain, nativeImage, screen, shell, utilityProcess } = require("electron");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

const SHORTCUT = "Alt+Shift+L";
const DEV_URL = process.env.ASCEND_DEV_URL || null;

let baseUrl = DEV_URL;
let server = null;
let mainWindow = null;
let quickWindow = null;
let tray = null;
let quitting = false;
let trayState = { timer: null, tiles: [] };
let titleTicker = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => showMain());
}

// ------------------------------------------------------------------ server ---

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(
      `${baseUrl}${urlPath}`,
      { method, headers: data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {} },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, json: raw ? JSON.parse(raw) : null });
          } catch {
            resolve({ status: res.statusCode, json: null });
          }
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(30000, () => req.destroy(new Error("timeout")));
    if (data) req.write(data);
    req.end();
  });
}

async function waitForServer(timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await request("GET", "/api/health");
      if (r.status === 200) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("The ASCEND server did not start in time.");
}

async function startServer() {
  if (DEV_URL) return;
  const resources = process.resourcesPath;
  const serverJs = path.join(resources, "server", "server.js");
  const dataDir = app.getPath("userData");
  const startingRecord = path.join(resources, "starting-record.json");
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  server = utilityProcess.fork(serverJs, [], {
    serviceName: "ASCEND server",
    stdio: "pipe",
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      ASCEND_DESKTOP: "1",
      ASCEND_DATA_DIR: dataDir,
      ASCEND_MIGRATIONS_DIR: path.join(resources, "drizzle"),
      ...(fs.existsSync(startingRecord) ? { ASCEND_STARTING_RECORD: startingRecord } : {}),
      NEXT_TELEMETRY_DISABLED: "1",
    },
  });
  const log = fs.createWriteStream(path.join(dataDir, "server.log"), { flags: "a" });
  server.stdout?.pipe(log);
  server.stderr?.pipe(log);
  server.on("exit", (code) => {
    if (!quitting) {
      dialog.showErrorBox("ASCEND stopped", `The ASCEND server exited (code ${code}). Details are in ${path.join(dataDir, "server.log")}.`);
      app.quit();
    }
  });
  await waitForServer();
}

// ----------------------------------------------------------------- windows ---

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 980,
    minHeight: 640,
    title: "ASCEND",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 14 },
    backgroundColor: "#0e1014",
    show: false,
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true },
  });
  mainWindow.loadURL(baseUrl);
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("close", (e) => {
    if (!quitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(baseUrl)) shell.openExternal(url);
    return { action: "deny" };
  });
}

function showMain() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function refreshMain() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.reloadIgnoringCache();
}

function createQuickWindow() {
  quickWindow = new BrowserWindow({
    width: 640,
    height: 132,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    show: false,
    skipTaskbar: true,
    fullscreenable: false,
    backgroundColor: "#151821",
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true },
  });
  quickWindow.on("blur", () => quickWindow.hide());
  quickWindow.on("close", (e) => {
    if (!quitting) {
      e.preventDefault();
      quickWindow.hide();
    }
  });
}

function toggleQuick() {
  if (!quickWindow) return;
  if (quickWindow.isVisible()) return quickWindow.hide();
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const { x, y, width } = display.workArea;
  quickWindow.setPosition(Math.round(x + (width - 640) / 2), Math.round(y + 160));
  quickWindow.loadURL(`${baseUrl}/quick`);
  quickWindow.once("ready-to-show", () => {
    quickWindow.show();
    quickWindow.focus();
  });
}

ipcMain.on("quick:hide", () => {
  quickWindow?.hide();
  refreshMain();
  refreshTray();
});

// -------------------------------------------------------------------- tray ---

function elapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

function updateTrayTitle() {
  if (!tray) return;
  const t = trayState.timer;
  tray.setTitle(t ? ` ${elapsed(Date.now() - t.startedAt)}` : "");
  tray.setToolTip(t ? `ASCEND: ${t.name} running` : "ASCEND");
}

async function refreshTray() {
  try {
    const r = await request("GET", "/api/tray");
    if (r.json) trayState = r.json;
  } catch {
    /* keep the last state */
  }
  updateTrayTitle();
  if (trayState.timer && !titleTicker) titleTicker = setInterval(updateTrayTitle, 1000);
  if (!trayState.timer && titleTicker) {
    clearInterval(titleTicker);
    titleTicker = null;
  }
}

function notify(title, body) {
  if (Notification.isSupported()) new Notification({ title, body, silent: true }).show();
}

async function trayAction(body, successMessage) {
  try {
    let r = await request("POST", "/api/tray", body);
    if (r.json && !r.json.ok && r.json.code === "confirm_long") {
      const answer = await dialog.showMessageBox({
        type: "question",
        buttons: ["Log it", "Cancel"],
        message: "This timer ran for over 4 hours.",
        detail: "Log it anyway? You can edit the duration afterwards.",
      });
      if (answer.response !== 0) return;
      r = await request("POST", "/api/tray", { ...body, confirmLong: true });
    }
    if (!r.json?.ok) {
      dialog.showErrorBox("ASCEND", r.json?.error || "Something went wrong.");
      return;
    }
    const j = r.json;
    if (j.xp !== undefined) {
      const extra = [j.leveledUp ? `Level ${j.level}!` : null, ...(j.completed || []).map((q) => `Completed: ${q}`)].filter(Boolean).join(" · ");
      notify(`${j.name}: +${j.xp} XP`, extra || "Logged");
    } else if (successMessage) notify("ASCEND", successMessage);
  } catch (e) {
    dialog.showErrorBox("ASCEND", String(e));
  }
  await refreshTray();
  refreshMain();
}

function buildTrayMenu() {
  const t = trayState.timer;
  const tiles = trayState.tiles || [];
  const items = [];
  if (t) {
    items.push({ label: `${t.name}: ${elapsed(Date.now() - t.startedAt)}`, enabled: false });
    items.push({ label: "Stop and log", click: () => trayAction({ action: "stop" }) });
    items.push({ label: "Cancel timer", click: () => trayAction({ action: "cancel" }, "Timer cancelled") });
    items.push({ type: "separator" });
  }
  items.push({ label: "Log now", enabled: false });
  for (const tile of tiles) {
    items.push({ label: `${tile.name}  ·  ${tile.durationMin} min`, click: () => trayAction({ action: "log", templateId: tile.id, requestId: crypto.randomUUID() }) });
  }
  if (!t) {
    items.push({
      label: "Start a timer",
      submenu: tiles.map((tile) => ({ label: tile.name, click: () => trayAction({ action: "start", templateId: tile.id }, `Timer started: ${tile.name}`) })),
    });
  }
  items.push({ type: "separator" });
  items.push({ label: "Quick entry…", accelerator: SHORTCUT, click: toggleQuick });
  items.push({ label: "Open ASCEND", click: showMain });
  items.push({
    label: "Open at login",
    type: "checkbox",
    checked: app.getLoginItemSettings().openAtLogin,
    click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
  });
  items.push({ type: "separator" });
  items.push({ label: "Quit ASCEND", accelerator: "Command+Q", click: () => app.quit() });
  return Menu.buildFromTemplate(items);
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, "assets", "trayTemplate.png"));
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip("ASCEND");
  const open = async () => {
    await refreshTray();
    tray.popUpContextMenu(buildTrayMenu());
  };
  tray.on("click", open);
  tray.on("right-click", open);
  setInterval(refreshTray, 15000);
  refreshTray();
}

// --------------------------------------------------------------- lifecycle ---

app.setName("ASCEND");

app.whenReady().then(async () => {
  try {
    await startServer();
  } catch (e) {
    dialog.showErrorBox("ASCEND couldn't start", String(e));
    app.quit();
    return;
  }
  createMainWindow();
  createQuickWindow();
  createTray();
  if (!globalShortcut.register(SHORTCUT, toggleQuick)) {
    console.warn(`Could not register ${SHORTCUT}; another app may be using it.`);
  }
});

app.on("activate", showMain);
app.on("before-quit", () => {
  quitting = true;
});
app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  if (server) server.kill();
});
app.on("window-all-closed", (e) => e.preventDefault());
