# 레포 프로필

글로벌 스킬은 방법론만 가진다. 레포의 사실과 적용할 SDLC 버전은
`.claude/spec-profile.yml`에 둔다. 프로필 생성과 변경은 `/sdlc-init`이 맡는다.

## 키

| 키 | 쓰임 | 없을 때 |
|---|---|---|
| `sdlc_version` | 새 사슬이 쓸 스키마 | `1` — 기존 프로필 호환 |
| `sdlc_runtime` | 규약·검사기가 있는 경로 | `runtime.md`의 발견 순서 |
| `spec_dir` | 문서 위치. **`.claude/` 아래에 두지 않는다** — 그 폴더의 편집은 Claude Code가 언제나 묻는다 | `.sdlc/specs` |
| `owner` | 승인 다이얼로그에서 승인하는 사람의 이름 — `approved_by` 기본값 | `git config user.name` |
| `verify` · `verify_scoped` · `scope_hint` | 전체·작업별 검증 | CI와 빌드 설정에서 조사 |
| `bootstrap` | 새 워크트리 의존성 준비 | 없으면 병렬 대신 순차 |
| `source_roots` · `worktree_dir` | 소스·워크트리 경로 | 레포 루트 · `.claude/worktrees` |
| `writer_agent` · `pattern_agent` · `prior_work_agent` · `audit_agent` | 역할별 에이전트 | `general-purpose` · `Explore` |
| `commit` | 커밋 메시지 관례 | `git log`에서 조사 |
| `bands` | 탐지 밴드 등록부 | `.claude/bands.yml` |
| `extra_gates` | 레포 전용 게이트 | 없음 |
| `verify_log_dir` | 합류점 verify 로그 위치. 커밋한다 | `.sdlc/verify` |
| `repo` | 이 레포의 `<owner>/<name>`. 범위 배정과 ADR scope의 «내 자리/남의 자리»를 가른다 | 없음 — 경계 검사를 건너뛴다 |
| `upstream_repo` | intent·spec을 끌어올 문서 레포. 이 레포는 소비 레포가 된다 | 없음 — 단일 레포 |
| `spec_consumers` | 이 레포의 spec을 소비하는 코드 레포 목록. 적으면 이 레포가 **상류**다 | 없음 — 상류가 아니다 |
| `adr_dir` | 결정 기록 위치. **없으면 이 레포엔 ADR이 없고 관련 검사를 전부 건너뛴다** | 없음 |
| `adr_repo` | 결정이 다른 레포에 살 때 `<owner>/<repo>`. 핀은 `<repo>#ADR-NNN@<sha>` | 없음 — 같은 레포 |
| `adr_index` | 결정 로그. `adr-index.mjs`가 만든다 | `<adr_dir>/index.md` |
| `pr_base` | `/create-pr` 의 기본 베이스 브랜치 | `main` |
| `pr_workspace_dirs` | 영역을 두 단계로 묶을 최상위 디렉터리(`apps packages`) | 최상위 디렉터리 이름만 |
| `pr_split_dir` · `pr_split_hint` | 이 접두 아래가 둘 이상이면 분할 여부를 먼저 묻는다 | 없음 — 묻지 않는다 |
| `pr_review_focus` | `<정규식> => <이름>` 목록. 걸리면 diff 를 직접 읽히고 Risks 섹션을 강제한다 | 없음 — 경로 기반 검사를 건너뛴다 |

## 생성 원칙

새 프로필은 현재 런타임의 `VERSION`을 `sdlc_version`으로 쓴다. 기존 프로필에 버전이 없으면
자동으로 올리지 않고 v1로 읽는다.

낮은 채로 두면 새 사슬이 낮은 버전으로 만들어져 그 위 버전의 규칙이 **조용히 안 걸린다.**
`migrate-schema.mjs`가 무엇이 안 걸리고 있는지, 올리면 무엇이 깨지는지를 갈라서 보고한다.
프로필을 올리는 것은 새 사슬에만 영향해 안전하지만, 문서의 `schema_version`을 올리는 것은
새 규칙을 소급 적용하므로 다르다 — 깨지는 사슬은 대개 이미 끝난 계약이라 그대로 둔다.

```yaml
sdlc_version: 5
# sdlc_runtime 은 벤더했을 때만 적는다 — 안 적으면 플러그인 사본을 찾아 쓴다
# sdlc_runtime: ".claude/sdlc"
spec_dir: ".sdlc/specs"
repo: "acme/backend"       # 여러 레포로 갈렸을 때만 필요하다
upstream_repo: "acme/docs" # intent·spec 을 끌어올 곳. 단일 레포면 지운다
adr_dir: "docs/adr"        # 결정을 남길 곳. 이 레포에서 안 쓰면 지운다
```

PR 키는 `/create-pr` 만 읽는다. `pr_review_focus` 는 **블록 시퀀스로** 적는다 — 규칙 하나가 한 줄로
서야 어느 규칙이 걸렸는지 출력에서 갈린다.

```yaml
pr_base: "main"
pr_workspace_dirs: "apps packages"
pr_split_dir: "apps"
pr_split_hint: "앱 2개 이상 변경 — 배포 라벨이 정확히 1개여야 CI 를 통과한다"
pr_review_focus:
  - "^packages/db/ => DB 스키마"
  - "(authz|permission|role|session|jwt) => 권한·세션"
  - "(secret|credential|password) => 자격증명·secret 처리"
```

문서 레포(상류) 쪽은 반대로 적는다.

```yaml
sdlc_version: 6
spec_dir: "docs/specs"
repo: "acme/docs"
spec_consumers:            # 이 목록이 있으면 상류다 — 배정되지 않은 Must 를 막는다
  - acme/backend
  - acme/web
adr_dir: "docs/adr"        # 결정은 여기 모은다. 코드 레포는 adr_repo 로 핀만 건다
```

- 검증 명령은 `package.json`·`Makefile`·`justfile`·CI 워크플로에서 찾는다. CI가 정본이다.
- 스코프는 workspace 설정에서 찾는다. 단일 패키지면 비운다.
- 에이전트는 `.claude/agents/*.md`의 description을 읽고 고른다.
- 근거를 못 찾은 항목은 지어내지 않고 비운 뒤 사용자에게 묻는다.
- `spec_dir`가 gitignore되면 SHA 기반 버전 고정이 약해진다는 점을 알린다.
- `adr_dir`는 **gitignore하지 않는다.** 사슬은 이번 변경의 계약이라 지워도 되지만 ADR은 시스템이
  지고 있는 제약이고, 사라지면 기각한 대안이 사라진다. 결정을 다른 레포에 모으기로 했으면
  `adr_dir` 대신 `adr_repo`를 적는다.
- `upstream_repo`를 적은 레포에서는 `spec_dir`를 **gitignore하지 않는다.** 벤더한 사본과
  `upstream.lock.json`이 커밋돼야 상류 핀이 성립한다. 사본은 손으로 고치지 않는다 —
  `pull-spec.mjs`가 만들고 해시가 지킨다.
- `spec_consumers`에 적은 이름은 소비 레포의 `repo`와 마지막 경로 요소로 비교한다. 오타는
  «등록되지 않은 레포» 오류로 선다.
- `spec_dir`를 `.claude/` 아래에 두면 Claude Code가 «자기 설정 편집»으로 보고 Write·Edit마다
  묻는다. 허용 규칙도 훅의 allow도 이를 끄지 못한다. 대화형에서는 편집마다
  다이얼로그, 자율 경로에서는 거부다. 기존 프로필이 `.claude/specs`면 `.sdlc/specs`로 옮길 것을 권한다.

런타임이 선택한 스키마를 지원하는지 확인한다.

```sh
node <sdlc_runtime>/tools/check-artifacts.mjs --supports-schema <sdlc_version>
```

지원하지 않으면 런타임을 맞추거나 별도 마이그레이션을 한다.
