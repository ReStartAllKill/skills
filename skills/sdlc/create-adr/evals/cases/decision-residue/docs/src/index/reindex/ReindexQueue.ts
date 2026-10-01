/** 재색인 대기열. 마감 시각까지 들어온 요청을 한 회차로 묶어 같은 사전으로 처리한다. */
export type ReindexRequest = { docId: string; requester: string; cycleId: number }

export class ReindexQueue {
  private queue: ReindexRequest[] = []
  private dictVersion = new Map<number, string>()

  enqueue(docId: string, requester: string) {
    const cycleId = this.nextCycleId()
    this.queue.push({ docId, requester, cycleId })
    return cycleId
  }

  runCycle(cycleId: number, dict: string) {
    if (this.dictVersion.has(cycleId)) throw new Error('cycle already run')
    this.dictVersion.set(cycleId, dict)
    return this.queue.filter((r) => r.cycleId === cycleId)
  }

  dictOf(cycleId: number) {
    return this.dictVersion.get(cycleId)
  }

  nextCycleId() {
    return Math.floor(Date.now() / 86_400_000) + 1
  }
}
