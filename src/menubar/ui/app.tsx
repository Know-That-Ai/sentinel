import React, { useState, useEffect, useCallback } from 'react'
import { EventList } from './components/EventList.js'
import { Settings } from './components/Settings.js'

const { ipcRenderer, shell } = require('electron')

interface EventRow {
  id: string
  repo: string
  pr_number: number
  pr_title: string
  pr_url: string
  pr_author: string
  event_type: string
  source: string
  actor: string
  body: string | null
  github_url: string
  received_at: string
  reviewed: number
  dispatched_to: string | null
  dispatch_status: string | null
}

interface LinkedSession {
  id: string
  repo: string
  pr_number: number
  agent_type: string
  unlinked_at: string | null
  terminal_pid?: number | null
  pr_status?: 'green' | 'red' | 'pending' | 'unknown'
  open_events?: number
}

export function App() {
  const [events, setEvents] = useState<EventRow[]>([])
  const [sessions, setSessions] = useState<LinkedSession[]>([])
  const [showSettings, setShowSettings] = useState(false)
  const [dispatchingIds, setDispatchingIds] = useState<Set<string>>(new Set())

  const fetchData = useCallback(async () => {
    try {
      const [evts, sess] = await Promise.all([
        ipcRenderer.invoke('get-unreviewed'),
        ipcRenderer.invoke('get-linked-sessions'),
      ])
      setEvents(evts)
      setSessions(sess)
    } catch (err) {
      console.error('Failed to fetch data:', err)
    }
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 10_000)
    return () => clearInterval(interval)
  }, [fetchData])

  const handleOpenExternal = useCallback((url: string) => {
    shell.openExternal(url)
  }, [])

  const handleMarkReviewed = useCallback(async (eventId: string) => {
    // Optimistic removal
    setEvents(prev => prev.filter(e => e.id !== eventId))
    await ipcRenderer.invoke('mark-reviewed', eventId)
  }, [])

  const handleDispatch = useCallback(async (eventId: string) => {
    setDispatchingIds(prev => new Set(prev).add(eventId))
    try {
      await ipcRenderer.invoke('dispatch-event', eventId)
    } finally {
      setDispatchingIds(prev => {
        const next = new Set(prev)
        next.delete(eventId)
        return next
      })
      fetchData()
    }
  }, [fetchData])

  const handleRefresh = useCallback(() => {
    fetchData()
  }, [fetchData])

  const handleQuit = useCallback(() => {
    ipcRenderer.invoke('quit-app')
  }, [])

  if (showSettings) {
    return <Settings onClose={() => setShowSettings(false)} />
  }

  const linkedPRs = new Set(
    sessions
      .filter(s => !s.unlinked_at)
      .map(s => `${s.repo}:${s.pr_number}`)
  )

  return (
    <div>
      <div className="header">
        {events.length > 0
          ? `\uD83D\uDC41 ${events.length} unreviewed`
          : `\uD83D\uDC41 all clear`}
      </div>

      {events.length === 0 ? (
        <div className="empty-state">
          <div className="icon">{'\u2705'}</div>
          <div>No unreviewed events</div>
        </div>
      ) : (
        <EventList
          events={events}
          linkedPRs={linkedPRs}
          dispatchingIds={dispatchingIds}
          onOpen={handleOpenExternal}
          onReview={handleMarkReviewed}
          onDispatch={handleDispatch}
        />
      )}

      {sessions.filter(s => !s.unlinked_at).length > 0 && (
        <div className="linked-sessions">
          <div className="linked-header">{'\uD83D\uDD17'} Linked Sessions</div>
          {sessions.filter(s => !s.unlinked_at).map(s => {
            const status = s.pr_status ?? 'unknown'
            const dotClass = `pr-status-dot pr-status-${status}`
            const title =
              status === 'green' ? 'All checks green — ready to merge' :
              status === 'red' ? `${s.open_events ?? 0} open event(s) or failing check(s)` :
              status === 'pending' ? 'Checks running' :
              'No checks seen yet'
            return (
              <div key={s.id} className="linked-row">
                <span className={dotClass} title={title}>{'\u25CF'}</span>
                <span className="linked-agent">{s.agent_type === 'claude-code' ? '\u26A1' : '\uD83E\uDD16'}</span>
                <span className="linked-detail">{s.repo}#{s.pr_number}</span>
                <span className="linked-pid">pid {s.terminal_pid ?? '-'}</span>
              </div>
            )
          })}
        </div>
      )}

      <div className="footer">
        <button className="footer-btn" onClick={() => setShowSettings(true)}>
          {'\u2699'} Settings
        </button>
        <button className="footer-btn" onClick={handleRefresh}>
          {'\uD83D\uDD04'} Refresh
        </button>
        <button className="footer-btn" onClick={handleQuit}>
          {'\u2715'} Quit
        </button>
      </div>
    </div>
  )
}
