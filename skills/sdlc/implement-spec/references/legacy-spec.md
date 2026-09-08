# 옛 형식 스펙 실행

폴더에 `plan.md` 가 없고 `tasks.md` 가 있으면 구형 스키마다. **실행만을 위해 다시 쓰게 하지 않는다.**
그 스펙의 의미를 고쳐야 하면 `/create-intent` 로 새 사슬을 시작한다.

| 옛 파일 | 지금의 자리 | 읽는 법 |
|---|---|---|
| `requirements.md` | spec.md | `R-<n>` 이 요구사항이다. 수용 기준은 그 밑 체크박스 |
| `design.md` | plan.md §설계 결정 · §릴리스 영향 | `§Release Impact` 에서 `target_branch` · `pr_strategy` · 되돌리기를 읽는다 |
| `tasks.md` | plan.md §작업 | `T-<n>` 이 작업이다. `files` · `depends` · `covers` 를 같은 뜻으로 읽는다 |

- 검사기 · `plan-levels` · `task-worktree` · `task-brief` · `plan-progress` 는 옛 형식을 읽지 않는다.
  레벨 계산과 워크트리 · 커밋 · 합류를 손으로 한다 — 규칙은 같다: 작업의 files 만 스테이징, 하나씩 머지,
  레벨마다 전체 verify.
- `SDLC-Task: T-<n>` trailer 는 붙인다. 진행 상태는 체크박스와 git log 를 눈으로 대조한다.
- 합류점 verify 는 `verify-run.mjs` 로 돌릴 수 있다 — 스펙 폴더에 프로필 조상만 있으면 된다.
  `--tasks T-3,T-4` 처럼 옛 ID 를 그대로 쓴다.
