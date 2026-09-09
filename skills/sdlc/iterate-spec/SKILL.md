---
name: iterate-spec
description: '기존 의도·명세·계획에 피드백, 리뷰 결과, 요구사항 변경을 반영한다. 기존 문서를 검토하거나 수정할 때 사용하며, 변경에 필요한 범위만 갱신한다.'
---

# 명세 수정

사용법: `/iterate-spec <명세 경로> <피드백 또는 변경 내용>`

기존 산출물 체인에 피드백을 반영한다. 변경에 필요한 부분만 조사하고 수정한다.

## 1. 영향 분석

1. `.claude/spec-profile.yml`과 관련 intent·spec·plan을 읽는다. `from_finding`이 있으면
   해당 finding도 읽는다. 런타임 탐색 순서는 `${CLAUDE_PLUGIN_ROOT}/sdlc-runtime/references/runtime.md`를 따른다.
2. 런타임의 `conventions.md`, `references/schema.md`를 읽는다. 작업 수정에는
   `references/tasks.md`, 문장 수정에는 `references/prose.md`를 추가로 읽는다.
3. 체크박스·실행 기록과 `plan-progress.mjs` 결과를 대조해 완료된 작업을 확인한다.

| 변경 내용 | 수정 대상 | 후속 갱신 |
|---|---|---|
| 목적·제약 | intent | 관련 OUT/CON을 참조하는 spec·plan |
| 외부 동작 | spec | 관련 FR/NFR을 구현하는 작업 |
| 구현 방법 | plan의 설계 결정 | 관련 작업 |
| 작업 분할·순서 | plan의 작업 | 의존 관계와 실행 레벨 |

폴더에 `upstream.lock.json`이 있으면 `intent.md`·`spec.md`는 **벤더한 사본**이다. 여기서 고치지
않는다 — 상류 문서 레포에서 `/iterate-spec`으로 고치고, 소비 레포에서
`node <sdlc_runtime>/tools/pull-spec.mjs <산출물 디렉터리>`로 다시 끌어온 뒤 `plan`과
`spec_version`을 맞춘다. 사본을 직접 고치면 해시가 어긋나 게이트가 막는다.

의미가 바뀐 문서와 영향을 받는 하위 문서는 `in_review`로 되돌린다. 위험 등급(`tier`)이
높아졌다면 intent부터 수정한다. 오탈자 수정은 상태를 유지한다.
상위 문서를 커밋한 뒤 하위 문서가 참조하는 버전을 갱신한다.

## 2. 변경안 검토

이미 확인한 근거는 다시 조사하지 않는다. 추가 조사가 필요하면 프로필의 `pattern_agent`나
읽기 도구를 사용한다. 구현·감사 에이전트는 실행하지 않는다.

바뀔 요구사항·작업·릴리스 영향과 기존 완료 작업에 미치는 영향을 구체적으로 보여준다.
사용자가 요청한 반영 범위는 진행하고, 미결정된 제품 판단이나 범위 확대가 있을 때만 확인한다.

## 3. 반영과 검증

1. 해당 항목만 수정한다. 완료된 작업은 삭제하거나 의미를 바꾸지 않는다.
   롤백이나 추가 변경은 새 작업으로 기록한다. 삭제한 ID는 재사용하지 않는다.
2. 「실행 기록」의 변경 기록에 변경 이유와 영향을 받는 ID를 남긴다.
3. `node <sdlc_runtime>/tools/check-artifacts.mjs <명세 디렉터리>`와
   `node <sdlc_runtime>/tools/lint-prose.mjs <명세 디렉터리>`를 실행한다.
   상위 문서의 참조 버전, Must 요구사항과 작업의 연결, 같은 실행 레벨의 파일 충돌을 확인한다.
4. 오류를 해결한 뒤 공통 절차에 따라 필요한 재승인을 처리한다. 실행 중이던 plan은 재승인 직후
   `in_progress`로 복원하고 같은 커밋에 포함한다. `accepted`는 실행 전 상태이므로 완료된 작업이
   있는 plan을 이 상태로 남기면 진행 상태 검사에서 오류가 발생한다.
5. `node <sdlc_runtime>/tools/plan-progress.mjs <명세 디렉터리>`를 실행해
   체크박스·커밋·검증 기록·상태가 일치하는지 최종 확인한다.

## 보고

문서 경로, 변경 요약, 상태, 검사기·린터의 오류와 경고 수, 재검증이 필요한 작업을 보고한다.
구현을 재개할 수 있으면 `/implement-spec <경로>`를 안내한다.
