import { describe, it, expect, vi } from 'vitest'
import { fetchScannerComments } from '../../github/client.js'

describe('fetchScannerComments', () => {
  it('returns only comments by the scanner login posted after startedAt', async () => {
    const startedAt = new Date('2024-01-01T10:00:00Z')
    const mockComments = [
      { id: 1, user: { login: 'bugbot[bot]', type: 'Bot' },
        body: 'Issue A', html_url: 'https://github.com/org/repo/pull/42#issuecomment-1', created_at: '2024-01-01T10:05:00Z' },
      { id: 2, user: { login: 'human-dev', type: 'User' },
        body: 'LGTM', html_url: 'https://github.com/org/repo/pull/42#issuecomment-2', created_at: '2024-01-01T10:06:00Z' },
      { id: 3, user: { login: 'bugbot[bot]', type: 'Bot' },
        body: 'Issue B', html_url: 'https://github.com/org/repo/pull/42#issuecomment-3', created_at: '2024-01-01T10:07:00Z' },
    ]

    const mockOctokit = {
      issues: {
        listComments: vi.fn().mockResolvedValue({ data: mockComments }),
      },
    }

    const result = await fetchScannerComments(
      mockOctokit as any, 'org/repo', 42, 'bugbot[bot]', startedAt,
      { prTitle: 'Fix auth', prUrl: 'https://github.com/org/repo/pull/42', prAuthor: 'agent' }
    )

    expect(result).toHaveLength(2)
    expect(result.every(e => e.source === 'bugbot')).toBe(true)
    expect(result.every(e => e.actor === 'bugbot[bot]')).toBe(true)
  })

  it('returns empty array when scanner left no comments', async () => {
    const mockOctokit = {
      issues: { listComments: vi.fn().mockResolvedValue({ data: [] }) },
    }
    const result = await fetchScannerComments(
      mockOctokit as any, 'org/repo', 42, 'bugbot[bot]', new Date(),
      { prTitle: 'x', prUrl: 'x', prAuthor: 'x' }
    )
    expect(result).toHaveLength(0)
  })
})
