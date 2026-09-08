---
name: implement-spec
description: "스펙의 작업 목록을 레벨 단위로 실행한다 — 같은 레벨은 워크트리 격리로 병렬, 합류점마다 전체 검증. Usage: /implement-spec <스펙 디렉토리 또는 plan.md 경로>"
disable-model-invocation: false
---

# Spec Implementation

`/create-plan` 이 만든 `plan.md` 의 작업 목록을 실행한다. **구현은 지루해야 한다** — 창의가 필요하다고
느껴지면 스펙이 덜 익은 것이고, 밀어붙이지 말고 사용자에게 알리고 `/iterate-spec` 을 권한다.
코드에서 확인한 제약과 승인된 스펙이 충돌하면 어느 쪽도 임의로 덮어쓰지 않는다.

레벨 계산 · 워크트리 · 커밋 · 합류 · 검증 기록 · 프롬프트 생성 · 체크박스 갱신은 **도구가 한다.** 이 명령이 판단하는 것은
넷뿐이다 — 언제 멈추나, 실패의 원인이 무엇인가, 체크박스를 올려도 되나, 무엇을 사용자에게 알리나.
규칙의 이유는 `references/rationale.md` 에 있다. 실행에는 읽지 않아도 된다.

## Step 0: 적재

1. `.claude/spec-profile.yml` 을 읽는다. 없으면 `/sdlc-init` 을 안내하고 멈춘다. `sdlc_runtime` 이
   런타임을 찾는 순서는 `references/runtime.md` 가 정본이다.
   `<sdlc_runtime>/conventions.md` 와 `references/tasks.md` 를 읽는다.
2. 입력이 스펙 폴더면 `plan.md` 전체를 읽는다. `spec.md` 는 수동 검증 대조 때, `intent.md` 는 «왜» 가
   필요할 때만 읽는다. 입력이 없으면 `<spec_dir>` 목록을 보여주고 고르게 한다.
3. 폴더에 `plan.md` 가 없고 `tasks.md` 가 있으면 옛 형식이다 — `references/legacy-spec.md` 를 읽고
   그 방식으로 한다. 아래 도구는 옛 형식을 읽지 않는다.
4. 검사기와 실행 순서를 본다. 오류가 있으면 **실행하지 않는다** — 고칠 것은 `/iterate-spec` 이 고친다.

   ```sh
   node <sdlc_runtime>/tools/check-artifacts.mjs <스펙 폴더>
   node <sdlc_runtime>/tools/plan-levels.mjs   <스펙 폴더>
   ```

## Step 1: 상태 점검

### 1a. 메인 트리

메인 트리는 이 세션이 앉아 있는 clone 이고 모든 레벨의 결과가 모이는 자리다. `git status --porcelain`
이 비어 있고 브랜치가 plan 의 `target_branch` 여야 한다.

- 더럽다 → 멈춘다. 병렬 결과가 모일 자리가 오염돼 있으면 무엇이 누구 변경인지 갈라낼 수 없다.
- 브랜치가 없다 → base 에서 만들 것을 제안하고 승인받은 뒤 `git switch -c <target_branch> <base>`.
- 다른 브랜치에 있다 → 확인받고 `git switch <target_branch>`. 조용히 바꾸지 않는다.

### 1b. 진행 상태 — 체크박스만 믿지 않는다

```sh
node <sdlc_runtime>/tools/plan-progress.mjs <스펙 폴더>
```

체크박스는 주장이고 `SDLC-Task` trailer 커밋 · tests 문장의 실재 · verify 기록이 사실이다.

- `미체크인데 귀속 커밋 있음` → 다시 실행하지 않는다. 검증을 대조하고 §2e 로 간다.
- `체크됐는데 귀속 커밋 없음` → 멈춘다. 합류가 실패했거나 trailer · 체크가 잘못된 것이다.
- `더티` → §1a 와 같은 처리다.

`plan-levels` 의 «다음» 이 시작 레벨이다. 컨텍스트가 날아간 뒤의 재개도 여기서 흡수된다.
`assets/report-templates.md` 의 «진행 상태» 형식으로 보고하고, 첫 미완료 레벨을 시작하기 전에
plan 의 status 를 `in_progress` 로 바꾸고 커밋한다.

## Step 2: 레벨 단위 실행

`plan-levels` 가 준 레벨 순서대로, 레벨 안은 병렬, 레벨 사이는 직렬이다. 레벨의 `mode` 가 실행 방식이다.

| mode | 뜻 | 실행 |
|---|---|---|
| `main` | 작업 하나 | 메인 트리에서 바로. 워크트리를 만들지 않는다 |
| `parallel` | 여럿 · bootstrap 있음 | 작업마다 워크트리, 한 메시지에서 동시에 |
| `sequential` | 여럿 · bootstrap 없음 | 워크트리는 만들되 하나씩 |

### 2a. 워크트리

```sh
node <sdlc_runtime>/tools/task-worktree.mjs <스펙 폴더> add WP-003
```

`target_branch` 에서 작업 브랜치를 파고 bootstrap 을 돌린다. 이미 있으면 재개인지 확인한다.

### 2b. 프롬프트를 만들어 `writer_agent` 에 넘긴다

```sh
node <sdlc_runtime>/tools/task-brief.mjs <스펙 폴더> WP-003 --worktree <워크트리 경로> [--snippets <파일>]
```

출력이 프롬프트 전문이다 — 템플릿은 `<sdlc_runtime>/references/writer-prompt.md` 이고 spec 의 AC 문장, 걸리는
`.claude/rules`, 병렬 주의, 커밋 금지가 채워져 있다.
손으로 고쳐 쓰지 않는다. 낯선 코드 영역이면 먼저 `pattern_agent` 로 관용구를 `file:line` 으로 뽑아
`--snippets` 로 싣는다. 레벨의 작업들을 **한 메시지에서 동시에** 띄운다. Agent 의 `isolation` 옵션은
쓰지 않는다. 에이전트는 되물을 수 없으니 되물어 오면 이 단계의 준비 부족이다.

### 2c. 합류

```sh
node <sdlc_runtime>/tools/task-worktree.mjs <스펙 폴더> commit WP-003 -m "<commit 관례의 제목>"
node <sdlc_runtime>/tools/task-worktree.mjs <스펙 폴더> merge  WP-003
node <sdlc_runtime>/tools/task-worktree.mjs <스펙 폴더> remove WP-003
```

`commit` 은 그 작업의 `files` 만 스테이징하고 `SDLC-Task` trailer 를 붙인다. files 밖의 변경은 싣지 않고
경고한다 — 그 경고는 에이전트가 스코프를 넘었다는 신호이니 보고에 싣는다. 그 변경이 워크트리에 남아
있으면 `remove` 가 거절한다. 버려도 되는지 사용자에게 보이고 `remove … --force` 로 치운다. `merge` 는 하나씩이고
충돌이면 되돌리고 멈춘다. **충돌은 손으로 풀지 않는다** — `files` 줄이 실제와 달랐다는 뜻이니
사용자에게 알린다. `main` 레벨은 `commit … --main` 으로 메인 트리에서 같은 규칙으로 커밋한다.

### 2d. 합류점 검증 — 기록으로 남긴다

```sh
node <sdlc_runtime>/tools/verify-run.mjs <스펙 폴더> --level <N> --tasks WP-003,WP-004 -- "<프로필 verify>"
node <sdlc_runtime>/tools/verify-run.mjs <스펙 폴더> --level <N> --tasks WP-003,WP-004 --label <게이트> -- "<게이트 명령>"
```

프로필의 `verify` 를 **한 번**, 걸리는 `extra_gates` 는 `--label` 로 각각. 로그가 `<verify_log_dir>/<slug>/`
에 남고 그 경로를 §실행 기록에 적는다. 전체 검증의 `--tasks`에는 이번 레벨과 앞선 완료 작업의 ID를
모두 넣는다. 최신 전체 검증 로그가 이 작업들을 함께 증명해야 한다.
실패는 원인을 분류한다 — 이번 레벨의 변경이면 메인 트리에서
고치고 관련 작업의 trailer 로 커밋한 뒤 다시 돌린다. 기존 실패 · 환경 · 스펙 충돌이면 범위를 넓히지 말고
보고한 뒤 멈춘다. 실패 로그는 지우지 않는다.

### 2e. 체크박스 갱신 — 훅으로 자동화하지 않는다

```sh
node <sdlc_runtime>/tools/plan-check.mjs <스펙 폴더> mark WP-003 --note "<계획과의 차이>" [--pr <링크>]
node <sdlc_runtime>/tools/plan-check.mjs <스펙 폴더> commit --level <N> [--gate <게이트 로그>]…
```

`mark` 는 그 작업을 `- [x]` 로 바꾸고 §실행 기록에 한 줄을 더한다 — 날짜 · 작업 ID · 결과 ·
커밋 SHA · verify 로그 경로 · PR 은 도구가 `plan-progress` 에서 가져오고, **계획과의 차이**만
이 명령이 준다. 기계가 만들 수 없는 값이라 `--note` 는 필수다(차이가 없으면 `--note 없음`).
귀속 커밋이나 verify 기록이 없으면 도구가 **거절한다** — 증거 없이 체크가 서지 않는다.
레벨의 작업을 다 적었으면 `commit` 이 계획서와 그 레벨의 검증 로그**만** 스테이징해 커밋하고,
`plan-progress` 를 다시 돌려 남은 어긋남을 보인다. 어긋남이 0 인지 그 출력에서 확인한다.

훅으로 자동화하지 않는 이유는 그대로다 — «수용 기준을 만족시켰나» 와 «계획과 무엇이 달랐나» 는
판정이고, 도구는 사실(커밋 · 검증 기록)만 대신 나른다. 차이가 크면 `/iterate-spec` 을 권한다.
tests 문장이 파일에 없으면 테스트를 그 이름으로 쓰거나 `tests:` 줄을 실제 이름에 맞춘다 —
체크를 그대로 두고 넘어가지 않는다.

`mark` 가 «status 가 in_progress 가 아니다» 로 거절하면 §1b 의 상태 전이가 빠졌거나
`/iterate-spec` 이 실행 중 계획서를 `accepted` 로 되돌린 것이다. 체크박스를 손으로 찍어
넘기지 말고 status 부터 바로잡는다 — 그대로 두면 남은 작업이 조용히 안 찍힌다.

### 2f. 레벨 보고

`assets/report-templates.md` 의 «레벨 완료» 형식. 수동 검증 서명을 기다리며 다음 자동 작업을 막지는
않지만, 필수 수동 검증이 남아 있으면 plan 을 `completed` 로 바꾸거나 «구현 완료» 라고 보고하지 않는다.

### 2g. push · PR — 사용자가 말할 때만

`target_branch` 로의 커밋과 머지는 실행 절차에 포함된다. `git push` 와 PR 생성은 사용자가 이번 실행에서
명시적으로 요청할 때만 한다. `pr_strategy` 는 분할 방식이지 권한이 아니다. 커밋 제목은 프로필의 `commit`
관례를 따른다.

## Step 3: 독립 감사와 완료 보고

### 3a. 독립 감사 — 프로필에 `audit_agent` 가 있을 때

쓴 쪽이 검증하면 테스트가 구현을 따라 쓰인다. `audit_agent` 가 있고 `writer_agent` 와 다르면
`<sdlc_runtime>/references/audit-prompt.md` 를 채워 읽기 전용으로 띄운다 — `{spec_dir}` `{born}`(plan 최초 커밋)
`{verify_logs}` `{acceptance}`(spec 의 FR/NFR 과 AC 전문). 없거나 같으면 건너뛰고 그 사실을 보고에
적는다. 감사와 자기 대조가 갈리는 AC 는 «미확인» 으로 싣는다 — 같다고 우기지 않는다. 미충족이 하나라도
있으면 끝난 것이 아니다.

### 3b. 완료 보고

`assets/report-templates.md` 의 «완료 보고» 형식. 요구사항 대조가 이 명령의 결론이다 — `spec.md` 의
`AC-*` 마다 만족시키는 코드와 테스트를 `file:line` 으로 댄다. 못 대는 기준이 있으면 그 작업은 끝나지
않았다. 모든 자동 · 필수 수동 검증이 끝났을 때만 plan 을 `completed` 로 바꾸고 커밋한다.

## 규칙

1. **프로필과 plan 이 명령줄의 권위다.** 검증 · 부트스트랩 · 경로 · 브랜치를 지어내지 않는다.
2. **레벨 순서를 지킨다.** 건너뛰거나 바꾸지 않는다.
3. **합류점 검증 없이 다음 레벨로 가지 않는다.**
4. **병렬은 워크트리로만.** 같은 트리에서 검증을 겹쳐 돌리지 않는다.
5. **에이전트에게 스코프 밖 파일을 주지 않는다.** 병렬 레벨에서 이건 곧 손상이다.
6. **수동 검증을 조용히 떨어뜨리지 않는다.** 매 레벨 보고에 실어 나른다.
7. **완료는 셋이 증명한다.** 체크박스 · `SDLC-Task` 커밋 · verify 기록. 갈리면 멈추고 대조한다.
8. **커밋과 머지는 실행 절차에 포함하고, push · PR 은 승인 대상이다.** 스테이징은 도구가 한다 — 작업의 코드는 `task-worktree commit`, 계획서와 검증 로그는 `plan-check commit`. `git add -A` · `git add .` 금지.
9. **스펙이 틀렸으면 밀어붙이지 않는다.** 보고하고 `/iterate-spec`.
10. **에이전트 역할을 섞지 않는다.** 구현 · 감사 · 조사는 서로 다른 에이전트의 일이다.
11. **도구가 내는 값을 손으로 다시 만들지 않는다.** 레벨 · 워크트리 · 커밋 · 프롬프트 · 검증 기록 · 체크박스와 §실행 기록은 도구의 출력이고, 이 명령은 그 위에서 판단만 한다.
