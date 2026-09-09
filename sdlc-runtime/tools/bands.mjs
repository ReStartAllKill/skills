#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs'
import { resolve, join, relative } from 'node:path'

export const AUTONOMY = ['log', 'diagnose', 'propose']
const REQUIRED = ['metric', 'source', 'window', 'rule', 'autonomy_tier', 'owner']

export function parseBands(text) {
  const out = { version: null, bands: {}, problems: [] }
  const bad = (line, msg) => out.problems.push({ line, msg })
  const lines = text.split(/\r?\n/)
  let cur = null
  let inBands = false
  let inRevised = false

  const strip = (s) => s.replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '').trim()

  lines.forEach((raw, i) => {
    const line = raw.replace(/\s*$/, '')
    if (!line.trim() || /^\s*#/.test(line)) return
    const indent = line.length - line.trimStart().length
    const body = line.trim()

    if (indent === 0) {
      inBands = body === 'bands:'
      cur = null; inRevised = false
      if (inBands) return
      const m = /^([A-Za-z_]\w*):\s*(.*)$/.exec(body)
      if (m) out[m[1]] = strip(m[2])
      else bad(i + 1, `최상위에서 \`키: 값\` 이 아니다: ${body}`)
      return
    }
    if (!inBands) return

    if (indent === 2) {
      const m = /^([A-Za-z0-9_.-]+):$/.exec(body)
      if (!m) { bad(i + 1, `밴드 id 는 \`  <id>:\` 한 줄이어야 한다: ${body}`); return }
      cur = m[1]; inRevised = false
      if (out.bands[cur]) bad(i + 1, `밴드 \`${cur}\` 이 두 번 정의됐다`)
      out.bands[cur] = { revised: [], line: i + 1 }
      return
    }
    if (!cur) { bad(i + 1, `어느 밴드에도 속하지 않은 줄: ${body}`); return }

    if (indent === 4) {
      if (body === 'revised:') { inRevised = true; return }
      inRevised = false
      const m = /^([A-Za-z_]\w*):\s*(.*)$/.exec(body)
      if (!m) { bad(i + 1, `\`키: 값\` 이 아니다: ${body}`); return }
      out.bands[cur][m[1]] = strip(m[2])
      return
    }
    if (indent >= 6 && inRevised) {
      const m = /^-\s*(.*)$/.exec(body)
      if (!m) { bad(i + 1, `revised 항목은 \`- …\` 이어야 한다: ${body}`); return }
      out.bands[cur].revised.push(strip(m[1]))
      return
    }
    bad(i + 1, `들여쓰기를 읽을 수 없다(0·2·4·6 만 쓴다): ${body}`)
  })
  return out
}

export function validate(reg) {
  const problems = reg.problems.map((p) => ({ level: 'error', ...p }))
  const err = (line, msg, hint) => problems.push({ level: 'error', line, msg, hint })
  const warn = (line, msg, hint) => problems.push({ level: 'warn', line, msg, hint })

  if (reg.version == null) warn(1, '`version` 이 없다', '등록부가 바뀐 것을 알아보려면 번호가 있어야 한다.')
  const ids = Object.keys(reg.bands)
  if (ids.length === 0) err(1, '밴드가 하나도 없다', '`bands:` 밑에 `  <id>:` 로 정의한다. 등록부가 비면 `trigger: band_breach` 가 가리킬 곳이 없다.')

  for (const [id, b] of Object.entries(reg.bands)) {
    for (const k of REQUIRED) {
      if (b[k]) continue
      err(b.line, `밴드 \`${id}\` 에 \`${k}\` 가 없다`,
        k === 'source'
          ? '재현은 문장이 아니라 **명령이나 질의**여야 한다 — 그래야 다음 사람이 같은 것을 본다.'
          : `밴드마다 ${REQUIRED.join(' · ')} 가 있어야 한다.`)
    }
    if (b.autonomy_tier && !AUTONOMY.includes(b.autonomy_tier)) {
      err(b.line, `밴드 \`${id}\` 의 \`autonomy_tier: ${b.autonomy_tier}\` 가 셋 중 하나가 아니다`, AUTONOMY.join(' · '))
    }
    for (const r of b.revised) {
      if (/^\d{4}-\d{2}-\d{2}\s+FND-[\w-]+\s*[—–-]\s*\S/.test(r)) continue
      err(b.line, `밴드 \`${id}\` 의 조정 기록을 읽을 수 없다: ${r}`,
        '`YYYY-MM-DD FND-YYYY-NNN — <무엇을 어떻게>` 로 적는다. 어느 발견이 이 밴드를 바꿨는지가 없으면 조정이 왜 일어났는지 아무도 답할 수 없다.')
    }
  }
  return problems
}

export const revisedBy = (reg, bandId, findingId) =>
  (reg.bands[bandId]?.revised ?? []).some((r) => r.includes(findingId))

export function loadBands(root, profileValue) {
  const rel = profileValue || '.claude/bands.yml'
  const path = resolve(root, rel)
  if (!existsSync(path)) return { path, rel, missing: true, bands: {}, problems: [] }
  return { path, rel, missing: false, ...parseBands(readFileSync(path, 'utf8')) }
}


if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2)
  const STRICT = argv.includes('--strict')
  const ROOT = resolve(argv.find((a) => !a.startsWith('--')) ?? process.cwd())
  const profile = join(ROOT, '.claude/spec-profile.yml')
  const key = existsSync(profile)
    ? (/^bands:[ \t]*(.*)$/m.exec(readFileSync(profile, 'utf8'))?.[1] ?? '').replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '').trim()
    : ''
  const reg = loadBands(ROOT, key)

  if (reg.missing) {
    console.log(`밴드 등록부가 없다 — ${reg.rel}`)
    console.log('탐지가 결정론으로 남으려면 «무엇이 정상인가» 가 파일에 있어야 한다.')
    console.log('`/create-finding` 이 처음 밴드를 만날 때 만들거나, 손으로 만든다.')
    process.exit(0)
  }
  const problems = validate(reg)
  const errs = problems.filter((p) => p.level === 'error')
  const warns = problems.filter((p) => p.level === 'warn')
  console.log(`밴드 등록부 — ${relative(ROOT, reg.path)}  (밴드 ${Object.keys(reg.bands).length}개)`)
  for (const [id, b] of Object.entries(reg.bands)) {
    console.log(`  ${id}  ${b.rule ?? '?'} · ${b.window ?? '?'} · ${b.autonomy_tier ?? '?'} · ${b.owner ?? '?'}${b.revised.length ? `  (조정 ${b.revised.length}회)` : ''}`)
  }
  if (problems.length) console.log('')
  for (const p of problems) {
    console.log(`  ${p.level === 'error' ? '✗' : '⚠'} ${p.line}행  ${p.msg}`)
    if (p.hint) console.log(`      ${p.hint}`)
  }
  console.log(`\n오류 ${errs.length}건 · 경고 ${warns.length}건`)
  process.exit(errs.length || (STRICT && warns.length) ? 1 : 0)
}
