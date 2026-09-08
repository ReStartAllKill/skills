---
name: sdlc-init
description: '이 레포에 산출물 사슬을 깐다 — 레포 프로필 · 쓰기 시점 게이트 · CI 관문. "스펙 사슬 세팅해줘", "이 레포에 sdlc 깔아줘", "spec-profile 만들어줘" 에 쓴다. /create-intent 가 프로필이 없다고 하면 여기부터. Usage: /sdlc-init [레포 경로]'
---

# SDLC 초기화

레포의 프로필, 승인 가드, 편집 후 검사, CI 검사를 설정한다. 기존 구성이 있으면 필요한 부분만 보완한다.

런타임을 찾는 순서는 `references/runtime.md`가 정본이다.
그 런타임의 `conventions.md`, `references/profile.md`, `references/runtime.md`를 읽는다.
버전을 바꿀 때는 `references/schema.md`, 운영 신호를 연결할 때는 `references/bands.md`도 읽는다.

## 절차

1. **프로필:** CI·빌드 설정에서 검증 명령을, workspace 설정에서 작업 범위를,
   `.claude/agents`에서 역할을 조사한다. 근거를 찾지 못한 값은 비우고 필요한 판단을 묻는다.
   `spec_dir`는 기본 `.sdlc/specs`이며 문서와 검증 로그는 커밋할 수 있어야 한다.
   초안을 보여주고 사용자 확인 후 `.claude/spec-profile.yml`에 저장한다.
2. **결정의 집:** 되돌리기 어려운 결정을 어디에 남길지 묻고 `adr_dir`(기본 `docs/adr`)을 적는다.
   결정이 다른 레포에 모여 있으면 `adr_dir` 대신 `adr_repo`다. **`adr_dir`는 gitignore하지 않는다** —
   사슬은 이번 변경의 계약이라 지워도 되지만 ADR은 시스템이 지고 있는 제약이다.
   안 쓰기로 하면 키를 비우고 그 사실을 보고한다. 이 키가 없으면 ADR 관련 검사가 전부 꺼지고,
   결정은 사슬 안에서 태어나 사슬과 함께 죽는다.
3. **버전:** 기존 프로필이면 `node <sdlc_runtime>/tools/migrate-schema.mjs <레포>`로 차이를 확인한다.
   기본은 확인 후 `--profile`로 새 사슬의 버전만 올린다. 기존 문서 변경은 사용자가 요청할 때만
   `--chains`로 처리하며, 통과하지 못하는 사슬을 강제 승격하지 않는다.
   프로필이 런타임보다 높으면 프로필을 내리지 말고 런타임을 갱신한다.
4. **런타임:** 개인 용도는 플러그인 사본을 그대로 쓴다 — 프로필의 `sdlc_runtime`을 비워 둔다. 팀·CI는
   `<sdlc_runtime>/tools/vendor-runtime.sh <레포>`로 고정하고 프로필을 `.claude/sdlc`로 변경한다.
   런타임과 프로필을 함께 커밋한다.
5. **훅:** `node <sdlc_runtime>/tools/install-hook.mjs <레포>`를 실행한다.
   기존 훅을 유지하면서 승인 가드와 편집 후 검사를 등록한다.
6. **밴드:** `band_breach`를 사용할 때만 등록부를 만든다.
   실제 측정 지표와 재현 명령을 확인하고 `bands.mjs <레포>`로 검사한다.
7. **CI:** 기존 워크플로에 `node .claude/sdlc/tools/check-all.mjs . --required`를 연결한다.
   필수 모드는 프로필 누락과 산출물 0개도 실패로 처리한다. 첫 문서 작성 전에는 그 실패 사유를 보고한다.
   CI가 없으면 새 CI를 임의로 만들지 말고 미연결 상태를 보고한다.
8. **확인:** 산출물 디렉터리를 생성하고 `check-all.mjs <레포>`를 실행한다.
   `adr_dir`을 두었으면 `node <sdlc_runtime>/tools/adr-index.mjs <레포>`로 결정 로그를 만들고,
   CI에 `--check`를 연결한다 — 인덱스가 낡으면 그 폴더는 아무도 못 읽는 파일 벽이 된다.
   `.claude/hooks/*.sh`와 `.claude/settings.json`도 커밋 대상임을 안내한다.

## 보고

프로필·런타임 버전·훅·밴드·CI별 생성 또는 변경 여부, 검사한 사슬 수와 실패 수를 보고한다.
다음 단계는 `/create-intent <주제>`다. 기존 형식의 문서는 초기화를 이유로 다시 쓰지 않는다.
