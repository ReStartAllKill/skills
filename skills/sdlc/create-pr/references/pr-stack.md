# 스택 PR (GitHub native stack)

선행 PR 위에 여러 변경을 선형으로 쌓는 same-repository stack 을 만들 때만 읽는다. 독립 PR 이나 서로 다른
저장소의 PR 은 stack 으로 강제하지 않는다.

plan 의 `pr_strategy` 가 «레벨별 PR» 이고 레벨이 선형으로 이어지면 여기가 그 자리다. 레벨끼리 의존이
갈라지면(같은 레벨에 형제 작업이 여럿) stack 이 아니라 독립 Draft PR 로 나눈다.

```bash
gh version                           # gh 2.0 이상
gh extension install github/gh-stack # 이미 설치되어 있으면 건너뜀
gh stack --help
```

새 stack 은 `gh stack init --base <trunk> <bottom-branch>` 로 시작하고, 각 layer 를 `gh stack add <branch>`
로 만든 뒤 `gh stack submit --auto` 로 제출한다. `--auto` 로 새 PR 을 Draft 로 만들며 `--open` 은 쓰지 않는다.

이미 열린 선형 PR 묶음이나 native stack 에 등록되지 않은 legacy PR 은 아래처럼 bottom 부터 top 순서로
등록한다. `gh stack link` 가 PR base 를 stack 순서에 맞게 연결하지만 local tracking 은 만들지 않으므로, link
결과는 `gh pr view` 로 확인한다.

```bash
gh stack link <parent-pr> <child-pr> [...]
gh pr view <child-pr> --json baseRefName,headRefName,isDraft
```

`gh stack link` 이 성공해도 base 관계만 맞고 native stack object 가 없을 수 있으므로, REST API 의
`.stack` 을 확인한다. `.stack == null` 이면 stack 등록 실패로 보고 동기화를 진행하지 않는다.

```bash
repo="$(gh repo view --json nameWithOwner --jq '.nameWithOwner')"
gh api "repos/$repo/pulls/<child-pr>" \
  -H 'X-GitHub-Api-Version: 2026-03-10' \
  --jq 'if .stack == null then error("native stack object 없음") else .stack end'
```

link 한 stack 을 local 에서도 관리하려면 `gh stack checkout <child-pr>` 로 tracking 을 만든다. local
tracking 이 있는 stack 을 동기화할 때만 clean tree 와 remote head·PR 상태를 확인한 뒤 `gh stack sync` 를
실행한다. parent PR 이 머지된 뒤 local merged branch 삭제가 명시적으로 필요할 때만 결과를 확인하고
`gh stack sync --prune` 을 추가한다. sibling DAG 나 서로 다른 저장소의 PR 은 stack 으로 강제하지 않고
독립 Draft PR 로 분리한다.

`gh stack sync` 가 conflict 나 divergence 를 감지하면 branch·PR 을 갱신하지 않고 중단한다. 충돌을
해결해야 하면 `gh stack rebase` 와 `gh stack push` 만 사용하며, `gh pr edit --base`, `git rebase`, 수동
강제 push 로 우회하지 않는다. extension·version·auth 사전 조건이나 linear stack 조건이 충족되지 않으면
PR base 나 branch 를 바꾸지 말고 실패 원인을 보고한 뒤 중단한다.
