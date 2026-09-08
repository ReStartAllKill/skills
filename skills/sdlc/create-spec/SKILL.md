---
name: create-spec
description: '승인된 intent에서 검증 가능한 동작 명세를 만든다. intent.md 또는 스펙 폴더가 있고 "스펙 써줘", "요구사항 정리해줘", "수용 기준 뽑아줘"라고 할 때 쓴다. 승인된 intent가 없으면 /create-intent를 쓴다. Usage: /create-spec <스펙 폴더 또는 intent.md 경로>'
---

# 동작 명세 작성

승인된 `intent.md`를 바탕으로 `spec.md`를 작성한다. intent가 `accepted`가 아니면
먼저 의도 검토를 마친다.

## 절차

시작·검사·승인은 `<sdlc_runtime>/conventions.md`의 「스킬 공통 절차」를 따른다.

1. intent 전체를 읽고 티어를 상속한다. 위험이 커졌다면 intent부터 수정한다.
2. 선행 스펙과 구현 관례를 조사한다. 필요한 독립 조사는 프로필의 `prior_work_agent`와
   `pattern_agent`에 나누어 맡기고, 코드 근거는 `file:line`으로 받는다.
3. 변경 경로에 적용되는 `.claude/rules/*.md`와 테스트 규칙을 직접 읽는다.
   문서 작성에는 코드 경로의 규칙이 자동 적용되지 않을 수 있다.
4. 코드로 확인할 수 없는 도메인 정책·운영 판단·동작만 묻는다. 질문은 한 번에 3개 이내로 묶는다.
   발안자(기획)가 시작하는 spec이면 시나리오·FR의 동작 문장·우선순위까지 쓰고, AC의 정밀도·EDGE·
   NFR·인터페이스 계약·데이터는 지어내지 않고 `SQ-*`로 남긴다 — 엔지니어가 `/iterate-spec`으로
   채운다(규약 「누가 쓰고 누가 완성하나」).
   변경이 여러 코드 레포에 걸치면 레포마다 spec 한 벌을 쓴다 — 한 폴더의 plan이 Must 수용 기준을
   전부 덮어야 하기 때문이다(규약 「변경이 여러 레포에 걸치면」).
5. `assets/spec-template.md`로 작성한다. FR/NFR의 `근거:`에 OUT/CON을 연결하고,
   정상·오류·경계 동작을 검증 가능한 수용 기준으로 쓴다.
   외부 인터페이스의 필드·이벤트는 spec에, 내부 구조·함수·파일·라이브러리는 plan에 둔다.
6. 스펙 폴더에서 `git log -1 --format=%h -- intent.md`를 실행해 `intent_version`에 기록한다.
   커밋이 없으면 버전 값을 만들지 말고 상위 문서를 먼저 커밋한다.
7. `SD-*` 는 **이 변경의 외부 동작을 어떻게 보이게 할지**의 결정이다. `references/adr.md` §판정 에
   걸리면 SD 가 아니라 ADR 이다 — `/create-adr` 로 보내고 `decisions:` 에 핀한다.
8. 공통 절차에 따라 검사하고 승인을 처리한다. 다음 단계는 `/create-plan <경로>`다.

## 보고

문서 경로, 상태, FR/NFR·AC 수, 검사기·린터의 오류와 경고 수, 남은 질문을 보고한다.
