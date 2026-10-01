#!/usr/bin/env node
/** Decide whether a Bash command rewrites an artifact's approval fields.
 *
 * This is a best-effort local defence, not a security boundary: shell cannot be parsed fully
 * without running it, and nothing here tries. The Edit/Write branch can show the edit in an
 * approval dialog; a shell line cannot, so a recognised approval rewrite is refused outright.
 *
 * The verdict needs three facts at once. Matching tool words as substrings of the whole command
 * was rejected: `superseded`, `closed` and `based` contain «sed», `committee` contains «tee», and
 * a commit message that merely mentions «status accepted» was refused. The facts are:
 *   1. a writer — the command word of some segment (split on ; && || | & ( ) and newlines,
 *      wrappers such as env/sudo/xargs skipped, `bash -c`/`eval` scripts and `$(…)` scanned
 *      as well) that can write a file, or an output redirection. An interpreter counts only
 *      when the command carries its program (inline flag, heredoc, here-string, pipe into a
 *      bare interpreter), never for a script it merely names — see `interprets`;
 *   2. the approval-field pattern, kept as the shell guard had it;
 *   3. a path that is an artifact of this repository by the same rule as `sdlc_resolve`:
 *      intent.md, spec.md or plan.md under spec_dir, or ADR-NNN-*.md under adr_dir.
 *      finding.md is exempt there and research.md has no approval transition, so both are
 *      left out here too.
 *
 * When writer and pattern are present but the command names no recognisable file at all —
 * typically a variable (`sed -i … "$f"`) — or the writer gets its files from xargs or
 * `find -exec`, the target is unknown and the command is refused,
 * as the old guard refused it. Passing it would make variable indirection a silent way round
 * the guard that the substring rule did not have. A command whose paths are all recognisably
 * outside the artifact tree (a /tmp scratch file, an eval fixture) passes. Not covered: a path
 * reached through a variable while another, harmless path is named, `cd` before a relative
 * path, sed's `w` command, files written by a script the command only names. CI's structural
 * check and review remain the backstop. */
import { existsSync } from 'node:fs'
import { resolve, basename, join, sep } from 'node:path'
import { homedir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { readProfile } from './profile.mjs'

const BLOCKED = `승인 필드를 Bash 로 바꾸려는 모델 호출을 막았다.

승인 전이는 Edit 도구로 시도한다 — 그러면 가드가 승인 다이얼로그를 띄우고 사람이 그 자리에서
승인하거나 거절한다. 사용자가 승인 명령을 손으로 칠 필요는 없다. 셸 한 줄은 다이얼로그에
보여줄 편집 내용이 없어 여기서는 언제나 막는다. 셸 전체를 판정하는 보안 경계는 아니므로
CI 의 구조 검사와 리뷰를 함께 쓴다.`

// Same pattern as the shell guard had, with one widening: a quoted value (`approved_by: "lee"`,
// which is how YAML usually carries it) used to slip through because the quote was the first
// character. A quote followed by a metacharacter is still a search pattern. The quote may arrive
// escaped — `echo "approved_by: \"lee\"" >> plan.md` is how it is written inside double quotes —
// so a backslash is taken with the quote it escapes, and only with one: a bare backslash opens a
// regex group on sed's search side.
function approvalPattern(command) {
  if (/status[\s\S]*accepted/.test(command)) return true
  // Each approved_by is judged on its own: a `null` elsewhere in the command must not excuse
  // `s/approved_by: null/approved_by: 이름/`. A value whose first character is a regex or shell
  // metacharacter is sed's search side, not a value.
  const value = /approved_by(?:\\?["'])?\s*:\s*(?:\\?["'])?[^\s.*^$/\\,;)}"'][^\s,;)}"'/\\]*/g
  return [...command.matchAll(value)].some(([m]) => !/:\s*(?:\\?["'])?(null|~)$/.test(m))
}

/** Split a command into segments of words and redirection targets. Quotes, backslashes,
 * comments, heredoc bodies, `$(…)` and backticks are understood; anything subtler is not. */
function scan(src) {
  const segments = []
  let i = 0
  const run = (closer) => {
    // piped: stdin comes from the previous segment; stdin: a heredoc or here-string feeds it.
    let words = [], redirects = [], word = null, expect = null, heredocs = [], piped = false, stdin = false
    const open = () => (word ??= { text: '', dynamic: false })
    const endWord = () => {
      if (word === null) return
      if (expect === 'target') redirects.push(word)
      else if (expect === 'heredoc') heredocs.push({ delim: word.text, strip: word.strip })
      else if (expect !== 'skip') words.push(word)
      word = null; expect = null
    }
    const endSegment = () => {
      endWord()
      if (words.length || redirects.length) segments.push({ words, redirects, piped, stdin })
      words = []; redirects = []; piped = false; stdin = false
    }
    const substitution = (end) => { open().dynamic = true; const w = word; word = null; run(end); word = w }
    const bodies = () => {
      for (const { delim, strip } of heredocs) {
        while (i < src.length) {
          const nl = src.indexOf('\n', i), line = src.slice(i, nl < 0 ? src.length : nl)
          i = nl < 0 ? src.length : nl + 1
          if ((strip ? line.replace(/^\t+/, '') : line) === delim) break
        }
      }
      heredocs = []
    }
    let quote = null
    while (i < src.length) {
      const c = src[i]
      if (quote === "'") { if (c === "'") quote = null; else open().text += c; i++; continue }
      if (quote === '"') {
        if (c === '"') { quote = null; i++; continue }
        if (c === '\\' && i + 1 < src.length) { open().text += src[i + 1]; i += 2; continue }
        if (c === '$' && src[i + 1] === '(') { i += 2; substitution(')'); continue }
        if (c === '`') { i++; substitution('`'); continue }
        if (c === '$') open().dynamic = true
        open().text += c; i++; continue
      }
      if (closer && c === closer) { i++; endSegment(); return }
      if (c === '\\') { if (src[i + 1] !== '\n') open().text += src[i + 1] ?? ''; i += 2; continue }
      if (c === "'" || c === '"') { quote = c; open(); i++; continue }
      if (c === '$' && src[i + 1] === '(') { i += 2; substitution(')'); continue }
      if (c === '`') { i++; substitution('`'); continue }
      if (c === '#' && word === null) { while (i < src.length && src[i] !== '\n') i++; continue }
      if (c === '\n') { endSegment(); i++; bodies(); continue }
      if (c === '&' && src[i + 1] === '>') { endWord(); i += src[i + 2] === '>' ? 3 : 2; expect = 'target'; continue }
      if ((c === '|' || c === '&') && src[i + 1] === c) { endSegment(); i += 2; continue }
      if (';&|()'.includes(c)) { endSegment(); piped = c === '|'; i++; if (src[i] === '&') i++; continue }
      if (c === '>' || c === '<') {
        if (word && /^\d+$/.test(word.text)) word = null // the fd number of 2>, not an argument
        endWord(); i++
        if (c === '>') {
          if (src[i] === '>' || src[i] === '|') i++
          else if (src[i] === '&') {
            i++
            if (/[\d-]/.test(src[i] ?? '')) { while (/[\d-]/.test(src[i] ?? '')) i++; continue } // 2>&1
          }
          expect = 'target'; continue
        }
        if (src[i] === '<') {
          i++
          stdin = true
          if (src[i] === '<') { i++; expect = 'skip'; continue } // here-string: data, not a file
          const strip = src[i] === '-'; if (strip) i++
          while (src[i] === ' ' || src[i] === '\t') i++
          expect = 'heredoc'; open().strip = strip; continue
        }
        if (src[i] === '&') { i++; while (/[\d-]/.test(src[i] ?? '')) i++; continue }
        if (src[i] === '>') { i++; expect = 'target'; continue } // <> opens for writing
        expect = 'skip'; continue
      }
      if (/\s/.test(c)) { endWord(); i++; continue }
      if (c === '$') open().dynamic = true
      open().text += c; i++
    }
    endSegment()
    bodies()
  }
  run(null)
  return segments
}

const WRAPPERS = new Set(['sudo', 'doas', 'env', 'command', 'builtin', 'exec', 'nice', 'nohup', 'time', 'timeout', 'xargs', 'stdbuf'])
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh'])
const INTERPRETERS = /^(python[\d.]*|node|deno|bun|perl|ruby|php)$/
const AWK = new Set(['awk', 'gawk', 'mawk', 'nawk'])
const inPlace = (args) => args.some((a) => /^-[a-zA-Z]*i/.test(a) || a.startsWith('--in-place') || a === '--inplace')

/** Command words of a segment, with wrappers peeled, `find -exec` followed, and shell scripts
 * given to `bash -c` or `eval` scanned in turn. A command run by xargs or find gets its files
 * from them, not from its own words, so it is marked `indirect`. */
function commands(segment, out = [], indirect = false) {
  const words = segment.words.map((w) => w.text)
  let k = 0
  for (;;) {
    while (k < words.length && /^[A-Za-z_]\w*=/.test(words[k])) k++
    if (k < words.length && WRAPPERS.has(basename(words[k]))) {
      if (basename(words[k]) === 'xargs') indirect = true
      k++
      while (k < words.length && (/^-/.test(words[k]) || /^\d+[smhd]?$/.test(words[k]))) k++
      continue
    }
    break
  }
  if (k >= words.length) return out
  const name = basename(words[k]), args = words.slice(k + 1)
  if (name === 'eval') { for (const s of scan(args.join(' '))) commands(s, out, indirect); return out }
  if (SHELLS.has(name)) {
    const c = args.findIndex((a) => /^-[a-zA-Z]*c$/.test(a))
    if (c >= 0 && args[c + 1] !== undefined) for (const s of scan(args[c + 1])) commands(s, out, indirect)
    return out
  }
  if (name === 'find') {
    const x = args.findIndex((a) => ['-exec', '-execdir', '-ok', '-okdir'].includes(a))
    if (x >= 0) commands({ words: segment.words.slice(k + 2 + x), redirects: [] }, out, true)
  }
  out.push({ name, args, indirect, stdin: Boolean(segment.piped || segment.stdin) })
  return out
}

// The flags that put a program on the command line, per interpreter. php's -B/-R/-E run code per
// input line; deno takes `eval` as a subcommand rather than a flag.
const INLINE = {
  python: (o) => /^-[A-Za-z]*c/.test(o),
  node: (o) => /^-[A-Za-z]*[ep]$/.test(o) || /^--(eval|print)(=|$)/.test(o),
  bun: (o) => /^-[A-Za-z]*[ep]$/.test(o) || /^--(eval|print)(=|$)/.test(o),
  perl: (o) => /^-[A-Za-z]*[eE]/.test(o),
  ruby: (o) => /^-[A-Za-z]*e/.test(o),
  php: (o) => /^-[A-Za-z]*[rBRE]$/.test(o),
  deno: () => false,
}

/** An interpreter writes only when the command carries its program: an inline flag, or a
 * program arriving on stdin. A named script was rejected as a writer: a script that rewrites an
 * approval carries the approval words in its file, not in the command, so the guard never sees
 * them anyway — while `node tools/pin.mjs intent.md && grep "status: accepted" spec.md`, the
 * shape skills run, was refused. A bare interpreter fed by a pipe (`cat x | python3`) is taken
 * as writing: what the pipe carries cannot be told apart from the rest of the command. */
function interprets({ name, args, stdin }) {
  const kind = /^python[\d.]*$/.test(name) ? 'python' : name
  const options = [], operands = []
  for (const a of args) (operands.length || !a.startsWith('-') || a === '-' ? operands : options).push(a)
  if (options.some(INLINE[kind])) return true
  if (kind === 'deno') return operands[0] === 'eval' || (stdin && operands[0] === 'run' && operands[1] === '-')
  return stdin && (operands.length === 0 || operands[0] === '-')
}

function writes(c) {
  const { name, args } = c
  if (name === 'sed' || name === 'gsed') return inPlace(args)
  if (AWK.has(name)) return args.includes('inplace') || args.includes('--inplace') ||
    args.some((a) => /\bprintf?\b[^;}]*>/.test(a))
  // perl -ne / -pe without -i is a stream filter printing to stdout.
  if (name === 'perl' || name === 'ruby') {
    if (inPlace(args)) return true
    if (args.some((a) => /^-[a-zA-Z]*[np]/.test(a))) return false
  }
  if (INTERPRETERS.test(name)) return interprets(c)
  return name === 'apply_patch'
}

// Only files with one of these extensions count as «a recognisable path» when a command names no
// artifact. `module.attr` in an inline script (sys.argv, fs.writeFileSync) is not a path, and
// counting it would let `python3 -c "…" "$f"` pass on the strength of `sys.argv`.
const FILE = /\.(md|markdown|txt|ya?ml|json|jsonl|toml|ini|cfg|csv|log|html?|xml|[cm]?[jt]s|py|rb|pl|sh|bak|tmp)$/i
const ARTIFACT = /^((intent|spec|plan)\.md|ADR-\d{3,4}-.+\.md)$/
const SPECIAL = /^\/dev\/(null|stdout|stderr|tty|fd\/\d+)$/

/** Repository context; null when there is no profile, i.e. nothing for this guard to protect. */
function context(event) {
  const cwd = event.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd()
  let root = process.env.CLAUDE_PROJECT_DIR || ''
  if (!root) {
    const g = spawnSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' })
    root = g.status === 0 ? g.stdout.trim() : ''
  }
  if (!root || !existsSync(join(root, '.claude/spec-profile.yml'))) return null
  const profile = readProfile(root)
  return { cwd, root, worktrees: String(profile.get('worktree_dir', '.claude/worktrees')), profile }
}

/** The same decision `sdlc_resolve` makes for the Edit/Write branch, including the worktree
 * that owns the path. */
function isArtifact(abs, ctx) {
  const name = basename(abs)
  if (!ARTIFACT.test(name)) return false
  const within = (dir) => abs.startsWith(dir.endsWith(sep) ? dir : dir + sep)
  let tree = ctx.root, profile = ctx.profile
  const wt = resolve(ctx.root, ctx.worktrees)
  if (within(wt)) {
    const own = abs.slice(wt.length + 1).split(sep)
    if (own.length > 1) {
      tree = join(wt, own[0])
      if (existsSync(join(tree, '.claude/spec-profile.yml'))) profile = readProfile(tree)
    }
  }
  if (name.startsWith('ADR-')) {
    const adr = profile.get('adr_dir', '')
    return Boolean(adr) && within(resolve(tree, String(adr)))
  }
  const specs = resolve(tree, String(profile.get('spec_dir', '.sdlc/specs')))
  return within(specs) && abs.length - specs.length > name.length + 1
}

/** Every path-shaped run of characters in the command — heredoc bodies and inline scripts
 * included, which is how `open('.sdlc/…/spec.md','w')` is seen. */
function paths(command, extra) {
  const runs = command.match(/[^\s'"`=(),;|&<>{}[\]]+/g) ?? []
  return [...runs, ...extra]
}

function decide(event) {
  const command = event.tool_input?.command ?? ''
  if (!approvalPattern(command)) return { block: false }
  const ctx = context(event)
  if (!ctx) return { block: false }
  const home = homedir()
  const places = (p) => {
    const t = p.startsWith('~/') ? join(home, p.slice(2)) : p
    return t.startsWith('/') ? [resolve(t)] : [resolve(ctx.cwd, t), resolve(ctx.root, t)]
  }
  // A dynamic path cannot be resolved; one whose last component is an artifact name is taken as
  // an artifact, since that is the safe reading of `"$dir/intent.md"`.
  const artifact = (p) => p.includes('$') ? ARTIFACT.test(basename(p)) : places(p).some((a) => isArtifact(a, ctx))
  const known = (p) => !p.includes('$') && !p.startsWith('-') && (FILE.test(p) || SPECIAL.test(p))

  const segments = scan(command)
  const named = segments.flatMap((s) => commands(s))
  const targets = segments.flatMap((s) => s.redirects.map((w) => (w.dynamic ? '$' : '') + w.text))
  const tees = named.filter((c) => c.name === 'tee').flatMap((c) => c.args.filter((a) => !a.startsWith('-')))
  // A redirection or tee into a scratch file or /dev/null writes nothing that matters; one into
  // an artifact, or into a target that cannot be read, does.
  const sink = (p) => !SPECIAL.test(p) && (artifact(p) || !known(p))
  const writer = named.some(writes) || targets.some(sink) || tees.some(sink)
  if (!writer) return { block: false }

  const found = paths(command, [...targets, ...tees])
  const hits = [...new Set(found.filter(artifact))]
  if (hits.length) return { block: true, reason: `대상 산출물: ${hits.join(', ')}` }
  if (!found.some(known) || named.some((c) => c.indirect && writes(c))) {
    return { block: true, reason: '쓰는 대상 파일을 명령에서 알아볼 수 없다 — 변수나 xargs·find 로 지목한 파일은 산출물로 본다.' }
  }
  return { block: false }
}

try {
  const verdict = decide(JSON.parse(process.env.SDLC_HOOK_JSON || '{}'))
  if (verdict.block) { console.error(`${BLOCKED}\n\n${verdict.reason}`); process.exit(2) }
} catch (e) {
  // Only commands carrying the approval pattern get this far; one the scanner cannot read is not
  // evidence that it is harmless.
  console.error(`${BLOCKED}\n\n승인 가드가 명령을 해석하지 못했다 — ${e.message}`); process.exit(2)
}
