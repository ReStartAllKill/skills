---
name: create-pr
description: '현재 브랜치의 변경으로 PR 제목·본문을 쓰고 gh pr create로 올린다. PR 본문 작성, 커밋 후 PR 생성, 사슬을 근거로 한 리뷰 가이드 작성, 생성 후 본문 갱신에 사용한다.'
---

# PR 작성

사용법: `/create-pr [베이스 브랜치]`

리뷰어가 **왜 이 변경이 필요했고 어디를 주의 깊게 봐야 하는지** 를 읽게 만드는 것이 목표다. 무엇이
바뀌었는지는 Files 탭이 이미 보여준다.

## 준비

`.claude/spec-profile.yml` 을 읽는다. 없으면 사슬·분할·위험 축 신호 없이 diff 만 보고 쓰며, 그
사실을 보고한다 — 프로필 값을 지어내지 않는다.

본문 구조·섹션 규칙·예시는 이 스킬의 `references/pr.md` 를 읽는다. 선행 PR 위에 선형으로 쌓는
same-repository stack 일 때만 `references/pr-stack.md` 를 더 읽는다.

이 스킬은 **사용자가 PR 생성을 요청했을 때만** 돈다. `/implement-spec` 은 push 와 PR 생성을 자기
절차에 포함하지 않고, plan 의 `pr_strategy` 는 분할 «방식» 이지 생성 권한이 아니다.

## 1. 변경사항 파악

```sh
git fetch origin
${CLAUDE_PLUGIN_ROOT}/skills/sdlc/create-pr/scripts/pr-context.sh [base]   # 브랜치·커밋·diffstat·영향 영역·분할 신호·사슬·워킹트리
```

출력의 신호를 따른다.

- `review-focus` 가 붙은 영역은 `git diff <base>...HEAD -- <경로>` 로 실제 diff 를 읽고 판단한다.
- `SPLIT_HINT` 가 나오면 **PR 생성 전에 분할 여부를 먼저 묻는다.** 근거가 되는 관행·CI 게이트는
  프로필의 `pr_split_hint` 가 들고 있으므로 물을 때 그 이유를 함께 전한다.
- `chain:` 이 나오면 그 사슬이 이 PR 의 «왜» 다. 해당 `intent.md` · `spec.md` · `plan.md` 를 읽는다.
  `chain: none` 이면 커밋과 diff 가 유일한 출처다.

인자로 브랜치명이 오면 베이스로 쓴다. 없으면 프로필의 `pr_base`, 그것도 없으면 `main` 이다.

## 2. main 브랜치면 새 브랜치 생성

현재 브랜치가 기본 브랜치면, 커밋·PR 전에 변경 성격에 맞는 브랜치를 만들어 이동한다.

| 변경 | 브랜치 접두사 | 제목 타입 |
|---|---|---|
| 기능 추가 | `feat/` | `feat(<scope>):` |
| 버그 수정 | `fix/` | `fix(<scope>):` |
| 동작 불변 리팩터 | `refactor/` | `refactor(<scope>):` |
| 테스트 추가·수정 | `test/` | `test(<scope>):` |
| CI·CD·배포 | `ci/` | `ci:` / `ci(<scope>):` |
| 빌드·의존성·설정 유지보수 | `chore/` | `chore:` / `chore(deps):` |
| `.claude/` 스킬·에이전트 | `chore/` | `chore(claude):` |
| 문서 | `docs/` | `docs:` |

슬러그는 영문 소문자 + 하이픈. 사슬이 있으면 그 폴더 이름을 슬러그로 쓴다
(`.sdlc/specs/2026-09-08-cancel-application` → `feat/cancel-application`). 만든 브랜치명을 알린다.

## 3. 커밋

미커밋 변경이 있으면 **논리적 단위로 나눠** 커밋한다. PR 은 하나여도 커밋은 작게 유지한다 —
독립적으로 되돌릴 수 있는 변경, 맥락이 다른 변경은 분리한다. 메시지는 무엇보다 **왜** 를 담는다.
관례는 프로필의 `commit` 을 따르고, 없으면 `git log` 에서 조사한다.

`--no-verify` 금지. 이미 커밋돼 있으면 건너뛴다. 작업 커밋에 `SDLC-Task: WP-00N` trailer 가 붙어
있으면 지우지 않는다 — `plan-progress.mjs` 가 그것으로 작업을 귀속한다.

**PR 과 무관한 untracked 로컬 파일(스크래치 노트·로컬 테스트 파일)은 커밋하지 않는다.** 이로 인해
`gh pr create` 가 `Warning: N uncommitted changes` 를 내는 건 예상 동작이다 — 생성 보고에 한 줄로
언급만 하고 조사하지 않는다.

## 4. 제목

[Conventional Commits](https://www.conventionalcommits.org) 형식 `<type>(<scope>): <요약>` 을 쓴다.
릴리스 도구가 타입을 읽어 CHANGELOG·버전을 만드는 경우가 많으므로 타입을 정확히 고른다.

- **`<scope>` 는 변경된 워크스페이스·모듈 디렉터리 이름 그대로** 쓴다 — 목록을 외우지 말고 §1 의
  `affected areas` 출력을 후보로 삼는다.
- **`<요약>` 은 50자 이내**, 무엇이 추가·변경됐는지 한 문장. 본문과 같이 **체언 종결**.
- 여러 scope 가 얽히면 가장 핵심인 하나를 쓰고, 한 scope 로 좁혀지지 않으면 생략한다.
- 머지 시 squash 로 `(#PR번호)` 가 자동으로 붙으므로 제목에 PR 번호를 넣지 않는다.

**제목이 본체다.** 작은 변경(deps bump·CI 한 줄·핫픽스)은 잘 쓴 제목만으로 PR 이 거의 완결된다 —
본문은 Intent·Problem 두 문단이면 충분하고, 제목이 이미 말한 것을 본문에서 되풀이하지 않는다.

## 5. 본문

`references/pr.md` 를 따른다. 그 문서가 섹션 구성, 사슬에서 무엇을 가져오는지, Risk
등급의 뜻, 문체와 분량을 정한다. 여기서 되풀이하지 않는다.

섹션 골격이 필요하면 `assets/pr-body-template.md` 로 시작한다. **안내 주석은 전부 지운다** — 남으면
린트가 막는다. 최소형(Intent + Problem)으로 끝나는 변경이면 나머지 섹션은 채우지 말고 지운다.

**본문 초안은 파일로 쓰고 린트를 exit 0 으로 통과시킨 뒤 `--body-file` 로 넘긴다.**

```sh
BODY="$(mktemp "${TMPDIR:-/tmp}/pr-body.XXXXXX").md"
cat > "$BODY" <<'BODY_EOF'
... 본문 ...
BODY_EOF

${CLAUDE_PLUGIN_ROOT}/skills/sdlc/create-pr/scripts/pr-body-lint.sh "$BODY"
```

린트는 형식·잡음과 **빠뜨리면 안 되는 섹션** 을 잡는다(번역체·합쇼체·경위 서술·템플릿 잔재·위치 참조
과다·Reviewer Focus 안의 질문·분량·하드랩·위험 축을 건드렸는데 없는 Risks·사슬을 건드렸는데 없는 근거
ID). Problem 이 동기가 아니라 현재 상태를 쓰는지, Changes 가 설계 의도로 시작하는지, Review Point 가
사람만 판단할 수 있는 것인지는 스크립트가 못 보므로 `pr.md` 의 기준으로 직접 확인한다.

## 6. 생성

**draft 가 기본이다.** 사용자가 "ready" 를 명시할 때만 `--draft` 를 뺀다.

**사용자가 이미 PR 생성을 지시했으면**("PR 올려줘", "draft PR 올려줘") 채팅 미리보기·재확인 없이 바로
생성하고 URL 을 보고한다 — draft 라 생성 후 수정 비용이 낮고, 실제 검토는 GitHub 렌더링에서 이뤄진다.
확인을 거치는 경우는 둘뿐이다: 스킬이 자동으로 걸렸을 때(사용자가 PR 생성을 명시하지 않음), 또는
베이스 브랜치·PR 분할이 모호할 때.

**생성 전 게이트** — 위에서부터 순서대로 통과시킨다.

1. 베이스 브랜치와 PR 분할 여부가 확정됨 (§1)
2. 변경이 모두 커밋되고 논리 단위로 나뉨 — PR 과 무관한 로컬 파일은 제외 (§3)
3. 브랜치명이 `feat/`·`fix/`·`refactor/`·`test/`·`ci/`·`chore/`·`docs/` 중 하나로 시작 (§2)
4. 제목의 type·scope·요약이 정확함 (§4)
5. 본문 초안이 파일에 있고 `pr-body-lint.sh` 가 exit 0 (§5)
6. 고위험 변경이면 Reviewer Focus 와 Open question 을 직접 다시 읽음

```sh
gh pr create --draft --base main --title "feat(<scope>): ..." --body-file "$BODY"
```

`gh` 가 없으면 GitHub 웹에 붙여넣을 수 있도록 제목·본문을 출력한다.
PR 본문·커밋에 Co-Author 정보를 넣지 않는다.

자율 실행이면 draft 로만 만들고 ready 로 올리지 않는다. 사람이 보는 마지막 자리가 PR 리뷰다.

## 7. 사슬로 되돌려 적기

사슬이 있으면 PR 링크를 plan 에 남긴다. 생성 시점에 이미 `mark` 된 작업은 실행 이력에 `PR 없음` 으로
적혀 있으므로, `<사슬>/plan.md` §실행 기록에서 **이번 PR 의 작업 줄에 있는 그 자리만** 링크로 바꾼다.
같은 사건의 기록을 채우는 것이라 새 주장이 아니다. 아직 안 끝난 작업은 `plan-check.mjs mark <WP>
--pr <링크>` 가 처음부터 링크와 함께 적는다.

## 8. 생성 후 본문 갱신

생성 이후 유의미한 커밋이 추가되면(리뷰 반영·스코프 확장) 본문을 동기화한다. 사용자가 본문을 수동
편집했을 수 있으므로 **통째로 덮어쓰지 않는다** — 현재 본문을 내려받아 달라진 섹션만 고친 뒤 반영한다.

```sh
SYNC=${CLAUDE_PLUGIN_ROOT}/skills/sdlc/create-pr/scripts/pr-sync-body.sh
"$SYNC" <pr>                  # 현재 본문 → pr-<n>-body.md
# (파일에서 달라진 섹션만 수정)
"$SYNC" <pr> --apply <file>   # 린트를 통과해야 반영된다
```

스코프가 spec 을 벗어나게 커졌으면 본문만 고치지 말고 `/iterate-spec` 으로 사슬을 먼저 맞춘다.
