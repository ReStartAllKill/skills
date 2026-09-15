---
artifact: research
schema_version: 7
id: "RSH-YYYY-NNN"
title: "<무엇을 무엇과 비교했는지 드러나는 제목>"
status: draft # draft | in_review(읽어 달라는 상태) | reviewed(사람이 읽었다)
question: "<이 조사가 쓰일 결정 한 줄 — 무엇을 정하려고 읽었나>"
owner: "<이 조사를 지고 가는 사람>"
supersedes: null # 같은 질문의 옛 조사가 있으면 그 id
reviewed_by: null # 읽은 사람. 승인이 아니다 — 조사에는 approved_by 도 tier 도 없다
generated_by: null
---

# Research: <제목>

<!-- Evidence, not a decision. What gets chosen belongs in the ADR or intent that cites this.
     The question and the criteria are written **before** the search: criteria written after the
     sources are criteria fitted to a conclusion. Research goes stale, so every source carries the
     date it was read. Delete every guide comment and <> placeholder before submitting. -->

## 질문

<!-- The decision this serves, and which scope was actually available — the web, this repository,
     code only. A scope that is not stated is read as «everything was searched». -->

<무엇을 정하려고 읽었나. 읽을 수 있었던 범위는 무엇이었나.>

## 기준

<!-- Written before the search. A criterion is something a source can settle, not a preference.
     Every criterion becomes a row of the comparison table. -->

### CRIT-001 — <무엇으로 재는가>

<이 기준에서 갈리면 결정이 갈리는 이유.>

## 출처

<!-- Recorded the moment it is read. `위치:` is a URL or a repository path, `조회:` the date it was
     read. One to three sentences of what the source actually says, not what it is hoped to say.
     Prefer primary sources — docs, code, changelogs; a secondary source is fine if said to be one.
     What the source *showed* — an architecture or sequence diagram, a code excerpt, a benchmark
     output — goes under the sentences in a fenced block (```mermaid, ```text, ```<language>),
     redrawn or copied from the source, not invented. Fenced blocks count toward no budget and no
     prose check, so keep the material there and the sentences short. Measured values that compare
     across options go in a table under §자료, not here. -->

### SRC-001 — <읽은 것>

- 위치: <URL 또는 저장소 경로>
- 조회: YYYY-MM-DD

<그 자리가 실제로 하는 말 1~3문장.>

```mermaid
<출처가 보여 준 도식 — 보여 준 것이 없으면 이 블록을 지운다>
```

### SRC-002 — <읽은 것>

- 위치: <URL 또는 저장소 경로>
- 조회: YYYY-MM-DD

<그 자리가 실제로 하는 말 1~3문장.>

## 선택지

<!-- Two or more, each standing on the sources above. An option nobody sourced is an opinion.
     One option is not a comparison — if there was nothing to compare, this is a fact and it goes
     into the spec instead. -->

### OPT-001 — <선택지>

- 근거: SRC-001

<이 선택지가 실제로 무엇인지 한두 문장. 문장으로 안 되는 것 — 호출 모양·설정 발췌·데이터 흐름 — 은
아래에 펜스 블록으로 이 저장소에 어떻게 앉는지 보인다.>

### OPT-002 — <선택지>

- 근거: SRC-002

<이 선택지가 실제로 무엇인지 한두 문장.>

## 자료

<!-- Optional — delete the heading when nothing was measured. Numbers a source reported or this
     investigation measured, one table per measurement, with the thing measured in the first column
     and the SRC-* it came from in the header or a caption. Never an ID in the first column: that
     is an entity table and the linter rejects it. Raw output belongs in a fenced block under the
     SRC-* that produced it; this section holds the values that the comparison reads. -->

| <잰 것> | OPT-001 <선택지> | OPT-002 <선택지> | 출처 |
|---|---:|---:|---|
| <무엇을 어떤 단위로 쟀나> | <값> | <값> | SRC-001 |

## 비교

<!-- The one genuinely two-dimensional place in this document: criteria × options. Every CRIT is a
     row, every OPT a column. A cell nobody could settle is written «모름 — <무엇을 보면 갈리나>»,
     never left blank — a blank cell reads as «no difference». A cell states what was measured and
     cites its SRC-*; the figure it comes from is in §자료 or under that source. -->

| 기준 | OPT-001 <선택지> | OPT-002 <선택지> |
|---|---|---|
| CRIT-001 — <무엇으로 재는가> | <잰 것> (SRC-001) | <잰 것> (SRC-002) |

## 판단

<!-- What the sources mean, in three labelled parts. Mixing them is how an assumption gets quoted
     later as a fact. -->

### REC-001 — <읽은 것이 뜻하는 바>

- 근거: OPT-001

사실: <출처가 적은 것 — SRC-001>. 추론: <거기서 끌어낸 것>. 가정: <확인하지 못한 채 둔 것>.

<!-- Open questions: when any remain, add a `## 열린 질문` heading and one `### RQ-NNN` item per
     question, each saying what would settle it. When none remain, leave no heading — a standing
     `해당 없음` is a line written for the checker rather than for a reader. -->
