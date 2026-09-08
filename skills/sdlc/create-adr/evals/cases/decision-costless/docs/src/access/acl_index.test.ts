import { describe, expect, it } from 'vitest'
import { syncAcl, visibleTo } from './acl_index'

describe('acl index', () => {
  it('test_SearchRejectsUnauthorizedGroup', async () => {
    const entry = { docId: 'd-1', allowedGroups: ['eng'], indexedAt: 0 }
    expect(visibleTo(entry, ['sales'])).toBe(false)
    const rows = await syncAcl([{ docId: 'd-2', allowedGroups: [], indexedAt: 0 }])
    expect(rows).toHaveLength(0)
  })
})
