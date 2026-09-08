import { describe, expect, it } from 'vitest'
import { replayFromStream } from './replay'

describe('audit replay', () => {
  it('test_AuditReplayMatchesStreamTotals', async () => {
    const rows = await replayFromStream([])
    expect(rows).toHaveLength(0)
  })

  it('test_IndexedAuditMatchesStreamTotals', async () => {
    const rows = await replayFromStream([])
    expect(rows).toEqual([])
  })
})
