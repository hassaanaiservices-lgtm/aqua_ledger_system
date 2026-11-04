const { app, BrowserWindow, Menu, shell, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const { pathToFileURL } = require('node:url');

let mainWindow = null;

// Ensure single instance lock so two apps don't collide on DB or ports
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// Set up persistent data directory outside volatile OS paths on Windows
const userDataDir = app.getPath('userData');
const configFile = path.join(userDataDir, 'config.json');

function saveConfig(data) {
  try {
    let current = {};
    if (fs.existsSync(configFile)) {
      current = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    }
    fs.writeFileSync(configFile, JSON.stringify({ ...current, ...data }, null, 2));
  } catch (e) {
    console.error('Failed to save config:', e);
  }
}

function resolveSafeDataDir() {
  // 1. Check if user specified a path in config
  if (fs.existsSync(configFile)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(configFile, 'utf8'));
      if (cfg.dataDir && fs.existsSync(cfg.dataDir)) {
        return cfg.dataDir;
      }
    } catch {}
  }

  // 2. On Windows, auto-detect persistent locations that survive OS format/reinstalls
  if (process.platform === 'win32') {
    const candidates = ['D:\\AquaHomeData', 'E:\\AquaHomeData', 'C:\\AquaHomeData'];
    // Auto-recovery: if business.db already exists in any candidate, reconnect immediately!
    for (const c of candidates) {
      if (fs.existsSync(path.join(c, 'business.db'))) {
        console.log('Reconnected to existing database at:', c);
        saveConfig({ dataDir: c });
        return c;
      }
    }
    // Otherwise select the safest available partition (prefer non-system drive D: / E:)
    for (const c of candidates) {
      const driveRoot = path.parse(c).root;
      if (fs.existsSync(driveRoot)) {
        try {
          fs.mkdirSync(c, { recursive: true });
          saveConfig({ dataDir: c });
          console.log('Initialized safe data directory at:', c);
          return c;
        } catch {}
      }
    }
  }

  // Fallback for Linux/macOS or restricted permissions
  const fallback = path.join(userDataDir, 'data');
  if (!fs.existsSync(fallback)) {
    fs.mkdirSync(fallback, { recursive: true });
  }
  return fallback;
}

const appDataDir = resolveSafeDataDir();

// Copy initial database template on first launch if not present
const targetDbPath = path.join(appDataDir, 'business.db');
if (!fs.existsSync(targetDbPath)) {
  const defaultDbPath = app.isPackaged
    ? path.join(process.resourcesPath, 'data', 'business.db')
    : path.join(__dirname, '..', 'data', 'business.db');

  if (fs.existsSync(defaultDbPath)) {
    try {
      fs.copyFileSync(defaultDbPath, targetDbPath);
      console.log('Seeded initial database to:', targetDbPath);
    } catch (err) {
      console.error('Failed to copy initial DB:', err);
    }
  }
}

// Daily automatic rotating 30-day backup routine
function performDailyBackup() {
  try {
    const backupDir = path.join(appDataDir, 'backups');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const backupFile = path.join(backupDir, `business-backup-${dateStr}.db`);
    if (!fs.existsSync(backupFile) && fs.existsSync(targetDbPath)) {
      fs.copyFileSync(targetDbPath, backupFile);
      console.log('Created automated daily backup:', backupFile);
    }

    // Prune backups older than 30 days
    const files = fs.readdirSync(backupDir);
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    for (const f of files) {
      if (f.startsWith('business-backup-') && f.endsWith('.db')) {
        const fullPath = path.join(backupDir, f);
        const stat = fs.statSync(fullPath);
        if (stat.mtimeMs < thirtyDaysAgo) {
          fs.unlinkSync(fullPath);
          console.log('Pruned old backup:', f);
        }
      }
    }
  } catch (e) {
    console.error('Auto backup failed:', e);
  }
}
performDailyBackup();
setInterval(performDailyBackup, 6 * 60 * 60 * 1000);

// Configure environment for the Express backend
process.env.DATA_DIR = appDataDir;
const PORT = process.env.PORT || '5174';
process.env.PORT = PORT;

// In packaged app, resolve dist path
process.env.CLIENT_DIST = app.isPackaged
  ? path.join(__dirname, '..', 'client', 'dist')
  : path.join(__dirname, '..', 'client', 'dist');

// Function to poll the server until ready
async function waitForServer(port, maxAttempts = 60) {
  const url = `http://localhost:${port}/api/auth/status`;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(url, (res) => {
          if (res.statusCode >= 200 && res.statusCode < 400) {
            resolve();
          } else {
            reject(new Error(`Status ${res.statusCode}`));
          }
        });
        req.on('error', reject);
        req.setTimeout(500, () => {
          req.destroy();
          reject(new Error('Timeout'));
        });
      });
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  return false;
}

async function startBackend() {
  const serverPath = path.join(__dirname, '..', 'server', 'src', 'index.js');
  console.log('Starting backend from:', serverPath);
  await import(pathToFileURL(serverPath).href);
  const ready = await waitForServer(PORT);
  if (!ready) {
    console.warn('Backend server took longer than expected to report status');
  }
}

function createMainWindow() {
  const iconPath = path.join(__dirname, 'assets', 'icon.png');

  mainWindow = new BrowserWindow({
    width: 1366,
    height: 820,
    minWidth: 1024,
    minHeight: 700,
    title: 'Aqua Home Appliance — Business Management System',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      spellcheck: false,
    },
    show: false,
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
  });

  mainWindow.loadURL(`http://localhost:${PORT}`);

  // Open external links in default system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  buildAppMenu();
}

function buildAppMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Data / Backup Folder',
          click: () => {
            shell.openPath(appDataDir);
          },
        },
        { type: 'separator' },
        {
          label: 'Print',
          accelerator: 'CmdOrCtrl+P',
          click: () => {
            if (mainWindow) mainWindow.webContents.print();
          },
        },
        { type: 'separator' },
        { role: 'quit', label: 'Exit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload', label: 'Refresh Page' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About Aqua Home Appliance',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About Aqua Home Appliance',
              message: 'Aqua Home Appliance — Business Management System',
              detail: `Version: 1.0.0\n100% Offline Mode\nData Location:\n${targetDbPath}`,
            });
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(async () => {
  try {
    await startBackend();
    createMainWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      }
    });
  } catch (err) {
    console.error('Fatal initialization error:', err);
    dialog.showErrorBox(
      'Startup Error',
      `Could not start the business system backend:\n${err.message}`
    );
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
