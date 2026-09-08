#!/usr/bin/env node
/** 독립 에이전트 실행 결과를 동일한 기준으로 채점한다.
 *
 *   node forward-eval.mjs --list
 *   node forward-eval.mjs results.json
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const cases = JSON.parse(readFileSync(join(HERE, 'forward-cases.json'), 'utf8'))
const arg = process.argv[2]

if (arg === '--list') {
  for (const c of cases) console.log(`${c.id}\t${c.skill}\t${c.request}`)
  process.exit(0)
}
if (!arg) {
  console.error('usage: node forward-eval.mjs --list | <results.json>')
  process.exit(2)
}

const result = JSON.parse(readFileSync(resolve(arg), 'utf8'))
const rows = []
for (const c of cases) {
  const got = (result.cases ?? []).find((x) => x.id === c.id)
  const problems = []
  if (!got) problems.push('결과 없음')
  const scores = got?.scores ?? []
  const evidence = got?.evidence ?? []
  if (scores.length !== c.must.length) problems.push(`점수 ${scores.length}개 · 기준 ${c.must.length}개`)
  if (scores.some((x) => ![0, 1, 2].includes(x))) problems.push('점수는 0·1·2만 가능')
  if (evidence.length !== c.must.length) problems.push(`증거 ${evidence.length}개 · 기준 ${c.must.length}개`)
  const points = scores.reduce((a, b) => a + b, 0)
  const max = c.must.length * 2
  const ok = problems.length === 0 && !scores.includes(0) && points / max >= 0.8
  rows.push({ id: c.id, ok, points, max, problems })
}

console.log(`SDLC forward-eval — ${result.model ?? '모델 미기록'} · ${result.date ?? '날짜 미기록'}\n`)
for (const r of rows) {
  console.log(`  ${r.ok ? '통과' : '✗ 실패'}  ${r.id}  ${r.points}/${r.max}`)
  for (const p of r.problems) console.log(`      ${p}`)
}
const failed = rows.filter((r) => !r.ok).length
console.log(`\n${rows.length - failed}/${rows.length} 통과`)
process.exit(failed ? 1 : 0)
