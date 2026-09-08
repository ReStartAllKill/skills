export type AuditEvent = { seq: number; actor: string; action: string }

/** 이벤트 스트림을 재생해 감사 로그를 세운다. ADR-020 이 정한 옛 경로다. */
export async function replayFromStream(events: AuditEvent[]) {
  const rows = []
  for (const e of events) {
    rows.push({ seq: e.seq, actor: e.actor, action: e.action })
  }
  return rows
}
