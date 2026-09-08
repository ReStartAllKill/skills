/** 문체 번들 선택 — 프로필의 `lang` 이 «어떤 자로 재는가» 를 고른다.
 *
 * 계약(`keywords.mjs`)은 여기를 안 탄다. 계약은 언어와 무관하게 양쪽을 다 받고, 이 파일이 고르는
 * 것은 낱말 목록과 글자 한도뿐이다. 둘을 한 키로 묶으면 한국어 레포의 문서를 영어 레포에서 못 읽는다.
 *
 * 번들은 **정적으로** 가져온다. 런타임이 전부 동기 코드라 여기만 `await import` 를 쓰면 호출자마다
 * async 가 번지고, 번들 둘을 늘 읽는 비용은 무시할 만하다.
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import * as ko from '../locales/ko.mjs'
import * as en from '../locales/en.mjs'

const BUNDLES = { ko, en }
export const DEFAULT_LANG = 'ko'

/** 산출물 경로에서 위로 올라가며 프로필의 `lang` 을 찾는다. 없으면 ko — 기존 레포는 아무것도 안 바뀐다. */
export function langOf(from) {
  for (let d = resolve(from ?? '.'), prev = null; d !== prev; prev = d, d = resolve(d, '..')) {
    const p = join(d, '.claude/spec-profile.yml')
    if (!existsSync(p)) continue
    const m = /^lang:[ \t]*(.*)$/m.exec(readFileSync(p, 'utf8'))
    const v = (m?.[1] ?? '').replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '').trim()
    return v || DEFAULT_LANG
  }
  return DEFAULT_LANG
}

// 진입점이 한 번 정하고 나머지는 읽기만 한다. adr-check 처럼 경로를 못 받는 모듈이 있어
// 인자로 계속 흘리는 대신 여기 둔다.
let current = ko
let currentLang = DEFAULT_LANG

/** 진입점에서 한 번 호출한다. 번들이 없는 언어는 «검사 안 함» 이 아니라 «검사 못 함» 이라 멈춘다. */
export function useLocale(from) {
  const lang = langOf(from)
  const bundle = BUNDLES[lang]
  if (!bundle) {
    console.error(`프로필의 \`lang: ${lang}\` 에 해당하는 문체 번들이 없다 — sdlc-runtime/locales/${lang}.mjs 가 필요하다.\n` +
      `  번들 없이 돌리면 문체 검사가 하나도 안 걸리는데, 안 걸리는 것은 통과와 구분되지 않는다.\n` +
      `  쓸 수 있는 언어: ${Object.keys(BUNDLES).join(' · ')}`)
    process.exit(2)
  }
  current = bundle
  currentLang = lang
  return bundle
}

export const locale = () => current
export const localeLang = () => currentLang
