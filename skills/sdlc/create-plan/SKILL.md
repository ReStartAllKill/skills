---
name: create-plan
description: '승인된 spec.md를 바탕으로 구현 계획과 작업 목록을 작성한다. 구현 작업을 분할하고 의존 관계·검증 방법을 정할 때 사용한다. 결과는 /implement-spec의 입력이 된다.'
---

# 구현 계획 작성

사용법: `/create-plan <명세 디렉터리 또는 spec.md 경로>`

승인된 `spec.md`를 바탕으로 `/implement-spec`이 실행할 `plan.md`를 작성한다.

## 절차

시작·검사·승인은 `<sdlc_runtime>/conventions.md`의 「Shared skill procedure」를 따른다.
작업 형식과 완료 증거는 `<sdlc_runtime>/references/tasks.md`를 읽는다.

0. 프로필에 `upstream_repo`가 있으면 먼저 승인된 상류 문서를 끌어온다 —
   `node <sdlc_runtime>/tools/pull-spec.mjs <산출물 디렉터리>`. 사본과 `upstream.lock.json`을 함께
   커밋한다. 사본은 읽기 전용이다(규약 「변경이 여러 레포에 걸치면」).
1. intent·spec을 읽고 위험 등급(`tier`)을 상속한다. 프로필의 검증 명령과 `extra_gates`를 확인한다.
   상류에서 온 spec이면 **`scope`가 이 레포인 수용 기준만** 이 계획의 몫이다. 남의 몫을 `covers`에
   적으면 검사기가 막는다.
2. 현재 코드를 `file:line`으로 기록한다. 확인하지 못한 제약은 가정으로 구분한다.
3. `assets/<lang>/plan-template.md`로 작성한다. `target_branch`, `pr_strategy`, 롤백 방법과
   적용할 추가 게이트를 채운다. 설계 결정에는 선택 이유와 기각한 대안을 남긴다.
4. 작업을 나누고 `files`, `depends`, `covers`, `tests`, `verify`를 채운다.
   의존 관계를 기준으로 순서를 정하고 저장소의 아키텍처 계층 경계를 지킨다.
   spec 의 시나리오에 우선순위가 있으면 **`Must` 시나리오의 몫인 작업이 앞 레벨에 서게** 나눈다 —
   그 시나리오 하나가 배포 단위이고, 검사기는 그 작업이 `Should`·`Could` 시나리오만 만드는 작업 뒤에
   서면 경고한다. `node <sdlc_runtime>/tools/plan-levels.mjs <디렉터리>` 의 «슬라이스» 가 어느 레벨에서
   어느 시나리오가 끝나는지 보여 준다.
   UI 자동 검증이 어려우면 분리 가능한 판정 로직을 테스트하고 나머지는 수동 검증에 명시한다.
5. `spec_version`을 기록한다. `upstream.lock.json`이 있으면 락의 `files["spec.md"].sha`를 쓴다
   (그 자리에서 `body:`는 거부된다). 락이 없고 스키마 v7 이상이면
   `node <sdlc_runtime>/tools/pin.mjs spec.md`의 출력을 그대로 쓴다 — 본문 핀이라 상위가 아직
   커밋되지 않아도 된다. v7 미만이면 명세 디렉터리에서 `git log -1 --format=%h -- spec.md`를
   실행하고, 커밋이 없으면 버전 값을 만들지 말고 상위 문서를 먼저 커밋한다.
6. `TD-*`에는 이번 변경의 구현 방법을 기록한다. 변경 이후에도 유지할 아키텍처 결정은
   `<sdlc_runtime>/references/adr.md`의 「판정」 기준에 따라 `/create-adr`로 작성한다.
   버전을 고정해 참조한 ADR은 `task-brief`가 구현 에이전트에게 전달한다.
   **작업의 `files` 가 승인된 ADR 의 `scope` 에 들어가면 그 ADR 을 읽고 `decisions:` 에 핀한다.** 검사기가
   핀 없는 겹침을 경고한다 — 핀이 있어야 대체된 결정 위에 선 계획을 잡는다. 결정 안에서 설계했으면 핀으로
   끝이고, 결정에서 벗어나야 하면 `TD-*` 에 적지 말고 그 ADR 을 대체하는 새 ADR 을 먼저 쓴다.
7. 공통 절차에 따라 검사하고 승인을 처리한다. 구현은 `/implement-spec <경로>`로 시작한다.

## 보고

문서 경로, 상태, 작업·실행 레벨 수, 대상 브랜치, 검사기·린터의 오류와 경고 수, 미해결 질문을 보고한다.
