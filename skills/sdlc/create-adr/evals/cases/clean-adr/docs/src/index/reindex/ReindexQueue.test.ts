import { beforeEach, describe, expect, it } from 'vitest'
import { ReindexQueue } from './ReindexQueue'

describe('reindex queue', () => {
  let queue: ReindexQueue
  beforeEach(() => { queue = new ReindexQueue() })

  it('test_ReindexRunsOnNextCycle', () => {
    const cycleId = queue.enqueue('d-1', 'ops')
    expect(cycleId).toBe(queue.nextCycleId())
    queue.runCycle(cycleId, 'dict-2026-09-04')
    expect(queue.dictOf(cycleId)).toBe('dict-2026-09-04')
  })

  it('test_SameCycleSharesOneDictionary', () => {
    const a = queue.enqueue('d-1', 'ops')
    const b = queue.enqueue('d-2', 'ops')
    expect(a).toBe(b)
  })
})
