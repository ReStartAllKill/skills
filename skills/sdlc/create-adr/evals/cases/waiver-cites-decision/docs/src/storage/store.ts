/** 본문 저장소. 업로드·다운로드·썸네일이 모두 이 목록 안에서만 움직인다. */
export const CONTENT_STORES = ['object', 'block'] as const
export type ContentStore = (typeof CONTENT_STORES)[number]

export function isSupported(code: string): code is ContentStore {
  return (CONTENT_STORES as readonly string[]).includes(code)
}

/** 한 업로드 안에서 저장소를 섞지 않는다. 경로 계산이 저장소별로 갈린다. */
export function assertSingleStore(codes: string[]) {
  if (new Set(codes).size > 1) throw new Error('mixed content store in one upload')
  return codes[0]
}
