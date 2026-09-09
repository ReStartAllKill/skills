# restart-harness

*[English](README.md)*

변경을 SDLC 산출물 체계 — 의도 · 명세 · 계획 · 구현 — 로 진행하고, 산출물 간 추적 관계를
**쓰는 그 자리에서** 검사하는 Claude Code 플러그인.

> **산출물 언어는 한국어나 영어**이고, 프로필의 `lang` 이 레포마다 한 번 정한다. 사람 설정이
> 아니라 레포 설정이다 — 산출물 세트는 커밋되는 계약이라 모두가 같은 것을 읽어야 하고, CI 에는 언어를
> 물어볼 대화가 없다. 대화는 아무 언어로나 해도 산출물은 `lang` 을 따른다.
>
> 계약 낱말은 `lang` 과 무관하게 **언제나 양쪽을 다 받는다** — `근거:` 와 `basis:`,
> `[필수 · 모든 티어]` 와 `[required · all tiers]`. 절 제목은 애초에 계약이 아니다. 구조는
> ID 접두와 티어 표식으로 판정한다.
>
> `lang` 이 고르는 것은 문체 번들이다 — `sdlc-runtime/locales/` 의 낱말 목록과 글자 한도.
> 한국어 값은 이 레포의 산출물 42개 실측이고, **영어 값은 유도한 것**이다(한국어의 2.2배, 병렬
> README 아홉 절의 비율). 파일에 그 사실과 무엇으로 대체할지가 적혀 있다. 스킬과 참조 문서는
> 여전히 한국어다 — 사람이 아니라 모델이 읽는 글이다.
>
> `lang` 과 다른 언어로 쓴 문서에는 `lang-unsupported` 가 그대로 뜬다. 아무것도 안 걸리는
> 문체 검사는 통과한 검사와 구분되지 않기 때문이다.

## 무엇을 푸는가

코드를 잘 쓰는 에이전트를 두어도 diff 로는 답할 수 없는 질문이 둘 남는다. **왜 했는가**,
그리고 **합의한 것과 아직 같은가**. 나중에 적은 기록은 코드와 갈라지고, 갈라진 사실은
대가를 치른 뒤에야 드러난다.

이 플러그인은 그 답을 변경 옆에 두고, 어긋나는 순간 **소리내어 실패하게** 만든다.

## SDLC 산출물 체계

```text
finding ──┬─ patch
          ├─ dismiss
          └─ intent → spec → plan → code/test/PR/deploy → finding
                ↑      승인    승인      ↑
                └────── adr ─────────────┘
                   변경보다 오래 산다
```

이 흐름이 변경마다 만드는 `finding.md`·`intent.md`·`spec.md`·`plan.md` 묶음을 **산출물 세트**라고 한다.
검사기는 세트 안의 ID 참조와 상태 전이를 따라 **추적성**을 검증한다.

| 파일 | 핵심 질문 | 담지 않는 것 |
|---|---|---|
| `finding.md` | 무엇이 관측됐고 어디로 보내나 | 고치는 방법 |
| `intent.md` | 왜 필요한가, 무엇이 달라져야 하나 | API · 프레임워크 · 데이터 모델 · 파일 · 순서 |
| `spec.md` | 어떤 관찰 가능한 동작이면 충족되나 | 내부 클래스 · 함수 · 라이브러리 · 순서 |
| `plan.md` | 어떻게 만들고 안전하게 전달하나 | 문제 배경과 요구사항 원문의 복제 |
| `ADR-NNN.md` | 왜 그렇게 정했고 무엇을 기각했나 | 현재 구현 상세 |

각 문서는 **이번 변경의 계약**이다. 예외는 ADR 하나로, 시스템이 그때부터 지고 가는 제약을
적는다. 코드는 «무엇» 의 정본이지 «왜» 의 정본이 아니다 — 기각한 대안과 그 판단이 서 있던
전제는 diff 가 전달하지 못한다.

## 문서에 나오는 ID

산출물은 문단이 아니라 **ID 가 붙은 항목**으로 쓴다. 하위 문서가 상위를 `근거:` 로 가리키고
검사기가 그 연결을 추적하는 단위라, 접두가 곧 «이건 어느 문서의 무엇인가» 다.
정본은 `sdlc-runtime/conventions.md` §ID 접두 다.

### 문서 ID

형식은 각 스킬의 `assets/*-template.md` 가 정한다.

| 형식 | 문서 |
|---|---|
| `FND-YYYY-NNN` | finding |
| `CHG-YYYY-NNN` | intent |
| `SPEC-YYYY-NNN` | spec |
| `PLAN-YYYY-NNN` | plan |
| `ADR-NNN` | ADR — 연도가 없고, 레포 안에서 단조 증가하며 재사용하지 않는다 |

### 항목 ID

| 접두 | 뜻 | 어디에 쓰나 |
|---|---|---|
| `OUT-*` | 목표 결과 | intent §목표 결과 |
| `CON-*` | 제약 · 불변 조건 | intent §제약 |
| `ASM-*` | 가정 · 전제 | intent §가정 · ADR §문맥과 결정 요인 |
| `SCN-*` | 시나리오 | spec §시나리오 |
| `FR-*` | 기능 요구사항 | spec §요구사항 |
| `NFR-*` | 비기능 요구사항 | spec §비기능 요구사항 |
| `AC-*` | 수용 기준 | FR · NFR 밑 체크박스 |
| `EDGE-*` | 오류 · 경계 조건 | spec §오류와 경계 |
| `SD-*` | 명세 결정 | spec §열린 질문과 결정 |
| `TD-*` | 설계 결정 | plan §설계 결정 |
| `WP-*` | 작업 | plan §작업 |
| `RISK-*` | 위험 | plan §위험 |
| `EV-*` | 관측 | finding §관측 |
| `HYP-*` | 가설 | finding §진단 |
| `ALT-*` | 대안 | ADR §대안 |
| `RV-*` | 재검토 조건 | ADR §확인과 재검토 |

### 열린 질문 — 접두가 곧 답할 사람

| 접두 | 문서 | 닫는 사람 |
|---|---|---|
| `Q-*` | intent | 제품 책임자 |
| `SQ-*` | spec | 명세 검토자 |
| `PQ-*` | plan | 구현 책임자 |
| `FQ-*` | finding | 서비스 소유자 · 온콜 |

ID 는 지워져도 **재사용하지 않는다.** 그래야 `FR-003` 이 언제나 한 항목을 가리킨다.

## 무엇이 실제로 강제하는가

셋이 **서로 다른 시점에** 돈다. 다른 것이 설계다.

| | 시점 | 하는 일 |
|---|---|---|
| **승인 가드** | `PreToolUse` | 자기승인과, 승인된 문서의 무승인 변경을 막는다. 쓰기 **전**에 서는 이유는 뒤에 서는 훅이 되돌리지 못하기 때문이다. |
| **산출물 게이트** | `PostToolUse` | 문서를 저장한 그 순간 구조 · 추적성 · 문체를 본다. 그 자리에서 고칠 만큼 빠르다. |
| **CI 검사기** | `check-all.mjs` | 레포의 **모든** 산출물 세트를 본다. 훅은 개인 장비에 있어 팀원에게 없을 수 있고, 그래서 훅만으로는 관문이 못 된다. |

게이트는 방금 만진 폴더만 본다. 그래서 상위 문서가 바뀐 뒤 아무도 안 건드린 하위는 조용히
낡아간다 — 이런 산출물 세트에서 가장 흔한 붕괴가 정확히 그 모양이고, CI 검사기는 그것을 잡으려고
있다.

## 설치

```bash
claude plugin marketplace add ReStartAllKill/restart-harness
claude plugin install restart-harness
```

그다음 산출물 체계를 사용할 **레포마다** 한 번:

```
/sdlc-init
```

프로필(`.claude/spec-profile.yml`)을 쓰고, 훅 둘을 걸고, CI 에 붙일 한 줄을 낸다.

**설치만으로는 아무것도 켜지지 않는다.** 프로필이 없는 레포에서 훅은 **조용히 빠진다** —
관문이 열린 채 실패하는 것이 아니라, 부탁한 적 없는 레포를 안 건드리는 것이다.
`intent.md` · `plan.md` 는 흔한 파일명이다.

## 스킬

### `sdlc` — 산출물 체계

| 스킬 | 언제 |
|---|---|
| `/sdlc-init` | 레포에 산출물 체계를 설정할 때 |
| `/create-finding` | 장애 · 알림 · 이상 지표 · 스캔 결과를 산출물 체계의 입력으로 만들 때 |
| `/create-intent` | 변경을 시작할 때 — «무엇» 보다 «왜» 를 먼저 확정한다 |
| `/create-spec` | 승인된 의도를 검증 가능한 동작으로 옮길 때 |
| `/create-plan` | 승인된 명세를 작업으로 쪼갤 때 |
| `/implement-spec` | 계획을 레벨 단위로 실행할 때 |
| `/iterate-spec` | 피드백 · 리뷰로 명세가 달라져야 할 때 |
| `/create-adr` | 되돌리기 어려운 결정이라 변경보다 오래 살아야 할 때 |
| `/create-pr` | 브랜치를 PR 로 올릴 때 — 본문의 «왜» 를 diff 가 아니라 산출물 세트에서 가져온다 |

`/implement-spec` 은 같은 레벨의 작업을 각자의 git 워크트리에서 병렬로 돌리고, 합류점마다
전체 검증을 돌린다.

`/create-pr` 은 밖으로 나가는 유일한 스킬이라 요청했을 때만 돈다. `/implement-spec` 은 커밋과
병합까지만 하고 push·PR 은 하지 않는다.

### `eval` — 에이전트를 잰다

| 스킬 | 언제 |
|---|---|
| `/agent-eval` | 하네스를 바꾸고, 실제로 나아졌는지 알고 싶을 때 |

난이도 세 단계로 결함을 심고, 설정 두 벌을 각각 k 회씩 병렬로 돌리고, 루브릭으로 채점해
비교 리포트를 낸다. «그 프롬프트 수정이 도움이 됐나» 에 인상 대신 숫자로 답한다.

## 레포 구조

```
.claude-plugin/     plugin.json (skills 배열이 정본) · marketplace.json
skills/             스킬만 산다 — 여기 있는 것은 전부 SKILL.md 를 가진다
  sdlc/<이름>/      SKILL.md · assets/<언어>/ · references/ · scripts/ · evals/
  eval/agent-eval/  SKILL.md · rubrics/ · scripts/ · cases/
sdlc-runtime/       규약 · 검사기 · 참조 문서. 스킬 · 훅 · CI 가 함께 쓴다
agents/             eval-case-author · eval-grader
commands/           eval-agent
scripts/            유지보수용
```

`agents/` 가 루트에 있는 것은 스킬 폴더 안에 둔 에이전트가 **등록되지 않기** 때문이다.
`sdlc-runtime/` 이 `skills/` 밖인 것은 훅과 CI 도 그것을 부르기 때문이고, 그래야 «`skills/`
아래는 전부 스킬» 이라는 규칙 한 줄이 참으로 남는다.

## 런타임을 어디서 읽는가

`sdlc-runtime/` 의 규약과 검사기는 이 순서로 찾는다.

1. 레포 프로필의 `sdlc_runtime`
2. 레포의 `.claude/sdlc` — 벤더한 사본
3. 설치된 플러그인

**순서가 곧 정책이다.** 레포가 고정한 사본이 가장 세다 — 팀과 CI 가 같은 검사기를 쓰게
하려는 것이 벤더(`sdlc-runtime/tools/vendor-runtime.sh`)의 유일한 목적이라, 훅이 스킬과 다른
사본을 읽으면 그 목적이 무너진다.

CI 러너에는 플러그인도 홈 디렉터리도 없으니, 검사기를 머지 관문에 두려면 벤더가 사실상
유일한 길이다.

## 개발

**사본을 만들지 않는다.** 심링크 하나면 Claude Code 가 이 레포를 제자리에서 로드해, 고친 것이
곧 도는 것이 되고 `git pull` 이 곧 갱신이다.

```bash
./scripts/link-plugin.sh     # ~/.claude/skills/restart-harness -> 이 레포
```

그다음 `/reload-plugins`. 마켓플레이스로 설치하면 플러그인 캐시에 **사본**이 생겨
`claude plugin update` 전까지 움직이지 않는다.

```bash
./scripts/list-skills.sh                        # 디스크 ↔ plugin.json 대조
claude plugin validate .
claude plugin details restart-harness           # 컴포넌트와 토큰 비용
node sdlc-runtime/evals/run.mjs                 # 검사기 · 런타임 스위트
node --test sdlc-runtime/evals/runner.test.mjs \
  skills/sdlc/create-pr/evals/tools.test.mjs      # 러너 + create-pr 스크립트 회귀
python3 -m unittest discover -s skills/eval/agent-eval/scripts -p 'test_*.py'
```

GitHub Actions는 push·PR마다 Linux와 macOS에서 위 회귀 테스트와 스킬 등록 검사를 실행한다.
환경은 Node.js 24·Python 3.12이며 모델 API를 호출하지 않는다. 세부 범위는
[평가 안내](sdlc-runtime/evals/README.md)를 참고한다.

### 스킬을 더할 때

`plugin.json` 의 `skills` 배열이 **정본**이다. 자동 탐색은 `skills/` 한 단만 들어가는데 이
레포는 스킬을 카테고리로 묶으므로, 배열에 적은 것만 로드된다. 만들고 선언을 잊은 스킬은
«안 뜬다» 외에 아무 증상이 없다. `scripts/list-skills.sh` 가 그것을 잡는다.

## 배포

**`plugin.json` 의 `version` 을 올리지 않으면 아무에게도 나가지 않는다.** `claude plugin update`
는 파일 내용이 아니라 그 값을 본다 — 내용만 고치고 버전을 그대로 두면 «최신입니다» 로 끝난다.

```bash
# 1. plugin.json 의 version 을 올리고 CHANGELOG 에 적는다
# 2. 검사
./scripts/list-skills.sh
claude plugin validate .
node sdlc-runtime/evals/run.mjs
node --test sdlc-runtime/evals/runner.test.mjs skills/sdlc/create-pr/evals/tools.test.mjs
python3 -m unittest discover -s skills/eval/agent-eval/scripts -p 'test_*.py'
# 3. 밀면 끝
git push
```

받는 쪽은 `claude plugin update restart-harness` 다. 갱신은 새 버전 디렉터리를 만들고 **옛
사본을 지우지 않는다.** 훅이 찾는 경로에 여러 버전이 걸리므로 탐색은 시간순(`ls -td`)으로
최신을 고른다 — 사전순이면 `0.1.10` 이 나오는 날 `0.1.9` 를 고른다.

## 라이선스

MIT
