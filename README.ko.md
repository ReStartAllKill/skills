# Skills

*[English](README.md)*

각 변경을 SDLC 산출물 체계 — 의도 · 명세 · 계획 · 구현 — 에 따라 진행하고, 산출물 간
추적 관계를 사후가 아니라 **작성하는 즉시** 검사하는 Claude Code 플러그인.

> **산출물 언어는 한국어나 영어**이며, 저장소 프로필의 `lang`으로 선택한다. 개인 설정이 아니라
> 저장소 설정이다. 산출물 세트는 모든 구성원이 읽는, 커밋된 계약이며 CI에는 언어를 추론할 대화
> 맥락이 없기 때문이다. Claude와는 원하는 언어로 대화해도 산출물은 `lang`을 따른다.
>
> 계약 키워드는 `lang`과 관계없이 **항상 두 언어를 모두 허용한다**. `근거:`와 `basis:`,
> `[필수 · standard+]`와 `[required · standard+]`가 그 예다. 절 제목은 계약에 포함되지 않으며,
> 구조는 ID 접두사와 티어 표식으로 판정한다.
>
> `lang`은 `sdlc-runtime/locales/`에 있는 단어 목록과 글자 수 제한, 즉 문체 번들을 선택한다.
> 한국어 제한값은 이 저장소의 한국어 산출물 42개를 측정해 정했다. **영어 제한값은 유도값**으로,
> 두 README에서 서로 대응하는 아홉 개 절을 바탕으로 한국어 값에 2.2를 곱했다. 로케일 파일에는
> 이 근거와 향후 어떤 자료로 대체해야 하는지가 모두 기록되어 있다. 스킬은 모델에 한국어 지시를
> 줄 수 있지만 런타임 참조 문서는 영어를 사용한다.
>
> `lang`에서 선택한 언어와 다른 언어로 작성한 문서에는 `lang-unsupported`가 표시된다.
> 아무것도 탐지하지 못한 문체 검사는 실제로 통과한 검사와 구분할 수 없기 때문이다.

## 무엇을 푸는가

코드를 잘 쓰는 에이전트가 있어도 diff만으로는 답할 수 없는 질문이 둘 남는다. **왜 했는가**,
그리고 **합의한 것과 아직 같은가**. 나중에 적은 기록은 코드와 갈라지고, 갈라진 사실은
대가를 치른 뒤에야 드러난다.

이 플러그인은 그 답을 변경 옆에 두고, 산출물이 어긋나는 순간 **명확하게 실패를 알린다**.

## SDLC 산출물 체계

```text
finding ──┬─ patch
          ├─ dismiss
          └─ intent → spec → plan → code/test/PR/deploy → finding
                ↑      승인    승인      ↑
                └────── adr ─────────────┘
                   변경보다 오래 산다

research ── 인용 ──▶ intent · adr
```

이 흐름에서 변경마다 만드는 `finding.md`·`intent.md`·`spec.md`·`plan.md` 묶음을 **산출물 세트**라고 한다.
검사기는 세트 안의 ID 참조와 상태 전이를 따라 **추적성**을 검증한다.

| 파일 | 핵심 질문 | 담지 않는 것 |
|---|---|---|
| `finding.md` | 무엇이 관측됐고 어디로 보내나 | 고치는 방법 |
| `research.md` | 무엇을 어떤 기준으로 어느 출처에서 비교했나 | 결정 — 그것은 ADR 이나 intent 의 몫이다 |
| `intent.md` | 왜 필요한가, 무엇이 달라져야 하나 | API · 프레임워크 · 데이터 모델 · 파일 순서 |
| `spec.md` | 어떤 관찰 가능한 동작이면 충족되나 | 내부 클래스 · 함수 · 라이브러리 · 순서 |
| `plan.md` | 어떻게 만들고 안전하게 전달하나 | 문제 배경과 요구사항 원문의 복제 |
| `ADR-NNN.md` | 왜 그렇게 정했고 무엇을 기각했나 | 현재 구현 상세 |

각 문서는 **이번 변경만을 위한 계약**이다. 예외는 ADR로, 이후에도 시스템이 지켜야 할 제약을
기록한다. 코드는 «무엇»의 정본이지만 «왜»의 정본은 아니다. 기각한 대안과 판단의 바탕이 된
전제까지 diff가 보존하지는 못한다.

## 문서에 나오는 ID

산출물은 문단이 아니라 **ID가 붙은 항목**으로 쓴다. 하위 문서는 상위 문서를 `근거:`로
가리키고 검사기는 그 연결을 추적한다. 따라서 접두사만 보면 어느 문서의 어떤 항목인지 알 수
있다. 한국어판은 `sdlc-runtime/conventions.ko.md`의 §ID 접두에서 확인할 수 있다.

### 문서 ID

형식은 각 스킬의 `assets/*-template.md`가 정한다.

| 형식 | 문서 |
|---|---|
| `FND-YYYY-NNN` | finding |
| `RSH-YYYY-NNN` | research |
| `CHG-YYYY-NNN` | intent |
| `SPEC-YYYY-NNN` | spec |
| `PLAN-YYYY-NNN` | plan |
| `ADR-NNN` | ADR — 연도가 없고, 저장소 안에서 단조 증가하며 재사용하지 않는다 |

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
| `CRIT-*` | 비교 기준 | research §기준 |
| `SRC-*` | 출처 | research §출처 |
| `OPT-*` | 선택지 | research §선택지 |
| `REC-*` | 판단 | research §판단 |

### 열린 질문 — 접두가 곧 답할 사람

| 접두 | 문서 | 닫는 사람 |
|---|---|---|
| `Q-*` | intent | 제품 책임자 |
| `SQ-*` | spec | 명세 검토자 |
| `PQ-*` | plan | 구현 책임자 |
| `FQ-*` | finding | 서비스 소유자 · 온콜 |
| `RQ-*` | research | 조사 소유자 |

ID는 항목을 삭제한 뒤에도 **재사용하지 않는다.** 그래야 `FR-003`이 언제나 같은 항목을 가리킨다.

## 무엇이 실제로 강제하는가

세 가지 장치가 **서로 다른 시점에**, 각기 다른 목적으로 작동한다.

| | 시점 | 하는 일 |
|---|---|---|
| **승인 가드** | `PreToolUse` | 자기 승인과 승인된 문서의 무승인 변경을 막는다. 사후 검사는 쓰기를 되돌릴 수 없으므로 **쓰기 전**에 실행된다. |
| **산출물 게이트** | `PostToolUse` | 문서를 저장하는 즉시 구조 · 추적성 · 문체를 검사해 바로 수정할 수 있게 한다. |
| **CI 검사기** | `check-all.mjs` | 저장소의 **모든** 산출물 세트를 검사한다. 훅은 개인 장비에서만 작동할 수 있으므로 팀의 관문은 CI가 맡는다. |

게이트는 방금 수정한 폴더만 검사한다. 따라서 상위 문서가 바뀌어도 수정하지 않은 하위 문서는
조용히 오래된 상태가 될 수 있다. 이런 추적성 단절이 가장 흔하기 때문에 CI 검사기가 저장소
전체를 검사한다.

## 설치

```bash
claude plugin marketplace add ReStartAllKill/skills
claude plugin install restart-harness
```

두 이름이 다른 것은 가리키는 대상이 다르기 때문이다. `skills`는 마켓플레이스를 담은 저장소이고,
`restart-harness`는 그 안의 플러그인이다.

그다음 산출물 체계를 사용할 **저장소마다** 한 번 실행한다.

```
/sdlc-init
```

이 명령은 프로필(`.claude/spec-profile.yml`)을 만들고, 훅 두 개를 설치하고, CI에 추가할
명령을 안내한다.

**플러그인 설치만으로는 아무 기능도 활성화되지 않는다.** 프로필이 없는 저장소에서는 훅이
**조용히 종료된다**. 검사가 누락되는 것이 아니라, 명시적으로 사용 설정하지 않은 저장소를
플러그인이 건드리지 않는 것이다. `intent.md`와 `plan.md`는 흔한 파일명이기 때문이다.

## 스킬

### `sdlc` — 산출물 체계

| 스킬 | 언제 |
|---|---|
| `/sdlc-init` | 저장소에 산출물 체계를 설정할 때 |
| `/create-finding` | 장애 · 알림 · 이상 지표 · 스캔 결과를 산출물 체계의 입력으로 만들 때 |
| `/create-research` | 결정하기 전에 선택지나 사례를 비교할 때 — 출처 · 기준 · 비교를 증거로 남긴다 |
| `/create-intent` | 변경을 시작할 때 — «무엇» 보다 «왜» 를 먼저 확정한다 |
| `/create-spec` | 승인된 의도를 검증 가능한 동작으로 옮길 때 |
| `/create-plan` | 승인된 명세를 작업으로 쪼갤 때 |
| `/create-light` | 되돌리기 쉬운 작은 변경 — 세 문서를 한 번에 쓸 때 |
| `/implement-spec` | 계획을 레벨 단위로 실행할 때 |
| `/iterate-spec` | 피드백 · 리뷰로 명세가 달라져야 할 때 |
| `/create-adr` | 되돌리기 어려운 결정이라 변경보다 오래 살아야 할 때 |
| `/create-pr` | 브랜치를 PR로 만들 때 — 본문의 근거를 diff가 아니라 승인된 산출물에서 가져온다 |

외부 계약과 데이터가 바뀌지 않고 revert나 플래그로 되돌릴 수 있는 변경이면 `/create-light`를
쓴다 — intent·spec·plan을 그대로 쓰고 같은 검사기·린터를 돌리고 같은 승인 세 번을 받되, 한 번에
쓰고 한 커밋에 담는다. 그 밖의 변경은 `/create-intent` → `/create-spec` → `/create-plan`으로
가며, 각 단계는 다음 문서를 쓰기 전에 검토에서 멈춘다. `sdlc_version`이 7 이상이어야 한다.

`/implement-spec`은 같은 레벨의 작업을 별도의 Git 워크트리에서 병렬로 실행하고, 합류점마다
전체 검증을 수행한다.

`/create-pr`은 원격 상태를 변경하는 유일한 스킬이며, 명시적으로 요청할 때만 실행된다.
`/implement-spec`은 로컬 커밋과 병합까지만 수행하며 푸시하거나 PR을 열지 않는다.

### `eval` — 에이전트를 잰다

| 스킬 | 언제 |
|---|---|
| `/agent-eval` | 하네스를 바꾸고, 실제로 나아졌는지 알고 싶을 때 |

세 가지 난이도로 결함을 심고, 두 설정을 각각 *k*회 병렬 실행한 뒤 루브릭에 따라 채점하여
비교 보고서를 만든다. “그 프롬프트 수정이 도움이 되었나?”라는 질문에 인상 대신 수치로 답한다.

## 저장소 구조

```
.claude-plugin/     plugin.json (skills 배열이 정본) · marketplace.json
skills/             스킬만 포함 — 모든 항목에 SKILL.md가 있다
  sdlc/<이름>/      SKILL.md · assets/<언어>/ · references/ · scripts/ · evals/
  eval/agent-eval/  SKILL.md · rubrics/ · scripts/ · cases/
sdlc-runtime/       규약 · 검사기 · 참조 문서. 스킬 · 훅 · CI가 함께 쓴다
agents/             eval-case-author · eval-grader
commands/           eval-agent
scripts/            유지보수용
```

`agents/`가 플러그인 루트에 있는 이유는 스킬 폴더 안의 에이전트가 **등록되지 않기** 때문이다.
`sdlc-runtime/`이 `skills/` 밖에 있는 이유는 훅과 CI도 이를 사용하기 때문이다. 이 구조 덕분에
“`skills/` 아래의 모든 항목은 스킬이다”라는 규칙도 유지된다.

## 런타임을 어디서 읽는가

`sdlc-runtime/`의 규약과 검사기는 다음 순서로 찾는다.

1. 저장소 프로필의 `sdlc_runtime`
2. 저장소의 `.claude/sdlc` — 벤더링한 사본
3. 설치된 플러그인

**이 순서 자체가 정책이다.** 저장소에 고정된 사본이 가장 높은 우선순위를 갖는다. 벤더링
(`sdlc-runtime/tools/vendor-runtime.sh`)의 목적은 팀과 CI가 같은 검사기를 사용하게 하는 데
있으며, 훅과 스킬이 서로 다른 사본을 읽으면 그 목적을 달성할 수 없다.

CI 러너에는 플러그인이나 홈 디렉터리가 없으므로, 검사기를 병합 관문에 포함하려면 벤더링이
사실상 유일한 방법이다.

## 개발

개발할 때는 사본을 설치하지 말고 심볼릭 링크를 사용한다. 그러면 Claude Code가 이 저장소를
직접 로드하므로 수정 사항이 즉시 반영되고, `git pull`로 업데이트할 수 있다.

```bash
./scripts/link-plugin.sh     # ~/.claude/skills/restart-harness -> 이 저장소
```

그다음 `/reload-plugins`를 실행한다. 마켓플레이스로 설치하면 플러그인 캐시에 **사본**이 생기며,
`claude plugin update`를 실행하기 전까지 업데이트되지 않는다.

```bash
./scripts/list-skills.sh                        # 디스크 ↔ plugin.json 대조
claude plugin validate .
claude plugin details restart-harness           # 컴포넌트와 토큰 비용
node sdlc-runtime/evals/run.mjs                 # 검사기 · 런타임 스위트
node --test sdlc-runtime/evals/*.test.mjs \
  skills/sdlc/create-pr/evals/tools.test.mjs      # 러너 + create-pr 스크립트 회귀
python3 -m unittest discover -s skills/eval/agent-eval/scripts -p 'test_*.py'
```

GitHub Actions는 push·PR마다 Linux와 macOS에서 위 회귀 테스트와 스킬 등록 검사를 실행한다.
환경은 Node.js 24·Python 3.12이며 모델 API를 호출하지 않는다. 세부 범위는
[평가 안내](sdlc-runtime/evals/README.md)를 참고한다.

### 스킬을 더할 때

`plugin.json`의 `skills` 배열이 **정본**이다. 자동 탐색은 `skills/`의 한 단계 아래까지만
확인하지만, 이 저장소는 스킬을 카테고리별로 묶으므로 배열에 선언된 스킬만 로드된다. 스킬을
만들고 선언하지 않으면 목록에 나타나지 않는 것 외에는 별다른 증상이 없다.
`scripts/list-skills.sh`가 이 누락을 찾아낸다.

## 배포

**`plugin.json`의 `version`을 올려야 변경 사항이 배포된다.** `claude plugin update`는 파일
내용이 아니라 이 값을 비교하므로, 내용만 바꾸고 버전을 유지하면 “이미 최신 버전”이라고 알린다.

```bash
# 1. plugin.json의 version을 올리고 CHANGELOG.md에 기록한다
# 2. 검사
./scripts/list-skills.sh
claude plugin validate .
node sdlc-runtime/evals/run.mjs
node --test sdlc-runtime/evals/runner.test.mjs skills/sdlc/create-pr/evals/tools.test.mjs
python3 -m unittest discover -s skills/eval/agent-eval/scripts -p 'test_*.py'
# 3. 푸시
git push
```

사용자는 `claude plugin update restart-harness`를 실행해 업데이트한다. 업데이트 과정에서는 새
버전 디렉터리를 만들고 **이전 사본을 삭제하지 않는다.** 따라서 훅의 검색 경로에 여러 버전이
함께 존재할 수 있으며, 수정 시간순(`ls -td`)으로 가장 최신 버전을 선택한다. 사전순으로
정렬하면 `0.1.10`이 나온 뒤에도 `0.1.9`가 선택될 수 있다.

## 라이선스

MIT
