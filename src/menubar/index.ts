import { menubar } from 'menubar'
import { app, ipcMain, Tray } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import { setupIPC } from './ipc.js'
import { handleGetUnreviewed, handleGetLinkedSessions } from './ipc.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

interface TrayState {
  unreviewed: number
  dispatching: number
}

export function updateTrayTitle(tray: Tray, state: TrayState): void {
  const { unreviewed, dispatching } = state

  if (dispatching > 0) {
    tray.setTitle(`\u26A1${dispatching}`)
  } else if (unreviewed > 0) {
    tray.setTitle(`\uD83D\uDC41 ${unreviewed}`)
  } else {
    tray.setTitle(`\uD83D\uDC41`)
  }
}

async function pollTrayState(tray: Tray): Promise<void> {
  try {
    const events = await handleGetUnreviewed()
    const sessions = await handleGetLinkedSessions()
    const dispatching = sessions.length
    updateTrayTitle(tray, { unreviewed: events.length, dispatching })
  } catch {
    // DB may not be ready yet — silently skip
  }
}

export function startMenubar(): void {
  app.whenReady().then(() => {
    const mb = menubar({
      index: `file://${path.join(__dirname, 'ui', 'index.html')}`,
      browserWindow: {
        width: 360,
        height: 480,
        webPreferences: {
          nodeIntegration: true,
          contextIsolation: false,
        },
      },
      preloadWindow: true,
    })

    mb.on('ready', () => {
      setupIPC(mb)
      updateTrayTitle(mb.tray, { unreviewed: 0, dispatching: 0 })

      // Poll every 10 seconds to refresh tray title
      setInterval(() => pollTrayState(mb.tray), 10_000)
      // Also poll immediately
      pollTrayState(mb.tray)
    })
  })
}
