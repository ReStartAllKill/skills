/** 색인에 실을 열람 자격. 사용자 목록은 넣지 않고 허용 그룹과 판정 시각만 남긴다. */
export type AclEntry = {
  docId: string
  allowedGroups: string[]
  indexedAt: number
}

export function visibleTo(entry: AclEntry, groups: string[]) {
  return entry.allowedGroups.some((g) => groups.includes(g))
}

export async function syncAcl(entries: AclEntry[]) {
  const live = entries.filter((e) => e.allowedGroups.length > 0)
  return live.map((e) => [e.docId, e.allowedGroups, e.indexedAt] as const)
}
