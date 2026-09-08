---
name: implement-spec
description: '승인된 plan.md의 작업을 의존 관계에 따른 실행 레벨 순서로 구현한다. 작업별 Git 워크트리 격리, 병합 후 검증, 완료 증거 기록을 관리하며 중단된 구현을 재개할 때도 사용한다.'
disable-model-invocation: false
---

# 명세 구현

사용법: `/implement-spec <명세 디렉터리 또는 plan.md 경로>`

`/create-plan`이 작성한 `plan.md`의 작업 목록을 실행한다. 코드에서 확인한 제약과 승인된 명세가
충돌하면 임의로 변경하지 않고 `/iterate-spec`을 안내한다.

실행 레벨 계산·워크트리 관리·커밋·병합·검증 기록·프롬프트 생성·체크박스 갱신은 런타임 도구가
수행한다. 에이전트는 중단 여부, 실패 원인, 수용 기준 충족 여부, 보고 내용을 판단한다.
검증·초기화 명령, 경로, 브랜치는 프로필과 plan에 정의된 값을 사용한다.
설계 배경이 필요할 때만 이 스킬의 `references/rationale.md`를 읽는다.

## 0. 입력과 실행 순서 확인

1. `.claude/spec-profile.yml`을 읽는다. 없으면 `/sdlc-init`을 안내하고 중단한다.
   런타임 탐색 순서는 `${CLAUDE_PLUGIN_ROOT}/sdlc-runtime/references/runtime.md`를 따른다.
   `<sdlc_runtime>/conventions.md`와 `<sdlc_runtime>/references/tasks.md`를 읽는다.
2. `plan.md` 전체를 읽는다. 수용 기준을 대조할 때는 `spec.md`, 변경 목적을 확인할 때는
   `intent.md`를 읽는다. 입력 경로가 없으면 `<spec_dir>` 목록에서 대상을 확인한다.
3. `plan.md` 없이 `tasks.md`만 있으면 이 스킬의 `references/legacy-spec.md` 절차를 따른다.
   아래 도구는 이전 작업 형식을 지원하지 않는다.
4. 다음 명령으로 산출물과 실행 순서를 확인한다. 오류가 있으면 구현을 시작하지 않고
   `/iterate-spec`으로 수정한다.

   ```sh
   node <sdlc_runtime>/tools/check-artifacts.mjs <명세 디렉터리>
   node <sdlc_runtime>/tools/plan-levels.mjs <명세 디렉터리>
   ```

## 1. 작업 트리와 진행 상태 확인

메인 작업 트리는 결과를 병합할 현재 체크아웃이다. `git status --porcelain` 출력이 비어 있고
현재 브랜치가 plan의 `target_branch`여야 한다.

- 미커밋 변경이 있으면 중단한다.
- 대상 브랜치가 없으면 사용자 승인 후 `git switch -c <target_branch> <base>`로 생성한다.
- 다른 브랜치에 있으면 사용자 확인 후 `git switch <target_branch>`로 전환한다.

```sh
node <sdlc_runtime>/tools/plan-progress.mjs <명세 디렉터리>
```

체크박스를 `SDLC-Task` 트레일러가 있는 커밋, 테스트 문장, 검증 기록과 대조한다.

- 미완료로 표시됐지만 귀속 커밋이 있으면 다시 구현하지 않는다. 검증 결과를 대조하고 2e로 진행한다.
- 완료로 표시됐지만 귀속 커밋이 없으면 중단하고 병합 결과·트레일러·체크박스를 확인한다.

`plan-levels`가 표시하는 다음 실행 레벨에서 시작하거나 재개한다.
`assets/report-templates.md`의 「진행 상태」 형식으로 보고하고, 첫 미완료 레벨을 실행하기 전에
plan의 상태를 `in_progress`로 변경해 커밋한다.

## 2. 실행 레벨별 구현

`plan-levels`가 정한 순서를 따른다. 실행 레벨은 작업 의존 관계로 구분한 단계이며,
같은 레벨의 처리 방식은 `mode`에 따른다. 레벨 사이에는 순차적으로 진행한다.

| mode | 조건 | 실행 방식 |
|---|---|---|
| `main` | 작업 하나 | 별도 워크트리 없이 메인 작업 트리에서 실행 |
| `parallel` | 여러 작업, bootstrap 있음 | 작업별 워크트리에서 병렬 실행 |
| `sequential` | 여러 작업, bootstrap 없음 | 작업별 워크트리에서 순차 실행 |

### 2a. 워크트리 준비

```sh
node <sdlc_runtime>/tools/task-worktree.mjs <명세 디렉터리> add WP-003
```

`target_branch`에서 작업 브랜치를 생성하고 bootstrap 명령으로 작업 환경을 초기화한다.
워크트리가 이미 있으면 재개할 작업인지 확인한다.

### 2b. 구현 에이전트 실행

```sh
node <sdlc_runtime>/tools/task-brief.mjs <명세 디렉터리> WP-003 --worktree <워크트리 경로> [--snippets <파일>]
```

출력된 프롬프트를 수정하지 않고 프로필의 `writer_agent`에게 전달한다. 프롬프트에는
`<sdlc_runtime>/references/writer-prompt.md`를 바탕으로 AC 문장, 적용되는 `.claude/rules`,
병렬 작업 제약, 커밋 금지 규칙이 포함된다.

익숙하지 않은 코드 영역은 먼저 `pattern_agent`에게 구현 관례를 `file:line`으로 조사하게 하고
`--snippets`로 전달한다. `parallel` 모드에서는 같은 레벨의 에이전트를 한 메시지에서 동시에
실행한다. 워크트리는 도구가 관리하므로 Agent의 `isolation` 옵션은 사용하지 않는다.
구현 에이전트가 추가 질문 없이 작업할 수 있도록 필요한 입력을 준비한다.
각 구현 에이전트에는 해당 작업의 `files` 범위만 맡긴다.

### 2c. 커밋과 병합

```sh
node <sdlc_runtime>/tools/task-worktree.mjs <명세 디렉터리> commit WP-003 -m "<커밋 규칙에 맞는 제목>"
node <sdlc_runtime>/tools/task-worktree.mjs <명세 디렉터리> merge WP-003
node <sdlc_runtime>/tools/task-worktree.mjs <명세 디렉터리> remove WP-003
```

`commit`은 작업의 `files`만 스테이징하고 `SDLC-Task` 트레일러를 추가한다.
`main` 모드는 `commit … --main`을 사용한다. 커밋 제목은 프로필의 `commit` 규칙을 따른다.
범위 밖 변경은 경고와 함께 보고한다. 해당 변경 때문에 `remove`가 거부되면 사용자에게 내용을
보여주고 폐기 승인을 받은 뒤 `remove … --force`를 사용한다.

병합은 순차적으로 수행한다. 충돌이 발생하면 병합을 취소하고 중단한다. 직접 충돌을 해결하지
않고 작업의 `files` 선언과 실제 변경 범위를 확인해 사용자에게 보고한다.

### 2d. 병합 후 검증

```sh
node <sdlc_runtime>/tools/verify-run.mjs <명세 디렉터리> --level <N> --tasks WP-003,WP-004 -- "<프로필 verify>"
node <sdlc_runtime>/tools/verify-run.mjs <명세 디렉터리> --level <N> --tasks WP-003,WP-004 --label <게이트> -- "<게이트 명령>"
```

프로필의 전체 검증 명령 `verify`를 한 번 실행하고, 적용되는 `extra_gates`는 `--label`을 지정해
각각 실행한다. 전체 검증의 `--tasks`에는 이번 레벨과 이전 레벨에서 완료한 모든 작업 ID를 넣는다.
로그는 `<verify_log_dir>/<slug>/`에 저장되며 최신 전체 검증 로그가 해당 작업들을 증명해야 한다.
같은 작업 트리에서 검증을 동시에 실행하지 않는다.

이번 레벨의 변경 때문에 실패했다면 메인 작업 트리에서 수정하고 관련 작업의 트레일러를 붙여
커밋한 뒤 재검증한다. 기존 실패·환경 문제·명세 충돌이면 범위를 확대하지 않고 보고 후 중단한다.
실패 로그는 보존하며, 검증을 통과해야 다음 레벨로 진행한다.

### 2e. 완료 상태와 실행 기록 갱신

```sh
node <sdlc_runtime>/tools/plan-check.mjs <명세 디렉터리> mark WP-003 --note "<계획과의 차이>" [--pr <링크>]
node <sdlc_runtime>/tools/plan-check.mjs <명세 디렉터리> commit --level <N> [--gate <게이트 로그>]…
```

수용 기준 충족 여부와 계획 대비 차이를 판단한 뒤 `mark`를 실행한다. 차이가 없으면
`--note 없음`을 사용한다. 도구는 귀속 커밋과 검증 기록을 확인하고 체크박스와 「실행 기록」을
갱신한다. 차이가 크면 `/iterate-spec`을 안내한다.

테스트 문장이 파일에 없으면 해당 테스트를 작성하거나 `tests:`를 실제 테스트 이름에 맞춘다.
상태가 `in_progress`가 아니어서 거부되면 상태를 먼저 수정한다. 체크박스를 직접 수정해
검사를 우회하지 않는다.

레벨의 작업을 모두 기록한 뒤 `commit`으로 계획서와 해당 레벨의 검증 로그만 커밋한다.
`plan-progress`를 다시 실행해 기록이 일치하는지 확인한다. 스테이징은 위 도구에 맡기며
`git add -A`와 `git add .`은 사용하지 않는다.

### 2f. 진행 보고와 외부 반영

`assets/report-templates.md`의 「레벨 완료」 형식으로 보고한다. 필수 수동 검증이 남아 있어도
다음 자동 작업은 진행할 수 있지만, plan을 `completed`로 바꾸거나 구현 완료로 보고하지 않는다.

대상 브랜치로의 커밋과 병합은 구현 절차에 포함된다. `git push`와 PR 생성은 사용자가 이번 실행에서
명시적으로 요청한 경우에만 수행한다. `pr_strategy`는 PR 분할 방식이며 실행 권한을 뜻하지 않는다.

## 3. 독립 감사와 완료 보고

프로필의 `audit_agent`가 있고 `writer_agent`와 다르면
`<sdlc_runtime>/references/audit-prompt.md`에 다음 값을 채워 읽기 전용 감사를 실행한다.

- `{spec_dir}`: 명세 디렉터리
- `{born}`: plan의 최초 커밋
- `{verify_logs}`: 검증 로그
- `{acceptance}`: spec의 FR/NFR과 AC 전문

감사 에이전트가 없거나 구현 에이전트와 같으면 감사를 생략하고 보고에 명시한다.
감사 결과와 자체 대조 결과가 다른 AC는 미확인으로 보고한다. 미충족 기준이 있으면 완료 처리하지 않는다.

`assets/report-templates.md`의 「완료 보고」 형식으로 각 `AC-*`를 충족하는 코드와 테스트를
`file:line`으로 제시한다. 근거를 제시할 수 없는 기준은 미확인으로 보고하고 완료 처리하지 않는다.
모든 자동 검증과 필수 수동 검증을 마친 뒤에만 plan을 `completed`로 변경하고 커밋한다.
