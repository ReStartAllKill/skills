---
name: create-spec
description: '승인된 intent.md를 바탕으로 동작 명세와 수용 기준을 작성한다. 요구사항이나 명세를 작성할 때 사용하며, 승인된 intent가 없으면 /create-intent를 먼저 사용한다.'
---

# 동작 명세 작성

사용법: `/create-spec <명세 디렉터리 또는 intent.md 경로>`

승인된 `intent.md`를 바탕으로 `spec.md`를 작성한다. intent가 `accepted`가 아니면
먼저 의도 검토를 마친다.

## 절차

시작·검사·승인은 `<sdlc_runtime>/conventions.md`의 「스킬 공통 절차」를 따른다.

1. intent 전체를 읽고 위험 등급(`tier`)을 상속한다. 위험이 커졌다면 intent부터 수정한다.
2. 기존 명세와 구현 관례를 조사한다. 필요한 독립 조사는 프로필의 `prior_work_agent`와
   `pattern_agent`에 나누어 맡기고, 코드 근거는 `file:line`으로 받는다.
3. 변경 경로에 적용되는 `.claude/rules/*.md`와 테스트 규칙을 직접 읽는다.
   문서 작성에는 코드 경로의 규칙이 자동 적용되지 않을 수 있다.
4. 코드로 확인할 수 없는 도메인 정책·운영 판단·동작만 묻는다. 질문은 한 번에 3개 이내로 묶는다.
   기획 담당자가 작성하는 spec은 시나리오·FR의 동작 문장·우선순위까지 작성한다. 상세 AC·EDGE·
   NFR·인터페이스 계약·데이터 정의 중 확인되지 않은 내용은 `SQ-*`로 남기고, 엔지니어가
   `/iterate-spec`으로 보완한다(규약 「누가 쓰고 누가 완성하나」).
   변경이 여러 코드 저장소에 걸쳐도 **spec은 한 벌**이다. 수용 기준마다 어느 저장소가 만드는지를
   `` `scope: <repo>` ``로 적는다(규약 「변경이 여러 레포에 걸치면」). 프로필에 `spec_consumers`가
   있으면 배정되지 않은 Must 수용 기준을 검사기가 막는다.
5. `assets/spec-template.md`로 작성한다. FR/NFR의 `근거:`에 OUT/CON을 연결하고,
   정상·오류·경계 동작을 검증 가능한 수용 기준으로 쓴다.
   외부 인터페이스의 필드·이벤트는 spec에, 내부 구조·함수·파일·라이브러리는 plan에 둔다.
6. 명세 디렉터리에서 `git log -1 --format=%h -- intent.md`를 실행해 `intent_version`에 기록한다.
   커밋이 없으면 버전 값을 만들지 말고 상위 문서를 먼저 커밋한다.
   폴더에 `upstream.lock.json`이 있으면 이 문서는 벤더한 사본이다 — 여기서 고치지 않고
   상류에서 고친 뒤 `pull-spec.mjs`로 다시 끌어온다.
7. `SD-*`에는 이번 변경의 외부 동작에 관한 결정을 기록한다. `<sdlc_runtime>/references/adr.md`의
   「판정」 기준에 해당하는 결정은 `/create-adr`로 작성하고 `decisions:`에 버전을 고정해 참조한다.
8. 공통 절차에 따라 검사하고 승인을 처리한다. 다음 단계는 `/create-plan <경로>`다.

## 보고

문서 경로, 상태, FR/NFR·AC 수, 검사기·린터의 오류와 경고 수, 미해결 질문을 보고한다.
