# SDLC 런타임

개인 용도는 sdlc 플러그인이 들고 있는 사본을 그대로 쓴다. 팀·CI는 규약·도구·참조 문서를
`.claude/sdlc`에 고정한다.

프로필에 `sdlc_runtime`이 없을 때 찾는 순서는 레포의 `.claude/sdlc`(벤더) → 설치된 restart-harness 플러그인의 `sdlc-runtime/` 다. **순서가 곧 정책이다** —
레포가 고정한 사본이 가장 세다 — 팀과 CI 가 같은 검사기를 쓰게 하려는 것이 벤더의 유일한
목적이라, 훅이 스킬과 다른 사본을 읽으면 그 목적이 무너진다.

## 도구

| 도구 | 역할 |
|---|---|
| `check-artifacts.mjs` | 산출물 세트 하나의 구조·추적성 검사 |
| `lint-prose.mjs` | 산출물 문체 검사 |
| `check-all.mjs` | 전체 산출물 세트·밴드·정책 검사 |
| `plan-progress.mjs` | 완료 주장과 커밋·테스트 이름·검증 증거 대조 |
| `verify-run.mjs` | 검증 명령 실행과 로그·작업 지문 기록 |
| `task-evidence.mjs` | 작업 정의와 파일 내용의 지문 계산 |
| `plan-levels.mjs` | 의존 관계, 실행 레벨과 방식 계산 |
| `task-worktree.mjs` | 워크트리 생성·작업 커밋·병합·정리 |
| `task-brief.mjs` | 작성 에이전트 프롬프트 생성 |
| `guard-approval.sh` | 승인 전이와 승인 문서 편집의 사전 가드 |
| `gate-artifacts.sh` | 편집 후 검사와 중복 경고 요약 |
| `sdlc-lib.sh` | 훅의 프로필·경로 해석 |
| `install-hook.mjs` | 기존 설정을 유지하며 훅 등록 |
| `bands.mjs` · `autonomy.mjs` | 밴드·자율 정책 검사 |
| `dispatch-auto.mjs` | 자율 경로 실행·검사·커밋·결과 기록 |
| `migrate-schema.mjs` | 프로필·문서 버전 마이그레이션 |
| `vendor-runtime.sh` | 런타임 고정·갱신·드리프트 검사 |

## 훅과 CI

로컬 훅은 빠른 피드백을 위한 장치다. 런타임이 없으면 실행되지 않을 수 있으므로 직접 검사와 CI를 병행한다.
가드는 Edit·Write와 대표적인 Bash 승인 편집을 판정하며, 모든 셸 명령을 해석하는 보안 경계는 아니다.

- 승인 편집에는 `permissionDecision: "ask"`를 반환한다. `dontAsk` 모드에는 이유와 함께 차단을 반환한다.
- 비대화형 실행에서는 사람이 응답할 수 없다. 정책 승인 처리는 `references/autonomy.md`를 따른다.
- 게이트는 편집한 산출물 세트를, CI는 전체 산출물 세트를 검사한다.

```sh
node <sdlc_runtime>/tools/install-hook.mjs <repo-root>
node <sdlc_runtime>/tools/check-all.mjs <repo-root> --required
```

`--required`는 프로필 누락·산출물 0개도 실패로 처리하는 CI 모드다. 기본 모드는 프로필 없는
레포를 건너뛰고, 존재하는 빈 산출물 디렉터리는 허용한다. 프로필이 있으면 없는 `spec_dir`,
명시했지만 없는 밴드·정책 파일, 읽기 오류는 실패다. 산출물 세트가 없어도 밴드·정책 검사는 실행한다.
산출물 검사와 문체·진행 검사는 항상 strict로 실행한다. 정책 만료 경고는 표시하고 신규 실행은 디스패처가 거절한다.

기존 CI가 없으면 미연결 사실을 보고한다. 워크플로 실행 여부와 필수 체크 설정은 호스팅 서비스에서 별도로 확인한다.

## 런타임 고정

```sh
<sdlc_runtime>/tools/vendor-runtime.sh          <repo-root>
<sdlc_runtime>/tools/vendor-runtime.sh --update <repo-root>
<sdlc_runtime>/tools/vendor-runtime.sh --check  <repo-root>
```

고정한 뒤 프로필의 `sdlc_runtime`을 `.claude/sdlc`로 바꾸고 함께 커밋한다.
`--check`는 실행한 원본과 벤더 사본의 버전·내용을 비교한다. 벤더 사본을 독립적으로 관리한다면
글로벌 사본과의 일치를 CI 필수 조건으로 삼지 않는다.
