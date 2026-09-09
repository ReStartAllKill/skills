---
artifact: finding
schema_version: 4
id: "FND-YYYY-NNN"
title: "<무엇이 관측되었는지 한 문장으로>"
status: draft # draft | in_review(분류 중) | accepted(경로 확정) | rejected(기각) | superseded
tier: light # 기본은 light — 사람 없는 자리에서 쓰이는 문서다
owner: "<서비스 소유자 또는 온콜>"
created: YYYY-MM-DD
updated: YYYY-MM-DD
detected_at: "YYYY-MM-DDTHH:MM:SSZ" # 신호가 난 시각(발견한 시각이 아니다)
trigger: band_breach # band_breach | scheduled_scan | ticket | channel | manual
band: null # trigger 가 band_breach 면 필수 — .claude/bands.yml 의 밴드 id
autonomy_tier: diagnose # log | diagnose | propose — 이 발화가 **허용한** 범위
routed_to: null # accepted 면 필수: "patch:<PR>" | "intent:<경로>" | "dismiss:<사유>"
                # Resolve the intent path from this file's directory. The intent's from_finding
                # resolves from its own directory, so each link uses its document as the base.
                # Example: "intent:../../2026-09-04-search-exclude-archived/intent.md"
superseded_by: null
generated_by: null
generated_from: null
skills_in_force: []
---

# Finding: <제목>

<!-- Three ways out: patch, intent, dismiss. How to fix it is not settled here. Keep §Observations
     (what was measured) apart from §Diagnosis (what is guessed). -->

## 요약 `[필수 · 모든 티어]`

<무엇이 · 언제 · 어디서. 3문장을 넘기지 않는다.>

## 발화 `[필수 · 모든 티어]`

<!-- Who or what started this. -->

발화: <band_breach / scheduled_scan / ticket / channel / manual> — <탐지 스크립트·스캔·티켓·스레드>
밴드: <프런트매터의 band 와 같은 id> — <등록부가 말하는 metric · window · rule>
자율 티어: <log / diagnose / propose>
그것이 허용한 것: <구체적으로 — 읽기 도구만 / PR 열기까지 / 런북 <이름> 호출까지>

## 관측 `[필수 · 모든 티어]`

<!-- Only what was measured. Reproduce with a query or a command. What was not measured is «unmeasured». -->

### EV-001 — <잰 것>

<실측 값> vs <기준/밴드>
재현: `<질의 또는 명령>`
시각: <ISO>

### EV-002 — <함께 움직인 다른 신호>

<실측 값> vs <기준/밴드>
재현: `<질의 또는 명령>`
시각: <ISO>

## 진단 `[필수 · 모든 티어]`

<!-- The model's reading. A hypothesis points at EV ids and carries a way to disprove it. -->

### HYP-001 — <원인에 대한 판정>

근거: EV-001, EV-002
확신도: <높음/중간/낮음> · 상태: <검토 중/확인됨/기각>

반증: <이것이 참이면 관측되지 않을 것>

### 못 본 것

<!-- What has no record was not looked at. -->

- <예: 배포 전후 30분의 애플리케이션 로그는 보존 기간이 지나 조회하지 못했다.>

## 취한 조치 `[필수 · 모든 티어]`

<!-- What was actually done, and what was not. The second matters more in an audit. -->

- <ISO> <조치> — 허용 근거: 자율 티어 <값> · 결과: <무엇을 알게 됐나>

### 하지 않은 것

- <예: revert PR 을 열지 않았다 — 자율 티어가 diagnose 라 propose 경로가 닫혀 있다.>

## 경로 판정 `[필수 · 모든 티어]`

<!-- Choose by size. When unsure, intent. When dismissing, say whether the band moves. -->

경로: <patch / intent / dismiss>
근거: HYP-001
다음 산출물: <PR 링크 / intent.md 경로(시작 티어 light|standard|full) / 밴드 조정 내용>

기각이면 — 밴드 조정: <무엇을 어떻게 또는 «조정 없음 — <근거>»> · 다시 서면: <그때는 무엇이 달라지나>

<!-- If the band moved, record it under `revised:` in bands.yml too — the checker reads both directions. -->

## 재발 방지 `[필수 · 모든 티어]`

<!-- An eval case, a test, a hook or a band adjustment for this class. Needed on the patch route too. -->

- 부류: <이 발견이 속한 결함 부류> → <eval 케이스 / 테스트 / 훅 / 밴드 조정> · <경로> · <언제>

## 열린 질문 `[필수 · 모든 티어]`

<!-- A question that stops the route from being settled is `blocked`. If none, write `N/A — <basis>`. -->

### FQ-001 — <경로를 가르는 질문>

영향: <막힘/높음/낮음> · 담당: <이름> · 상태: Open

## 영향 `[필수 · standard+]`

- <사용자군/시스템> — <무엇이 안 됐나> · 규모 <건수/비율> · <시작~복구> · 근거 EV-001

## 타임라인 `[필수 · standard+]`

- <ISO> <밴드 breach> — <탐지 스크립트 로그>
- <ISO> <진단 시작> — <실행 기록>
- <ISO> <경로 확정> — <이 문서의 커밋>

## 분류와 변경 이력 `[필수 · standard+]`

- <역할> <이름> — <즉시 수정 / 일정에 넣음 / 기각>, YYYY-MM-DD. <의견>

### 변경 이력

- YYYY-MM-DD <이름 또는 Agent> — 자동 생성. <발화>
