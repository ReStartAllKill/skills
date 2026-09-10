#!/usr/bin/env node
/** Print the body pin of an upstream artifact, for `intent_version` · `spec_version` (schema 7).
 *  The checker compares with the same `bodyPin`, so the value is never typed by hand — a pin
 *  copied by eye is indistinguishable from a stale one. */
import { readFileSync, existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { bodyPin, frontmatter } from './artifact-parse.mjs'

const target = process.argv.slice(2).find((a) => !a.startsWith('--'))
const fail = (msg) => { console.error(msg); process.exit(2) }

if (!target) fail('사용법: pin.mjs <문서.md> — 그 문서의 본문 해시를 찍는다.')
const path = resolve(target)
if (!existsSync(path) || !statSync(path).isFile()) fail(`파일이 없다 — ${path}`)
const text = readFileSync(path, 'utf8')
if (!frontmatter(text)) fail(`프런트매터가 없다 — ${path} 는 산출물이 아니다.`)
console.log(bodyPin(text))
