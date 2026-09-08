---
name: create-plan
description: '승인된 spec 에서 구현 계획과 작업 목록을 만든다 — /implement-spec 이 읽는 파일. "플랜 만들어줘", "태스크로 쪼개줘", "작업 나눠줘" 에 쓴다. Usage: /create-plan <스펙 폴더 또는 spec.md 경로>'
---

# 구현 계획 작성

승인된 `spec.md`를 바탕으로 `/implement-spec`이 실행할 `plan.md`를 작성한다.

## 절차

시작·검사·승인은 `<sdlc_runtime>/conventions.md`의 「스킬 공통 절차」를 따른다.
작업 형식과 완료 증거는 `references/tasks.md`를 읽는다.

1. intent·spec을 읽고 티어를 상속한다. 프로필의 검증 명령과 `extra_gates`를 확인한다.
2. 현재 코드를 `file:line`으로 기록한다. 확인하지 못한 제약은 가정으로 구분한다.
3. `assets/plan-template.md`로 작성한다. `target_branch`, `pr_strategy`, 되돌리기 방법과
   적용할 추가 게이트를 채운다. 설계 결정에는 선택 이유와 기각한 대안을 남긴다.
4. 작업을 나누고 `files`, `depends`, `covers`, `tests`, `verify`를 채운다.
   의존 관계를 기준으로 순서를 정하고 레포의 계층 경계를 지킨다.
   UI 자동 검증이 어려우면 분리 가능한 판정 로직을 테스트하고 나머지는 수동 검증에 명시한다.
5. 스펙 폴더에서 `git log -1 --format=%h -- spec.md`를 실행해 `spec_version`에 기록한다.
   커밋이 없으면 버전 값을 만들지 말고 상위 문서를 먼저 커밋한다.
6. `TD-*` 는 **이 구현을 어떻게 만들지**의 결정이고 이번 변경과 함께 수명이 끝난다.
   `references/adr.md` §판정 에 걸리면 **TD 로 쓰지 말고 `/create-adr` 로 보낸다** — TD 에 적으면
   그 결정은 이 스펙 폴더와 함께 죽는다. 핀한 ADR 은 `task-brief` 가 구현 에이전트에게 실어 준다.
7. 공통 절차에 따라 검사하고 승인을 처리한다. 구현은 `/implement-spec <경로>`로 시작한다.

## 보고

문서 경로, 상태, 작업·레벨 수, 대상 브랜치, 검사기·린터의 오류와 경고 수, 남은 질문을 보고한다.
