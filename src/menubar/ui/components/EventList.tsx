import React from 'react'
import { EventItem } from './EventItem.js'

interface EventRow {
  id: string
  repo: string
  pr_number: number
  pr_title: string
  pr_url: string
  event_type: string
  source: string
  actor: string
  body: string | null
  github_url: string
}

interface EventListProps {
  events: EventRow[]
  linkedPRs: Set<string>
  dispatchingIds: Set<string>
  onOpen: (url: string) => void
  onReview: (eventId: string) => void
  onDispatch: (eventId: string) => void
}

function groupByRepo(events: EventRow[]): Map<string, EventRow[]> {
  const groups = new Map<string, EventRow[]>()
  for (const event of events) {
    const existing = groups.get(event.repo)
    if (existing) {
      existing.push(event)
    } else {
      groups.set(event.repo, [event])
    }
  }
  return groups
}

export function EventList({ events, linkedPRs, dispatchingIds, onOpen, onReview, onDispatch }: EventListProps) {
  const grouped = groupByRepo(events)

  return (
    <div>
      {Array.from(grouped.entries()).map(([repo, repoEvents]) => (
        <div key={repo} className="repo-group">
          <div className="repo-name">{repo}</div>
          {repoEvents.map(event => (
            <EventItem
              key={event.id}
              event={event}
              isLinked={linkedPRs.has(`${event.repo}:${event.pr_number}`)}
              isDispatching={dispatchingIds.has(event.id)}
              onOpen={onOpen}
              onReview={onReview}
              onDispatch={onDispatch}
            />
          ))}
        </div>
      ))}
    </div>
  )
}
