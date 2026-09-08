#!/usr/bin/env node
/** 실행 순서를 **센다** — 모델이 머릿속에서 위상정렬하지 않게.
 *
 *  `/implement-spec` 은 `depends` 를 위상정렬한 같은 깊이를 한 레벨로 병렬 실행한다. 그 계산을
 *  모델이 하면 틀린 날 병렬 충돌이나 순서 위반이 되는데, 검사기는 파일 겹침만 보고 순서는
 *  안 본다. 여기서 검사기와 **같은 함수**(`levelsOf`)로 레벨을 세고, 체크박스와 프로필을
 *  합쳐 «다음에 무엇을 어떻게 돌리나» 까지 답한다.
 *
 *    node plan-levels.mjs <스펙 폴더> [--json]
 *
 *  레벨마다 mode 가 붙는다 — main(작업 1개 · 메인 트리) · parallel(워크트리) ·
 *  sequential(프로필에 bootstrap 이 없어 워크트리 의존성을 세울 수 없다).
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, join, basename } from 'node:path'
import { loadDir, levelsOf, wpFiles, wpDeps, wpField, stripComments } from './artifact-parse.mjs'

const argv = process.argv.slice(2)
const JSON_OUT = argv.includes('--json')
const DIR = resolve(argv.find((a) => !a.startsWith('--')) ?? '.')

const docs = loadDir(DIR, () => {})
if (!docs.plan) { console.error(`plan.md 가 없다 — ${DIR}`); process.exit(2) }

let ROOT = null
for (let d = DIR, prev = null; d !== prev; prev = d, d = resolve(d, '..')) {
  if (existsSync(resolve(d, '.claude/spec-profile.yml'))) { ROOT = d; break }
}
const profile = ROOT ? readFileSync(join(ROOT, '.claude/spec-profile.yml'), 'utf8') : ''
const yml = (k) => (new RegExp(`^${k}:[ \\t]*(.*)$`, 'm').exec(profile)?.[1] ?? '')
  .replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '').trim()

/** §릴리스 영향 의 `키: 값` 줄 — `/implement-spec` 이 실제로 읽는 값이다. */
const planBody = stripComments(docs.plan.lines.join('\n'))
const release = /##\s*릴리스 영향[\s\S]*?(?=\n##\s|\n*$)/.exec(planBody)?.[0] ?? ''
const rel = (k) => (new RegExp(`^${k}:[ \\t]*(.*)$`, 'm').exec(release)?.[1] ?? '').trim()

const wps = [...docs.plan.ents.values()].filter((e) => e.kind === 'wp')
const { level, cycles, unknown } = levelsOf(wps)
const problems = [
  ...cycles.map((c) => `depends 가 순환한다: ${c.join(' → ')}`),
  ...unknown.map((u) => `${u.id} 의 depends 가 없는 작업 ${u.dep} 를 가리킨다`),
]

const byLevel = new Map()
for (const w of wps) { const lv = level.get(w.id) ?? 0; (byLevel.get(lv) ?? byLevel.set(lv, []).get(lv)).push(w) }
const bootstrap = yml('bootstrap')
const levels = [...byLevel.keys()].sort((a, b) => a - b).map((lv) => {
  const group = byLevel.get(lv)
  const tasks = group.map((w) => ({
    id: w.id, title: w.title, done: !!w.done,
    files: wpFiles(w), depends: wpDeps(w),
    covers: wpField(w, 'covers'), tests: wpField(w, 'tests'), verify: wpField(w, 'verify'),
  }))
  const overlaps = []
  for (let i = 0; i < tasks.length; i++) for (let j = i + 1; j < tasks.length; j++) {
    const shared = tasks[i].files.filter((f) => tasks[j].files.includes(f))
    if (shared.length) overlaps.push({ a: tasks[i].id, b: tasks[j].id, files: shared })
  }
  const mode = tasks.length === 1 ? 'main' : bootstrap ? 'parallel' : 'sequential'
  return { n: lv + 1, mode, tasks, overlaps, done: tasks.every((t) => t.done) }
})
for (const l of levels) for (const o of l.overlaps) problems.push(`레벨 ${l.n} 의 ${o.a} 와 ${o.b} 가 같은 파일을 만진다: ${o.files.join(', ')}`)
const next = levels.find((l) => !l.done) ?? null

const out = {
  spec: DIR, slug: basename(DIR), root: ROOT,
  status: docs.plan.fm.status ?? null,
  target_branch: rel('target_branch') || null, pr_strategy: rel('pr_strategy') || null,
  bootstrap: bootstrap || null, worktree_dir: yml('worktree_dir') || '.claude/worktrees',
  task_branch: yml('task_branch') || 'task/{slug}-{task}',
  verify: yml('verify') || null,
  levels, next: next ? next.n : null, problems,
}

if (JSON_OUT) { console.log(JSON.stringify(out, null, 2)); process.exit(problems.length ? 1 : 0) }

console.log(`실행 순서 — ${out.slug}  (status: ${out.status ?? '?'} · target_branch: ${out.target_branch ?? '없음'})`)
for (const l of levels) {
  const tag = l.done ? '완료' : next && l.n === next.n ? '지금부터' : ''
  console.log(`  레벨 ${l.n} [${l.mode}]: ${l.tasks.map((t) => `${t.done ? '[x]' : '[ ]'} ${t.id}`).join('  ')}${tag ? `   — ${tag}` : ''}`)
}
if (problems.length) { console.log(''); for (const p of problems) console.log(`  ✗ ${p}`) }
console.log(`\n다음: ${next ? `레벨 ${next.n} (${next.tasks.filter((t) => !t.done).map((t) => t.id).join('·')}) · ${next.mode}` : '없음 — 모든 작업이 체크됐다'}`)
process.exit(problems.length ? 1 : 0)
