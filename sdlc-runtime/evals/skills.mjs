/** 스킬을 **찾는다** — 어디에 몇 단으로 놓였는지 박지 않는다.
 *
 *  깊이를 박으면 배치가 바뀐 순간 러너가 케이스를 0개 찾고 «0/0 통과» 를 찍는다. 0개는
 *  전부 통과와 구분되지 않는다. 그래서 «SKILL.md 가 있는 폴더» 하나만 정의로 삼는다.
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/** `from` 에서 위로 올라가며 `skills/` 를 찾는다. 못 찾으면 던진다 — 빈 목록을 조용히
 *  내주면 «찾은 것이 없다» 가 «전부 통과» 로 읽힌다. */
export function skillsRoot(from) {
  let dir = resolve(from)
  for (let i = 0; i < 8; i++) {
    const cand = join(dir, 'skills')
    if (existsSync(cand) && statSync(cand).isDirectory()) return cand
    const up = dirname(dir)
    if (up === dir) break
    dir = up
  }
  throw new Error(`skills/ 를 못 찾았다 (${from} 에서 위로 8단). 평가는 스킬이 있는 트리에서만 돈다.`)
}

/** `skills/` 아래 **SKILL.md 를 가진 폴더**를 전부 낸다. 카테고리로 나눴든 안 나눴든 같다. */
export function findSkillDirs(from, maxDepth = 3) {
  const root = skillsRoot(from)
  const out = []
  const walk = (dir, depth) => {
    if (depth > maxDepth) return
    if (existsSync(join(dir, 'SKILL.md'))) { out.push({ name: dir.split('/').pop(), dir }); return }
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      // `evals/` 는 **픽스처**다 — 그 안의 문서는 스킬이 검사할 대상이지 스킬이 아니다.
      // 내려가면 픽스처가 SKILL.md 모양이 되는 날 그것이 스킬로 실린다.
      if (e.name === 'evals' || e.name === 'node_modules') continue
      if (e.isDirectory() && !e.name.startsWith('.')) walk(join(dir, e.name), depth + 1)
    }
  }
  walk(root, 0)
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/** 이름으로 하나. 없으면 던진다 — 없는 것을 건너뛰면 그 검사가 사라진 줄 아무도 모른다. */
export function findSkill(name, from) {
  const hit = findSkillDirs(from).find((s) => s.name === name)
  if (!hit) throw new Error(`스킬 «${name}» 을 못 찾았다 (${skillsRoot(from)} 아래)`)
  return hit.dir
}
