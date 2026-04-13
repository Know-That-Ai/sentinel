import notifier from 'node-notifier'
import type { EventBatch, SentinelEvent } from '../github/events.js'

const notifiedIds = new Set<string>()

export function resetNotified(): void {
  notifiedIds.clear()
}

export function labelForSource(source: string): string {
  switch (source) {
    case 'bugbot': return 'BugBot Comment'
    case 'codeql': return 'CodeQL Alert'
    case 'ci': return 'CI Failed'
    case 'human': return 'Human Comment'
    default: return 'Notification'
  }
}

function truncate(str: string, maxLen: number): string {
  return str.length > maxLen ? str.slice(0, maxLen - 3) + '...' : str
}

export async function sendBatchNotification(
  batch: EventBatch,
  prMeta: { prTitle: string; prUrl: string }
): Promise<void> {
  for (const event of batch.events) {
    if (notifiedIds.has(event.id)) continue
    notifiedIds.add(event.id)

    notifier.notify({
      title: `[${event.repo}] PR #${event.prNumber}`,
      subtitle: labelForSource(event.source),
      message: truncate(event.body ?? event.actor, 120),
      open: event.githubUrl,
      timeout: 10,
    })
  }
}

export async function sendSingleNotification(event: SentinelEvent): Promise<void> {
  if (notifiedIds.has(event.id)) return
  notifiedIds.add(event.id)

  notifier.notify({
    title: `[${event.repo}] PR #${event.prNumber}`,
    subtitle: labelForSource(event.source),
    message: truncate(event.body ?? event.actor, 120),
    open: event.githubUrl,
    timeout: 10,
  })
}
