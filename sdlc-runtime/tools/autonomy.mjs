#!/usr/bin/env node
/** 자율 실행 정책의 위험 등급·허용 단계·만료일·책임자를 검사한다. 사용법: node autonomy.mjs <repo-root> [--strict]. */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, join, relative, basename } from 'node:path'

export const STAGES = ['finding', 'intent', 'spec', 'plan', 'implement']
export const TIERS = ['light', 'standard', 'full']
const REQUIRED = ['trigger', 'max_tier', 'advance_to', 'expires', 'tools']

/** 최상위 스칼라와 routes의 경로별 필드·목록을 읽는다. */
export function parsePolicy(text) {
  const out = { version: null, owner: null, routes: {}, problems: [] }
  const bad = (line, msg) => out.problems.push({ line, msg })
  const strip = (s) => s.replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '').trim()
  let cur = null, inRoutes = false, listKey = null

  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.replace(/\s*$/, '')
    if (!line.trim() || /^\s*#/.test(line)) return
    const indent = line.length - line.trimStart().length
    const body = line.trim()

    if (indent === 0) {
      inRoutes = body === 'routes:'
      cur = null; listKey = null
      if (inRoutes) return
      const m = /^([A-Za-z_]\w*):\s*(.*)$/.exec(body)
      if (m) out[m[1]] = strip(m[2])
      else bad(i + 1, `최상위에서 \`키: 값\` 이 아니다: ${body}`)
      return
    }
    if (!inRoutes) return

    if (indent === 2) {
      const m = /^([A-Za-z0-9_.-]+):$/.exec(body)
      if (!m) { bad(i + 1, `경로 id 는 \`  <id>:\` 한 줄이어야 한다: ${body}`); return }
      cur = m[1]; listKey = null
      if (out.routes[cur]) bad(i + 1, `경로 \`${cur}\` 이 두 번 정의됐다`)
      out.routes[cur] = { line: i + 1, bands: [] }
      return
    }
    if (!cur) { bad(i + 1, `어느 경로에도 속하지 않은 줄: ${body}`); return }

    if (indent === 4) {
      const m = /^([A-Za-z_]\w*):\s*(.*)$/.exec(body)
      if (!m) { bad(i + 1, `\`키: 값\` 이 아니다: ${body}`); return }
      const v = strip(m[2])
      if (v === '') { listKey = m[1]; out.routes[cur][listKey] = []; return }
      listKey = null
      // 인라인 배열도 지원한다.
      out.routes[cur][m[1]] = v.startsWith('[')
        ? v.slice(1, -1).split(',').map((s) => strip(s)).filter(Boolean)
        : v
      return
    }
    if (indent >= 6 && listKey) {
      const m = /^-\s*(.*)$/.exec(body)
      if (!m) { bad(i + 1, `목록 항목은 \`- …\` 이어야 한다: ${body}`); return }
      out.routes[cur][listKey].push(strip(m[1]))
      return
    }
    bad(i + 1, `들여쓰기를 읽을 수 없다(0·2·4·6 만 쓴다): ${body}`)
  })
  return out
}

export function validate(pol, today = new Date()) {
  const problems = pol.problems.map((p) => ({ level: 'error', ...p }))
  const err = (line, msg, hint) => problems.push({ level: 'error', line, msg, hint })
  const warn = (line, msg, hint) => problems.push({ level: 'warn', line, msg, hint })

  if (!pol.owner) {
    err(1, '`owner` 가 없다',
      '이 위임의 책임자가 없으면 자율 실행이 만든 문서의 `approved_by` 가 아무도 가리키지 못한다.')
  }
  const ids = Object.keys(pol.routes)
  if (ids.length === 0) err(1, '경로가 하나도 없다', '`routes:` 밑에 `  <id>:` 로 정의한다.')

  for (const [id, r] of Object.entries(pol.routes)) {
    for (const k of REQUIRED) {
      if (r[k]) continue
      err(r.line, `경로 \`${id}\` 에 \`${k}\` 가 없다`,
        k === 'expires'
          ? '만료 없는 자율은 아무도 다시 안 본다는 뜻이다. 날짜를 적는다.'
          : `자율 경로는 ${REQUIRED.join(' · ')} 를 모두 말해야 한다.`)
    }
    if (r.max_tier && !TIERS.includes(r.max_tier)) {
      err(r.line, `경로 \`${id}\` 의 \`max_tier: ${r.max_tier}\` 가 셋 중 하나가 아니다`, TIERS.join(' · '))
    }
    /** full 등급은 자율 실행을 허용하지 않는다. */
    if (r.max_tier === 'full') {
      err(r.line, `경로 \`${id}\` 이 \`max_tier: full\` 이다`,
        'full 은 되돌리기 어려운 변경이다(마이그레이션 · 공개 계약 · 개인정보 · 보안 경계). 자율로 열지 않는다 — standard 까지가 한계다.')
    }
    if (r.advance_to && !STAGES.includes(r.advance_to)) {
      err(r.line, `경로 \`${id}\` 의 \`advance_to: ${r.advance_to}\` 를 못 읽었다`, STAGES.join(' → '))
    }
    /** implement 정책은 기본 브랜치와 다른 target_branch가 필요하다. */
    if (r.advance_to === 'implement' && !r.target_branch) {
      err(r.line, `경로 \`${id}\` 이 \`implement\` 까지 가는데 \`target_branch\` 가 없다`,
        '코드를 쓰는 자율 경로는 기본 브랜치로 바로 가면 안 된다. 사람이 보는 마지막 자리는 PR 리뷰다 — 전용 브랜치를 적는다.')
    }
    if (r.expires) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(r.expires)) {
        err(r.line, `경로 \`${id}\` 의 \`expires: ${r.expires}\` 가 날짜가 아니다`, '`YYYY-MM-DD` 로 적는다.')
      } else if (new Date(r.expires) < today) {
        warn(r.line, `경로 \`${id}\` 이 만료됐다 (${r.expires})`,
          '만료된 경로는 디스패처가 실행하지 않는다. 다시 검토하고 날짜를 갱신하거나 지운다.')
      }
    }
  }
  return problems
}

/** 디스패처와 검사기가 공유하는 정책 유효기간 판정. */
export const routeActive = (r, today = new Date()) =>
  !!r && /^\d{4}-\d{2}-\d{2}$/.test(r.expires ?? '') && new Date(r.expires) >= today

export function loadPolicy(root, profileValue) {
  const rel = profileValue || '.claude/autonomy.yml'
  const path = resolve(root, rel)
  if (!existsSync(path)) return { path, rel, missing: true, routes: {}, problems: [] }
  return { path, rel, missing: false, ...parsePolicy(readFileSync(path, 'utf8')) }
}


if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2)
  const STRICT = argv.includes('--strict')
  const ROOT = resolve(argv.find((a) => !a.startsWith('--')) ?? process.cwd())
  const profile = join(ROOT, '.claude/spec-profile.yml')
  const key = existsSync(profile)
    ? (/^autonomy:[ \t]*(.*)$/m.exec(readFileSync(profile, 'utf8'))?.[1] ?? '')
        .replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '').trim()
    : ''
  const pol = loadPolicy(ROOT, key)

  if (pol.missing) {
    console.log(`자율 실행 정책이 없다 — ${pol.rel}`)
    console.log('이 레포에는 자율 경로가 없다. 사람이 각 칸을 승인하는 기본 흐름만 돈다.')
    process.exit(0)
  }
  const problems = validate(pol)
  const errs = problems.filter((p) => p.level === 'error')
  console.log(`자율 실행 정책 — ${relative(ROOT, pol.path)}  (책임자: ${pol.owner ?? '?'})`)
  for (const [id, r] of Object.entries(pol.routes)) {
    const live = routeActive(r) ? '' : '  ← 만료'
    console.log(`  ${id}  ${r.trigger ?? '?'} · ≤${r.max_tier ?? '?'} · →${r.advance_to ?? '?'} · ${r.expires ?? '?'}${live}`)
  }
  if (problems.length) console.log('')
  for (const p of problems) {
    console.log(`  ${p.level === 'error' ? '✗' : '⚠'} ${p.line}행  ${p.msg}`)
    if (p.hint) console.log(`      ${p.hint}`)
  }
  console.log(`\n오류 ${errs.length}건 · 경고 ${problems.length - errs.length}건`)
  process.exit(errs.length || (STRICT && problems.length > errs.length) ? 1 : 0)
}
