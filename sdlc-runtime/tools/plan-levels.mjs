#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs'
import { resolve, join, basename } from 'node:path'
import { loadDir, levelsOf, wpFiles, wpDeps, wpField, stripComments } from './artifact-parse.mjs'
import { overlappingTaskPaths, validTaskPath } from './task-paths.mjs'
import { SECTION, sectionBlock } from './keywords.mjs'

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

const planBody = stripComments(docs.plan.lines.join('\n'))
const release = sectionBlock(SECTION.releaseImpact).exec(planBody)?.[0] ?? ''
const rel = (k) => (new RegExp(`^${k}:[ \\t]*(.*)$`, 'm').exec(release)?.[1] ?? '').trim()

const wps = [...docs.plan.ents.values()].filter((e) => e.kind === 'wp')
const { level, cycles, unknown } = levelsOf(wps)
const problems = [
  ...wps.flatMap((w) => wpFiles(w).filter((p) => !validTaskPath(p)).map((p) => `${w.id} 의 files 는 저장소 안의 상대 경로여야 한다: ${p}`)),
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
    const shared = overlappingTaskPaths(tasks[i].files, tasks[j].files)
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
