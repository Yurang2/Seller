import { app, BrowserWindow, protocol, ipcMain, shell, dialog, Menu } from "electron";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { createDesktopEnv } from "../src/platform/desktop-env";
import { createDesktopApp, isAppUrl } from "../src/platform/desktop-app";
import { backupOnClose, readBackupState } from "../src/platform/backup";

app.setName("Seller");
app.setPath("userData", join(app.getPath("appData"), "Seller"));
protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
let window: BrowserWindow | undefined;
let closing = false;
let finished = false;
let queue: Promise<unknown> = Promise.resolve();
if (!app.requestSingleInstanceLock()) { app.quit(); }
else {
  app.on("second-instance", () => { window?.restore(); window?.focus(); });
  app.whenReady().then(async () => {
    const dataDirectory = app.getPath("userData");
    const backupDirectory = join(app.getPath("documents"), "Seller 백업");
    const base = app.getAppPath();
    const storage = createDesktopEnv(dataDirectory, join(base, "migrations"));
    const desktopApp = createDesktopApp(join(base, "dist/client"));
    const paths = { database: join(dataDirectory, "seller.sqlite"), attachments: join(dataDirectory, "attachments"), backups: backupDirectory };
    const status = await readBackupState(dataDirectory);
    const trusted = (event: Electron.IpcMainInvokeEvent) => {
      if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame || !isAppUrl(event.senderFrame.url))
        throw new Error("Untrusted desktop caller");
    };
    ipcMain.handle("seller:info", event => { trusted(event); return { paths, backupError: status.error ?? null, lastBackup: status.lastFile ?? null }; });
    ipcMain.handle("seller:open-folder", async (event, key: unknown) => {
      trusted(event);
      if (key !== "database" && key !== "attachments" && key !== "backups") throw new Error("Invalid folder");
      const dir = key === "database" ? dataDirectory : paths[key];
      await mkdir(dir, { recursive: true });
      const error = await shell.openPath(dir);
      if (error) throw new Error(error);
    });
    ipcMain.handle("seller:releases", event => { trusted(event); return shell.openExternal("https://github.com/Yurang2/Seller/releases"); });
    protocol.handle("app", request => {
      if (closing) return new Response("App is closing", { status: 503 });
      const response = queue.then(() => desktopApp.fetch(request, storage.env));
      queue = response.catch(() => undefined);
      return response;
    });
    Menu.setApplicationMenu(null);
    window = new BrowserWindow({ width: 1440, height: 960, minWidth: 800, minHeight: 600, show: false, title: "Seller", webPreferences: {
      preload: join(base, "dist/desktop/preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true,
    } });
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//.test(url)) void shell.openExternal(url);
      return { action: "deny" };
    });
    window.webContents.on("will-navigate", (event, url) => {
      if (!isAppUrl(url)) { event.preventDefault(); if (/^https?:\/\//.test(url)) void shell.openExternal(url); }
    });
    window.webContents.on("will-attach-webview", event => event.preventDefault());
    window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    window.webContents.session.setPermissionCheckHandler(() => false);
    window.on("close", event => { if (!finished) { event.preventDefault(); app.quit(); } });
    app.on("before-quit", event => {
      if (finished) return;
      event.preventDefault();
      if (closing) return;
      closing = true;
      void (async () => {
        try { await queue; await backupOnClose(storage.env, dataDirectory, backupDirectory); }
        catch (error) { console.error("Shutdown backup failed", error); }
        finally { storage.close(); finished = true; app.quit(); }
      })();
    });
    window.once("ready-to-show", () => window?.show());
    await window.loadURL("app://seller/");
  }).catch(error => {
    dialog.showErrorBox("Seller를 시작하지 못했습니다", String(error));
    finished = true; app.quit();
  });
}
