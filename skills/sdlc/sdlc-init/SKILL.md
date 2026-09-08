---
name: sdlc-init
description: '저장소에 SDLC 프로필·승인 가드·산출물 검사·CI 연동을 설정한다. SDLC를 도입하거나 spec-profile을 작성할 때, 또는 작성 스킬이 프로필 누락을 보고할 때 사용한다.'
---

# SDLC 초기화

사용법: `/sdlc-init [저장소 경로]`

저장소의 프로필, 승인 가드, 편집 후 검사, CI 검사를 설정한다. 기존 구성이 있으면 필요한 부분만 보완한다.

런타임 탐색 순서는 `${CLAUDE_PLUGIN_ROOT}/sdlc-runtime/references/runtime.md`를 따른다.
그 런타임의 `conventions.md`, `references/profile.md`, `references/runtime.md`를 읽는다.
버전을 바꿀 때는 `references/schema.md`, 운영 신호를 연결할 때는 `references/bands.md`도 읽는다.

## 절차

1. **프로필:** CI·빌드 설정에서 검증 명령을, 워크스페이스 설정에서 작업 범위를,
   `.claude/agents`에서 역할을 조사한다. 근거를 찾지 못한 값은 비우고 필요한 판단을 묻는다.
   `spec_dir`는 기본 `.sdlc/specs`이며 문서와 검증 로그는 커밋할 수 있어야 한다.
   초안을 보여주고 사용자 확인 후 `.claude/spec-profile.yml`에 저장한다.
2. **레포 경계:** 문서와 코드가 다른 저장소로 갈리는지 확인한다. 갈리면 `repo`를 적고,
   코드 저장소에는 `upstream_repo`를, 문서 저장소에는 `spec_consumers`를 적는다
   (규약 「변경이 여러 레포에 걸치면」). 갈리지 않으면 세 키 모두 두지 않는다 —
   단일 레포에서는 경계 검사가 할 일이 없다.
   `upstream_repo`를 적었으면 `spec_dir`가 gitignore되지 않는지 확인한다. 벤더한 사본과
   `upstream.lock.json`이 커밋돼야 상류 핀이 성립한다.

3. **ADR 저장 위치:** 되돌리기 어려운 결정을 기록할 위치를 확인하고 `adr_dir`(기본 `docs/adr`)을 적는다.
   다른 저장소에서 관리하면 `adr_dir` 대신 `adr_repo`를 사용한다. ADR은 변경 이후에도 유지하는
   아키텍처 결정 기록이므로 `adr_dir`을 Git 추적에서 제외하지 않는다.
   ADR을 사용하지 않기로 하면 키를 비우고, ADR 관련 검사가 비활성화된다는 점을 보고한다.
4. **버전:** 기존 프로필이면 `node <sdlc_runtime>/tools/migrate-schema.mjs <저장소>`로 차이를 확인한다.
   확인 후 기본적으로 `--profile`을 사용해 새로 작성할 산출물의 스키마 버전만 올린다. 기존 문서 변경은
   사용자가 요청할 때만 `--chains`로 처리하며, 검사를 통과하지 못한 문서의 버전을 강제로 올리지 않는다.
   프로필이 런타임보다 높으면 프로필을 내리지 말고 런타임을 갱신한다.
5. **런타임:** 개인 용도는 설치된 플러그인을 사용하고 프로필의 `sdlc_runtime`을 비워 둔다. 팀·CI는
   `<sdlc_runtime>/tools/vendor-runtime.sh <저장소>`로 런타임을 복사해 고정하고 프로필을 `.claude/sdlc`로 변경한다.
   런타임과 프로필을 함께 커밋한다.
6. **훅:** `node <sdlc_runtime>/tools/install-hook.mjs <저장소>`를 실행한다.
   기존 훅을 유지하면서 승인 가드와 편집 후 검사를 등록한다.
7. **밴드:** `band_breach`를 사용할 때만 등록부를 만든다.
   지표의 허용 범위와 재현 명령을 확인하고 `node <sdlc_runtime>/tools/bands.mjs <저장소>`로 검사한다.
8. **CI:** 기존 워크플로에 `node .claude/sdlc/tools/check-all.mjs . --required`를 연결한다.
   필수 모드는 프로필 누락과 산출물 0개도 실패로 처리한다. 첫 문서 작성 전에는 그 실패 사유를 보고한다.
   CI가 없으면 새 CI를 임의로 만들지 말고 미연결 상태를 보고한다.
9. **확인:** 산출물 디렉터리를 생성하고 `node <sdlc_runtime>/tools/check-all.mjs <저장소>`를 실행한다.
   `adr_dir`을 설정했으면 `node <sdlc_runtime>/tools/adr-index.mjs <저장소>`로 ADR 인덱스를 만들고,
   CI에 같은 명령의 `--check` 옵션을 연결해 인덱스가 최신인지 검사한다.
   `.claude/hooks/*.sh`와 `.claude/settings.json`도 커밋 대상임을 안내한다.

## 보고

프로필·런타임 버전·훅·밴드·CI별 생성 또는 변경 여부, 검사한 산출물 체인 수와 실패 수를 보고한다.
다음 단계는 `/create-intent <주제>`다. 기존 형식의 문서는 초기화를 이유로 다시 쓰지 않는다.
