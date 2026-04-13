import 'dotenv/config'
import { menubar } from 'menubar'
import { app, ipcMain, Tray } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DAEMON_URL = `http://localhost:${process.env.PORT ?? '3847'}`

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

async function fetchJSON(path: string): Promise<any> {
  const res = await fetch(`${DAEMON_URL}${path}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

async function postJSON(path: string): Promise<any> {
  const res = await fetch(`${DAEMON_URL}${path}`, { method: 'POST' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

async function pollTrayState(tray: Tray): Promise<void> {
  try {
    const events = await fetchJSON('/state/unreviewed')
    const sessions = await fetchJSON('/state/sessions')
    updateTrayTitle(tray, { unreviewed: events.length, dispatching: sessions.length })
  } catch {
    // Daemon may not be ready yet — silently skip
  }
}

function setupIPC(): void {
  ipcMain.handle('get-unreviewed', async () => {
    return fetchJSON('/state/unreviewed')
  })

  ipcMain.handle('mark-reviewed', async (_event: unknown, eventId: string) => {
    return postJSON(`/state/mark-reviewed/${eventId}`)
  })

  ipcMain.handle('get-linked-sessions', async () => {
    return fetchJSON('/state/sessions')
  })

  ipcMain.handle('dispatch-event', async (_event: unknown, eventId: string) => {
    return postJSON(`/state/dispatch/${eventId}`)
  })

  ipcMain.handle('quit-app', () => {
    app.quit()
  })
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
      setupIPC()
      updateTrayTitle(mb.tray, { unreviewed: 0, dispatching: 0 })

      setInterval(() => pollTrayState(mb.tray), 10_000)
      pollTrayState(mb.tray)
    })
  })
}

startMenubar()
