#!/usr/bin/env node
/** 한 산출물 폴더에 check-artifacts.mjs 와 lint-prose.mjs 를 함께 돌리고 보고서 하나로 낸다.
 *
 * 두 도구를 합치지 않는다 — 그대로 자식 프로세스로 부르고 결과만 merge 한다. check-all.mjs 와
 * 게이트는 지금도 각각을 직접 부르고, 규칙이 어긋나면 check-artifacts.mjs 가 정본이라는 관례가
 * 그 둘이 따로 서 있는 데서 나온다. 여기서 규칙을 다시 구현하면 정본이 셋이 된다.
 *
 * 있는 이유는 대화의 부피다. 문서마다 검사기와 린터의 출력이 따로 대화에 쌓이는데, 사람이 읽는
 * 것은 «오류 몇 건 · 경고 몇 건» 한 줄이다. 도구 호출 둘을 하나로 접는다. */
import { basename, dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { report, SDLC_VERSION, SUPPORTED_SCHEMA_VERSIONS } from './artifact-parse.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
if (argv.includes('--version')) {
  console.log(`sdlc-runtime ${SDLC_VERSION}; schemas ${SUPPORTED_SCHEMA_VERSIONS.join(',')}`)
  process.exit(0)
}
const STRICT = argv.includes('--strict')
const DIR = resolve(argv.find((a) => !a.startsWith('--')) ?? '.')

// 검사기를 먼저 둔다. 두 도구가 같은 자리를 다르게 말하면 check-artifacts.mjs 가 정본이므로
// 합친 목록에서도 그쪽이 먼저 읽혀야 한다.
const TOOLS = [
  { tool: 'check', file: 'check-artifacts.mjs' },
  { tool: 'lint', file: 'lint-prose.mjs' },
]

// 형제 도구는 이 파일이 있는 폴더에서 부른다. 프로필이 `.claude/sdlc` 사본을 지목했는데 여기서
// 전역 사본을 부르면 한 문서의 판정이 두 사본으로 갈린다 — 벤더링이 막으려던 바로 그 일이다.
// `--strict` 는 자식에게 넘기지 않는다. 넘기면 경고만 있는 실행도 종료 코드 1 이 되어
// «오류가 있다» 와 구분되지 않고, 경고를 실패로 볼지는 여기서 report() 가 한 번만 정한다.
const runs = TOOLS.map(({ tool, file }) => {
  const r = spawnSync(process.execPath, [join(HERE, file), DIR, '--json'], { encoding: 'utf8' })
  let json = null
  try { json = JSON.parse(r.stdout ?? '') } catch { /* 아래에서 미검사로 다룬다 */ }
  // 자식의 종료 코드 2 는 «판정하지 못했다» 는 뜻으로만 쓴다(프로필의 lang 을 모르는 경우 등).
  // JSON 이 없으면 예외로 죽은 것이다. 어느 쪽이든 통과로 접으면 «검사가 꺼진 것» 과 «통과» 가
  // 같아진다 — 이 런타임이 다른 자리에서 계속 금지하는 실패 방식이다.
  const broken = r.status === 2 || r.status == null || json?.version !== 1 || !Array.isArray(json.problems)
  return { tool, file, code: r.status, json, broken, raw: ((r.stdout ?? '') + (r.stderr ?? '')).trim() }
})

const broken = runs.filter((r) => r.broken)
if (broken.length) {
  for (const b of broken) {
    console.error(`${b.file} 를 실행하지 못했다 (종료 코드 ${b.code ?? '신호'}) — 이 폴더는 미검사다. 통과가 아니다.`)
    if (b.raw) console.error(b.raw)
  }
  process.exit(2)
}

// 어느 권위가 말했는지 남긴다. 합친 뒤에는 규칙 이름만으로 갈라낼 수 없다.
const problems = runs.flatMap((r) => r.json.problems.map((p) => ({ ...p, tool: r.tool })))

// 두 도구가 같은 note(«산출물 schema v7 · runtime 7»)를 내므로 같은 문장은 한 번만 싣는다.
// 자식의 제목에는 티어·문서 수·ID 수가 들어 있어 버리면 세트의 규모가 보고서에서 사라진다.
const notes = [...new Set([
  ...runs.map((r) => r.json.title).filter(Boolean),
  ...runs.flatMap((r) => r.json.notes ?? []),
])]

process.exit(report({
  json: argv.includes('--json'),
  title: `산출물 검사 — ${basename(DIR)}`,
  notes,
  problems,
  strict: STRICT,
  ruleDoc: '`conventions.md` 의 «티어» · «ID 접두» · «상태와 승인» · «산출물 문법» 절과 `references/prose.md` 에 있다. 둘이 어긋나면 check-artifacts.mjs 가 정본이다.',
}))
