/** Discover skills from directories containing SKILL.md. */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/** Find the skills directory in an ancestor, or fail when none exists. */
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

/** Return skill directories below the skills root. */
export function findSkillDirs(from, maxDepth = 3) {
  const root = skillsRoot(from)
  const out = []
  const walk = (dir, depth) => {
    if (depth > maxDepth) return
    if (existsSync(join(dir, 'SKILL.md'))) { out.push({ name: dir.split('/').pop(), dir }); return }
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      // Exclude evaluation fixtures and dependency directories.
      if (e.name === 'evals' || e.name === 'node_modules') continue
      if (e.isDirectory() && !e.name.startsWith('.')) walk(join(dir, e.name), depth + 1)
    }
  }
  walk(root, 0)
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/** Fail when no skill matches the requested name. */
export function findSkill(name, from) {
  const hit = findSkillDirs(from).find((s) => s.name === name)
  if (!hit) throw new Error(`스킬 «${name}» 을 못 찾았다 (${skillsRoot(from)} 아래)`)
  return hit.dir
}
