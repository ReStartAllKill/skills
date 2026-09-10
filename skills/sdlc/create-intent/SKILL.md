---
name: create-intent
description: '변경의 목적·목표·범위를 intent.md로 작성한다. 구현 전에 아이디어나 변경 의도를 정리할 때 사용한다. 승인된 intent나 spec이 있으면 /create-spec 또는 /create-plan을 사용한다.'
---

# 의도 작성

사용법: `/create-intent <주제 · 티켓 · finding 경로>`

`intent.md`를 작성한다. 제안자와 제품 책임자가 이해할 수 있는 말로 문제와 목표를 정한다.
후속 명세와 계획은 승인된 의도를 바탕으로 작성한다.

## 절차

시작·검사·승인은 `<sdlc_runtime>/conventions.md`의 「Shared skill procedure」를 따른다.

1. 입력이 finding 경로면 해당 문서를 읽고 `from_finding`에 상대 경로를 적는다.
   intent를 만든 뒤 finding의 `routed_to`를 `intent:<상대 경로>`, 상태를 `accepted`로 바꾼다.
   두 경로는 각각 자기 문서의 폴더를 기준으로 하며 같은 문서 쌍을 가리켜야 한다.
2. 문제를 겪는 대상, 기대 결과, 제약, 범위 밖 항목을 확인한다. 입력에 없는 제품 판단만 묻는다.
3. 규약의 기준으로 위험 등급(`tier`)을 정하고 근거를 한 줄로 보고한다.
4. `assets/<lang>/intent-template.md`를 사용해 `<spec_dir>/<YYYY-MM-DD>-<slug>/intent.md`에 쓴다.
   `OUT-*`에는 관찰 가능한 결과와 `확인:` 방법을 적는다. Must 결과는 후속 명세의 요구사항과 연결한다.
5. 되돌리기 어려운 결정은 `<sdlc_runtime>/references/adr.md`의 「판정」 기준에 따라 ADR로 관리한다.
   기존 ADR을 `decisions:`에 버전을 고정해 참조한다. ADR이 없으면 `/create-adr`로 먼저 작성하고
   이 단계는 중단한다.
6. 공통 절차에 따라 검사하고 승인을 처리한다. 다음 단계는 `/create-spec <경로>`다.

구현 구조·파일·라이브러리·작업 순서는 plan에 둔다. 외부 인터페이스의 동작은 spec에 둔다.
글자 수 제한은 `check-set.mjs`가 잡는다 — `<sdlc_runtime>/references/prose.md`는 그 경고를
해석해야 하거나 한도를 미리 계산해야 할 때만 읽는다.

## 보고

문서 경로, 위험 등급, 상태, 검사기·린터의 오류와 경고 수, 미해결 질문을 보고한다.
