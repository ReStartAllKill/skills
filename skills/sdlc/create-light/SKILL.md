---
name: create-light
description: '되돌리기 쉬운 작은 변경의 intent·spec·plan 세 문서를 한 번에 쓰고 한 번에 검사·승인·커밋한다. light 티어 기준을 넘는 변경이면 /create-intent 로 안내한다.'
---

# 가벼운 변경의 한 번 통과

사용법: `/create-light <주제 · 티켓 · finding 경로>`

파일 두 개짜리 변경에도 세 스킬 경로는 지시문 세 번 읽기, 도구 열두 번 실행, 커밋 세 번을
요구한다. 이 스킬은 계약도 검사기도 증거 사슬도 그대로 두고 그 반복만 걷어낸다.
**문서를 건너뛰는 길이 아니다** — 세 문서는 그대로 쓰고, 검사기·린터도 그대로 통과해야 하며,
`approval_mode: batch_light`인 저장소는 세 문서를 한 묶음으로 검토하고 승인한다.
설정이 없으면 기존의 문서별 승인 다이얼로그를 유지한다.

## 절차

시작·검사·승인은 `<sdlc_runtime>/conventions.md`의 「Shared skill procedure」를 따른다.
아래에는 그 단계를 어디서 묶는지와 이 경로에만 있는 것만 적는다.

0. 프로필을 읽는다. `sdlc_version`이 7 미만이면 여기서 멈춘다 — 본문 핀(`body:`)이 없으면 상위를
   먼저 커밋해야 하위 버전을 적을 수 있어 커밋 세 번을 피할 수 없다. `/create-intent`로 진행하거나
   `node <sdlc_runtime>/tools/migrate-schema.mjs`로 프로필을 올리라고 안내한다.
   `<sdlc_runtime>/conventions.md`와 `references/tasks.md`를 읽는다 — `references/prose.md`는
   검사가 낸 문체 경고를 해석해야 할 때만 읽는다.
1. 규약 「티어」의 기준으로 등급을 판단한다. 외부 계약이나 데이터가 바뀌거나 즉시 되돌릴 수단이
   없으면 light가 아니다 — 멈추고 `/create-intent`를 안내하며 어느 기준에 걸렸는지 한 줄로 적는다.
   입력이 finding 경로면 `from_finding`과 finding의 `routed_to`를 `/create-intent`와 같은 방식으로
   잇는다(두 경로는 각자 자기 문서의 폴더 기준이고 같은 쌍을 가리켜야 한다).
2. 코드가 답하는 것은 조사하고 제품 판단만 묻는다. 질문은 한 번에 3개 이내로 묶고 한 번만 묻는다.
3. 세 문서를 `<spec_dir>/<YYYY-MM-DD>-<slug>/`에 쓴다. 템플릿은 각 스킬의 것을 그대로 쓴다 —
   `${CLAUDE_PLUGIN_ROOT}/skills/sdlc/create-intent/assets/<lang>/intent-template.md`,
   `.../create-spec/assets/<lang>/spec-template.md`,
   `.../create-plan/assets/<lang>/plan-template.md`.
   `standard+`·`full` 표식이 붙은 절은 지우고, 조건부 절은 채우거나 `해당 없음 — <근거>`로 닫는다.
   세 문서 모두 `tier: light`다. 작업은 다섯 필드 형식을 지키며, light 계획의 작업은 보통 1~3개다.
4. 핀을 먼저 박는다. `node <sdlc_runtime>/tools/pin.mjs intent.md`의 값을 spec의 `intent_version`에,
   `pin.mjs spec.md`의 값을 plan의 `spec_version`에 쓴다. 승인 편집은 frontmatter만 건드리므로
   승인 전에 박은 핀이 승인 뒤에도 유효하다.
5. `node <sdlc_runtime>/tools/check-set.mjs <폴더>`를 **폴더에 한 번** 실행한다. 검사기와 린터를
   함께 돌리고, 둘 다 세트를 통째로 읽으므로 문서마다 돌릴 것이 없다. 오류를 고치고 다시 실행한
   뒤 결과를 그대로 보고한다.
6. 셋 다 `status: in_review`로 저장한다. 변경 동작·이유·위험·미해결 질문을 한 번에 보여준다.
   프로필이 `approval_mode: batch_light`이면 아래 준비 명령으로 세 문서의 변경 전후와 digest를
   얻어 검토 대상으로 제시한다. `<승인자>`는 공통 절차의 사람 이름이며 셸 인수를 인용한다.

   ```sh
   node <sdlc_runtime>/tools/approve-set.mjs <폴더> --approver "<승인자>" --prepare
   node <sdlc_runtime>/tools/approve-set.mjs <폴더> --approver "<승인자>" --apply <digest>
   ```

   두 번째 명령의 PreToolUse 가드가 한 번의 승인 다이얼로그를 띄운다. 문서·프로필·승인자가
   바뀌면 digest가 달라져 쓰기를 거절한다. 거절되면 커밋하지 않는다. `.approval/`의 적용 중
   기록이 남으면 부분 적용 여부를 확인하고 원본을 복구한 뒤 다시 검토한다.
   설정이 없으면 intent → spec → plan 순서로 `status: accepted`와 `approved_by`를 함께
   편집한다. 각 편집의 승인 다이얼로그에서 하나라도 거절되면 멈추고 커밋하지 않는다.
7. 셋 다 승인된 뒤 세 파일과 생성된 `.approval/` 승인 기록을 **한 커밋**에 담는다 — 공통 절차대로 승인 뒤 재검사는 하지 않는다.
   다음 단계는 `/implement-spec <경로>`다.

## 보고

세 문서의 경로, 티어 판단 근거, FR·AC·WP 수, 검사기·린터의 오류와 경고 수, 미해결 질문을 보고한다.
