/** Repository-relative task scopes. Containment also covers files not created yet. */
import { posix } from 'node:path'

export const normalizeTaskPath = (path) => posix.normalize(String(path).trim()).replace(/\/$/, '') || '.'
export const validTaskPath = (path) => {
  const p = normalizeTaskPath(path)
  return !!path && !p.startsWith('/') && p !== '..' && !p.startsWith('../') &&
    !/^[A-Za-z]:/.test(p) && !/[\\\0\r\n]/.test(p) && !p.startsWith(':')
}
export const containsTaskPath = (scope, file) => {
  const a = normalizeTaskPath(scope), b = normalizeTaskPath(file)
  return a === '.' || a === b || b.startsWith(a + '/')
}
export const inTaskScope = (scopes, file) => scopes.some((scope) => containsTaskPath(scope, file))
export const overlappingTaskPaths = (left, right) => [...new Set(left.flatMap((a) => right
  .filter((b) => containsTaskPath(a, b) || containsTaskPath(b, a))
  .map((b) => containsTaskPath(a, b) ? normalizeTaskPath(b) : normalizeTaskPath(a))))]
export const taskFiles = (task) => {
  const value = task.fields.get('files') ?? ''
  const quoted = [...value.matchAll(/`([^`]+)`/g)].map((m) => m[1].trim())
  return (quoted.length ? quoted : value.split(',')).map((s) => s.trim()).filter(Boolean)
}
