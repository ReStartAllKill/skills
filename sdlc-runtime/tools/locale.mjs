/** Select the prose-checking bundle from profile.lang. Contract keywords live in keywords.mjs.
 * Import bundles statically to preserve the synchronous API. */
import { existsSync, readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import * as ko from '../locales/ko.mjs'
import * as en from '../locales/en.mjs'

const BUNDLES = { ko, en }
export const DEFAULT_LANG = 'ko'

/** Find lang in the nearest parent profile. The default is ko. */
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

// Entrypoints set the locale once. Modules without a path, such as adr-check, read it here.
let current = ko
let currentLang = DEFAULT_LANG

/** Set the language at an entrypoint. Reject unsupported languages. */
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
