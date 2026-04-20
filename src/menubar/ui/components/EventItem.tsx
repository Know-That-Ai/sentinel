import React from 'react'

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
}

interface EventItemProps {
  event: EventRow
  isLinked: boolean
  isDispatching: boolean
  onOpen: (url: string) => void
  onReview: (eventId: string) => void
  onDispatch: (eventId: string) => void
}

function sourceLabel(source: string, eventType: string): string {
  if (source === 'bugbot') return 'BugBot'
  if (source === 'codeql') return 'CodeQL'
  if (eventType === 'check_failure') return 'CI Failed'
  if (source === 'human') return 'Review'
  return 'Other'
}

function sourceLabelClass(source: string, eventType: string): string {
  if (source === 'bugbot') return 'bugbot'
  if (source === 'codeql') return 'codeql'
  if (eventType === 'check_failure') return 'ci'
  return 'other'
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen - 2) + '..'
}

export function EventItem({ event, isLinked, isDispatching, onOpen, onReview, onDispatch }: EventItemProps) {
  const author = event.pr_author
  return (
    <div className={`event-row ${isLinked ? '' : 'unlinked'}`}>
      <span className="event-arrow">{'\u21B3'}</span>
      <span className={`event-label ${sourceLabelClass(event.source, event.event_type)}`}>
        {sourceLabel(event.source, event.event_type)}
      </span>
      <span className="event-info">
        <span className="event-pr">PR #{event.pr_number}</span>
        {author && (
          <>
            {' \u00B7 '}
            <span className="event-author">@{author}</span>
          </>
        )}
        {' \u00B7 '}
        {truncate(event.pr_title, 24)}
      </span>
      {isLinked ? (
        <span className="linked-indicator" title="Linked to a Claude session">{'\uD83D\uDD17'}</span>
      ) : (
        <span className="unlinked-indicator" title="No linked Claude session — notify-only">{'\u25CB'}</span>
      )}
      <div className="event-actions">
        <button
          className="action-btn"
          onClick={() => onOpen(event.github_url)}
          title="Open in GitHub"
        >
          {'\u2192'}
        </button>
        <button
          className="action-btn"
          onClick={() => onReview(event.id)}
          title="Mark reviewed"
        >
          {'\u2713'}
        </button>
        <button
          className={`action-btn ${isDispatching ? 'dispatching' : ''}`}
          onClick={() => onDispatch(event.id)}
          title="Dispatch to agent"
          disabled={isDispatching}
        >
          {'\u26A1'}
        </button>
      </div>
    </div>
  )
}
