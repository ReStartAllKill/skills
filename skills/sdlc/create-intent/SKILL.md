---
name: create-intent
description: '새 변경의 의도를 산문으로 확정한다 — 산출물 사슬의 첫 칸. "인텐트 만들어줘", "왜 하는지부터 적자", "아이디어 정리해줘"처럼 아직 승인된 intent가 없는 구현 전 요청에 쓴다. 승인된 intent나 spec 경로가 있으면 /create-spec 또는 /create-plan을 쓴다. Usage: /create-intent <주제 · 티켓 · finding 경로>'
---

# 의도 작성

`intent.md`를 작성한다. 발안자와 제품 책임자가 이해할 수 있는 말로 문제와 목표를 정한다.
후속 명세와 계획은 승인된 의도를 바탕으로 작성한다.

## 절차

시작·검사·승인은 `<sdlc_runtime>/conventions.md`의 「스킬 공통 절차」를 따른다.

1. 입력이 finding 경로면 해당 문서를 읽고 `from_finding`에 상대 경로를 적는다.
   intent를 만든 뒤 finding의 `routed_to`를 `intent:<상대 경로>`, 상태를 `accepted`로 바꾼다.
   두 경로는 각각 자기 문서의 폴더를 기준으로 하며 같은 문서 쌍을 가리켜야 한다.
2. 문제를 겪는 대상, 기대 결과, 제약, 범위 밖 항목을 확인한다. 입력에 없는 제품 판단만 묻는다.
3. 규약의 기준으로 티어를 정하고 근거를 한 줄로 보고한다.
4. `assets/intent-template.md`를 사용해 `<spec_dir>/<YYYY-MM-DD>-<slug>/intent.md`에 쓴다.
   `OUT-*`에는 관찰 가능한 결과와 `확인:` 방법을 적는다. Must 결과는 후속 명세의 요구사항과 연결한다.
5. **되돌리기 어려운 결정을 사슬 안에서 정하지 않는다.** 판정은 `references/adr.md` §판정 이다.
   걸리면 결론을 intent 에 적지 말고 ADR 을 찾아 `decisions:` 에 핀한다. ADR 이 없으면 그것이
   먼저다 — `/create-adr` 로 보내고 여기서 멈춘다.
6. 공통 절차에 따라 검사하고 승인을 처리한다. 다음 단계는 `/create-spec <경로>`다.

구현 구조·파일·라이브러리·작업 순서는 plan에 둔다. 외부 인터페이스의 동작은 spec에 둔다.
글자 한도는 `references/prose.md`를 따른다.

## 보고

문서 경로, 티어, 상태, 검사기·린터의 오류와 경고 수, 남은 질문을 보고한다.
