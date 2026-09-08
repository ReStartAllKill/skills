/** SKILL.md가 있는 디렉터리를 기준으로 스킬을 탐색한다. */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/** 상위 디렉터리에서 skills를 찾고, 없으면 오류를 낸다. */
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

/** skills 아래의 스킬 디렉터리를 반환한다. */
export function findSkillDirs(from, maxDepth = 3) {
  const root = skillsRoot(from)
  const out = []
  const walk = (dir, depth) => {
    if (depth > maxDepth) return
    if (existsSync(join(dir, 'SKILL.md'))) { out.push({ name: dir.split('/').pop(), dir }); return }
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      // 평가 픽스처와 의존성 디렉터리는 탐색에서 제외한다.
      if (e.name === 'evals' || e.name === 'node_modules') continue
      if (e.isDirectory() && !e.name.startsWith('.')) walk(join(dir, e.name), depth + 1)
    }
  }
  walk(root, 0)
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/** 이름에 해당하는 스킬이 없으면 오류를 낸다. */
export function findSkill(name, from) {
  const hit = findSkillDirs(from).find((s) => s.name === name)
  if (!hit) throw new Error(`스킬 «${name}» 을 못 찾았다 (${skillsRoot(from)} 아래)`)
  return hit.dir
}
