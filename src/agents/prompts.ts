import { labelForSource } from '../notifications/index.js'
import type { EventBatch, SentinelEvent } from '../github/events.js'

export const PUSH_RULES = `
IMPORTANT — follow these rules exactly when making changes:
- Stage and commit your changes with a clear, descriptive commit message
- Push the commit to the existing branch (do NOT create a new branch)
- Run all pre-push hooks as normal — do NOT use --no-verify or any flag that skips hooks
- If a pre-push hook fails, fix the hook failure before pushing — do not bypass it
- Do NOT open a new PR — the PR already exists, your push will update it automatically
`.trim()

export function buildPrompt(event: SentinelEvent): string {
  if (event.eventType === 'check_failure') {
    return `
A CI/CD check has failed on PR #${event.prNumber} in ${event.repo}.

PR Title: ${event.prTitle}
PR URL: ${event.prUrl}
Failed Check: ${event.actor}
Details: ${event.body ?? 'No details available'}

Your task:
1. Read the failing check output carefully
2. Identify the root cause of the failure
3. Fix the issue in the appropriate files on the current branch
4. Commit and push the fix to update the PR

${PUSH_RULES}
    `.trim()
  }

  if (event.source === 'bugbot' || event.source === 'codeql') {
    return `
A security/quality scan has left a comment on PR #${event.prNumber} in ${event.repo}.

PR Title: ${event.prTitle}
PR URL: ${event.prUrl}
Scanner: ${event.actor}
Comment: ${event.body}

Your task:
1. Read the scanner comment carefully
2. For each issue identified, assess whether it is a true positive
3. Fix all true positives in the relevant files on the current branch
4. For false positives, add an inline code comment explaining why it is safe to ignore
5. Commit and push the fixes to update the PR

${PUSH_RULES}
    `.trim()
  }

  return `
A comment has been left on PR #${event.prNumber} in ${event.repo} by ${event.actor}.

PR: ${event.prTitle} — ${event.prUrl}
Comment: ${event.body}

Review this comment and determine if any code changes are required.
If yes, implement the changes, then commit and push to update the PR.
If no changes are needed, leave a reply on the PR explaining your assessment.

${PUSH_RULES}
  `.trim()
}

export function buildBatchPrompt(batch: EventBatch, prTitle: string, prUrl: string): string {
  const issueCount = batch.events.length
  const sources = [...new Set(batch.events.map(e => e.source))].join(', ')

  const issueList = batch.events
    .map((e, i) => {
      const label = labelForSource(e.source)
      return `### Issue ${i + 1} — ${label} (${e.actor})\n${e.body ?? 'No details'}`
    })
    .join('\n\n')

  return `
${issueCount} issue${issueCount > 1 ? 's' : ''} have been reported on PR #${batch.prNumber} in ${batch.repo}.

PR: ${prTitle} — ${prUrl}
Sources: ${sources}

---

${issueList}

---

Your task:
1. Address ALL ${issueCount} issues listed above in a single pass
2. For each issue: assess it, fix true positives, annotate false positives with an inline comment
3. If any issues share a root cause, fix the root cause once rather than patching each symptom separately
4. After all fixes are made, commit and push in a single commit

${PUSH_RULES}
  `.trim()
}
