# 산출물 규약

*[English](conventions.md)*

SDLC 산출물에 공통으로 적용되는 계약이다. 스킬은 작성 절차를 정의하고, 이 문서는 유효한
결과를 정의한다. `check-artifacts.mjs`는 기계적 판정의 정본이다. 둘이 어긋나면 함께 수정한다.

조건부 세부사항은 필요한 때만 읽는다.

- 레포 초기화·프로필: `references/profile.md`
- 문체·글자 한도: `references/prose.md`
- 작업 형식과 완료 증거: `references/tasks.md`
- 스키마 버전과 상위 핀: `references/schema.md`
- 여러 저장소에 걸친 변경: `references/multi-repo.md`
- 탐지 밴드: `references/bands.md`
- 훅·CI·벤더 런타임: `sdlc-runtime/references/runtime.md`
- 자율 실행 정책: `references/autonomy.md`

## 권위와 수명

각 산출물 세트는 시스템 전체의 진실이 아니라 **이번 변경의 계약**이다. 구현 중 승인된 외부
동작과 기존 코드가 충돌하면 스펙을 버리지 않는다 — 충돌을 보고하고 `/iterate-spec`으로 스펙을
갱신한 뒤 계속한다.

머지 뒤에는 코드와 PR 본문이 현재 구현의 정본이다. 문서 경로를 코드나 주석에서 참조하지 않는다.

**유일한 예외는 ADR이다.** 코드는 «무엇»의 정본이지만 «왜»의 정본은 아니다. 되돌리기 어려운
결정은 시스템이 계속 지고 가는 제약이라 산출물 세트 밖 `<adr_dir>`에 기록하고 세트에서는
`decisions:`로 참조한다. 자세한 규약은 `references/adr.md`에 있다.

## 산출물 체계와 문서 경계

```text
finding ──┬─ patch
          ├─ dismiss
          └─ intent → spec → plan → code/test/PR/deploy → finding
                ↑      승인    승인      ↑
                └────── adr ─────────────┘
                   변경보다 오래 산다

research ── 인용 ──▶ intent · adr
```

| 파일 | 핵심 질문 | 담지 않는 것 |
|---|---|---|
| `finding.md` | 무엇이 관측됐고 어디로 보내나 | 고치는 방법 |
| `research.md` | 무엇을 어떤 기준으로 어떤 출처에서 비교했나 | 결정 — ADR이나 intent의 몫 |
| `intent.md` | 왜 필요한가, 무엇이 달라져야 하나 | API·프레임워크·데이터 모델·파일·순서 |
| `spec.md` | 어떤 관찰 가능한 동작이면 충족되나 | 내부 클래스·함수·파일·라이브러리·순서 |
| `plan.md` | 어떻게 만들고 안전하게 전달하나 | 문제 배경과 요구사항 원문의 복제 |
| `ADR-NNN-*.md` | 왜 그렇게 정했고 무엇을 기각했나 | 현재 구현 상세 · 담당자 · 일정 |

`plan.md`는 설계와 작업을 함께 가지며 `/implement-spec`이 이 파일 하나를 입력으로 쓴다.
`finding.md`와 `research.md`는 세트의 구성원이 아니라 입력이다 — 발견은 세트 하나를 열고,
조사는 의도보다 앞서며 여러 문서가 인용한다.

들어오는 길은 둘이다. 사람은 의도에서 출발해 문서마다 승인하고, 기계 신호는 발견에서 출발해
미리 선언한 정책이 `advance_to`까지 승인한 뒤 세트가 `in_review`로 멈춘다. 자세한 내용은
`references/autonomy.md`에 있다.

### 작성자와 완성 책임자

| 문서 | 시작 | 완성 | `approved_by` |
|---|---|---|---|
| `intent.md` | 발안자(기획·제품) | 발안자 | 제품 책임자 |
| `spec.md` | 발안자 — 시나리오 SCN · FR의 동작 문장 · 우선순위 | 엔지니어 — AC의 정밀도 · EDGE · NFR · 인터페이스 계약 · 데이터 (`/iterate-spec`) | 엔지니어 리드. PR 리뷰는 발안자와 엔지니어 둘 다 |
| `plan.md` | 엔지니어 | 엔지니어 | 엔지니어 리드 |

발안자만 쓴 spec은 «정상 동작한다»에서 멈추고, 엔지니어만 쓴 spec은 사용자 흐름을 잃는다.
발안자는 모르는 내용을 추측해 채우지 않는다 — `SQ-*`로 남기고 `in_review`로 넘긴다.

### 변경이 여러 저장소에 걸치면

spec은 시스템마다 하나만 쓰고 저장소마다 쓰지 않으며, 각 수용 기준을 어느 저장소가 구현하는지
적는다 — 요구사항의 `scope:` 줄이나 수용 기준 줄 끝의 `` `scope: <repo>` ``. 소유·상류 락·
커버리지·ADR의 자리는 `references/multi-repo.md`에 있다.

## 산출물 문법

항목은 표의 행이 아니라 헤딩으로 쓴다 — 사람이 읽는 글이 곧 검사기가 읽는 구조다. 표는 대안
비교·상태 전이·지표 비교처럼 진짜 2차원 자료에 쓴다.

- 정의: `### <ID> — <제목>`, 우선순위는 `` `Must|Should|Could|Won't` ``.
- 필드: `근거:`, `확인:`, `covers:`처럼 `키: 값` 한 줄.
- 수용 기준: `- [ ] AC-001 — <언제>이면 시스템은 <무엇을> 한다`.
- 작업: 체크박스와 들여쓴 다섯 필드.
- 코드펜스 안의 예시는 정의로 세지 않는다.
- 템플릿 주석과 placeholder는 산출물에서 지운다.

검사기가 인식하는 문자열은 모두 `tools/keywords.mjs`에 있다 — 영어가 정본, 한국어가 별칭이고
프로필의 `lang`과 무관하게 둘 다 항상 허용된다. **절 제목은 계약이 아니다** — 구조는 ID 접두와
티어 표식으로 판정한다. 예외는 plan의 §실행 기록·§릴리스 영향과 ADR의 다섯 절뿐이고, 그 자리도
별칭을 받는다.

## 티어

`intent.md`에서 한 번 정하고 `spec.md`와 `plan.md`가 상속한다.

| 티어 | 기준 |
|---|---|
| `light` | 외부 계약과 데이터가 안 바뀌고 revert나 플래그로 즉시 되돌릴 수 있다 |
| `standard` | 기본값. 사용자가 보는 동작·성능·오류 처리가 달라진다 |
| `full` | 마이그레이션·공개 계약·개인정보·규제·보안 경계·대규모 출시가 있다 |

판단이 어려우면 더 높은 티어를 선택한다. plan에서 더 큰 위험을 발견하면 intent부터 티어를 올린다.
`finding.md`는 산출물 체계의 입력이라 티어를 상속하지 않고 자체 영향을 기준으로 정한다.

표식 없는 `##` 헤딩은 모든 티어에서 필수다. 표식 없는 `###` 헤딩은 검사하지 않는다. 표식은 그
범위를 좁힌다.

| 섹션 표기 | 뜻 |
|---|---|
| `[필수 · standard+]` | standard·full에서 필수 |
| `[필수 · full]` | full에서 필수 |
| `[조건부 · <조건>]` | 조건이 성립할 때 필수. 아니면 `해당 없음 — <근거>` |
| `[선택]` | 도움이 될 때만 사용 |

## ID 접두

| 접두 | 뜻 | 정의되는 곳 |
|---|---|---|
| `OUT-*` | 목표 결과 | intent §목표 결과 |
| `CON-*` | 제약·불변 조건 | intent §제약 |
| `ASM-*` | 가정 | intent §가정 |
| `Q-*` | 열린 질문 | intent §열린 질문 |
| `SCN-*` | 시나리오 | spec §시나리오 |
| `FR-*` | 기능 요구사항 | spec §요구사항 |
| `NFR-*` | 비기능 요구사항 | spec §비기능 요구사항 |
| `AC-*` | 수용 기준 | FR/NFR 밑 체크박스 |
| `EDGE-*` | 오류·경계 조건 | spec §오류와 경계 |
| `SQ-*` · `SD-*` | 열린 질문·명세 결정 | spec §열린 질문과 결정 |
| `TD-*` | 설계 결정 | plan §설계 결정 |
| `WP-*` | 작업 | plan §작업 |
| `RISK-*` | 위험 | plan §위험 |
| `PQ-*` | 열린 질문 | plan §열린 질문 |
| `EV-*` | 관측 | finding §관측 |
| `HYP-*` | 가설 | finding §진단 |
| `FQ-*` | 열린 질문 | finding §열린 질문 |
| `ALT-*` | 대안 | adr §대안 |
| `RV-*` | 재검토 조건 | adr §확인과 재검토 |
| `ASM-*` | 전제 | adr §문맥과 결정 요인 (intent 의 가정과 같은 뜻) |
| `CRIT-*` | 비교 기준 | research §기준 |
| `SRC-*` | 출처 | research §출처 |
| `OPT-*` | 선택지 | research §선택지 |
| `REC-*` | 판단 | research §판단 |
| `RQ-*` | 열린 질문 | research §열린 질문 |

질문 접두는 답할 책임을 나타낸다. `Q`는 제품 책임자, `SQ`는 명세 검토자, `PQ`는 구현
책임자, `FQ`는 서비스 소유자·온콜, `RQ`는 조사 소유자가 닫는다. ID는 삭제돼도 재사용하지 않는다.

## 상태와 승인

```text
draft → in_review → accepted ─────────→ superseded
                  ↘ rejected

plan만: accepted → in_progress → completed
```

finding의 상태는 뜻이 다르다.

| 값 | intent·spec·plan | finding |
|---|---|---|
| `in_review` | 검토 중 | 분류 중 |
| `accepted` | 다음 단계 입력으로 승인 | 경로 확정 (`routed_to` 필수) |
| `rejected` | 진행하지 않기로 함 | 기각 (`routed_to: dismiss:…` 필수) |

- 하위는 상위를 앞서갈 수 없다.
- 막는 질문이 Open이면 `accepted`로 갈 수 없다.
- 의미를 바꾸면 해당 문서와 영향받은 하위를 `in_review`로 되돌린다. 오탈자는 상태를 유지한다.
- `superseded`면 `superseded_by`가 필수다.

하위 문서는 `intent_version`·`spec_version`으로 상위를 고정하며, 값은 `body:<hex>` —
`node <sdlc_runtime>/tools/pin.mjs <파일>`이 상위 문서에서 찍어 주는 값이다. 승인처럼
frontmatter만 바꾸는 편집은 핀을 그대로 두고 본문 편집은 핀을 깨뜨린다. `upstream.lock.json`이
있으면 락의 상류 커밋이 정본이다(`references/multi-repo.md`).

research의 상태는 따로다 — `draft → in_review → reviewed`. `reviewed`는 사람이 읽었다는 뜻이지
무엇이 승인됐다는 뜻이 아니다. 다른 문서는 intent·spec·plan·finding·ADR 본문 어디서나
`RSH-2026-003`이나 `RSH-2026-003/SRC-002`(`/OPT-`·`/REC-`도 같다)로 인용한다. 검사기는 문서와
항목을 둘 다 해석하고, 가리키는 대상이 없으면 오류다. frontmatter 키는 필요 없다.

### 승인은 사람이 한다

- intent·spec·plan이 `accepted` 이상이면 `approved_by`가 필수이고 `generated_by`와 같을 수 없다.
  작성자 자신의 승인은 다이얼로그 전에 가드가 막는다.
- 승인 전이는 **승인 다이얼로그**로 간다 — 에이전트가 승인 편집을 시도하면 가드가 `ask`를 내고
  사람이 그 자리에서 명령을 치지 않고 승인하거나 거절한다. 대화형에서는 권한 모드와 무관하게
  다이얼로그가 뜨고, 비대화형 `-p`에서는 거부된다.
- 자율 경로의 승인자는 `policy:<경로 id>`이고, 위임을 넘는 문서는 `approved_by`를 비운 채
  `in_review`로 남는다. 사람 세션에서는 `policy:`를 쓸 수 없다. 규칙은
  `references/autonomy.md`에 있다.
- finding의 `accepted`는 승인 대신 경로 확정이므로 `approved_by`를 요구하지 않는다.
- research는 결정이 아니라 증거라서 승인하지 않는다. 누가 읽었는지는 `reviewed_by`가 적고,
  승인은 그 조사가 받치는 ADR·intent에서 한다.

## 공통 불변 조건

- 문서 하나에는 변경 의도 하나만 담는다.
- 필수 섹션은 비우지 않는다. 없으면 `해당 없음 — <근거>`라고 쓴다.
- 상위 내용을 복사하지 않고 ID와 상대 링크로 참조한다.
- 확인한 사실·결정·가정을 구분한다.
- 구현 방법은 intent·spec에 넣지 않고, 요구사항 원문은 plan에 복제하지 않는다.
- 코드가 답하는 것은 조사하고, 사람의 판단이 필요한 것만 묻는다.
- 열린 질문은 결정 ID로 닫는다.
- 에이전트가 작성했다면 `generated_by`를 채운다. `generated_from`·`skills_in_force`는 선택이다.

## 경로와 검증

```text
<spec_dir>/
├── findings/FND-YYYY-NNN-<slug>/finding.md
├── research/RSH-YYYY-NNN-<slug>/research.md
└── YYYY-MM-DD-<slug>/
    ├── intent.md              # 상류가 있으면 벤더한 사본
    ├── spec.md                # 상류가 있으면 벤더한 사본
    ├── upstream.lock.json     # 상류가 있을 때만. pull-spec.mjs 가 만든다
    └── plan.md
```

발견과 의도를 잇는 상대 경로는 각각 **자기 문서가 있는 폴더** 기준이고, 검사기는 둘이 같은
파일을 가리키는지까지 본다.

| 키 | 어느 문서에 | 무엇 기준 | 예 |
|---|---|---|---|
| `routed_to` | `finding.md` | 그 발견 폴더 | `intent:../../2026-09-04-search/intent.md` |
| `from_finding` | `intent.md` | 그 의도 폴더 | `../findings/FND-2026-007-ci/finding.md` |

```sh
node <sdlc_runtime>/tools/check-set.mjs <산출물 폴더> [--strict]
```

검사기와 린터를 한 폴더에 함께 돌리고 보고서 하나를 낸다 — 둘이 어긋나면
`check-artifacts.mjs`가 정본이고, 같은 인자로 한쪽만 돌릴 수도 있다. 오류는 고치고 다시
실행하며, 경고는 판단해서 남기는 이유를 보고한다.

## 스킬 공통 절차

`/create-finding` · `/create-research` · `/create-intent` · `/create-spec` · `/create-plan` ·
`/create-light` · `/create-adr`가 이 절차를 따르며, 스킬 본문에는 그 칸에 고유한 것만 적는다.
`/create-research`는 `schema_version`이 언제나 7이고, 6단계의 승인 편집을 건너뛰고 `in_review`로
끝난다 — `reviewed`는 읽은 사람이 바꾼다.

시작:

1. `.claude/spec-profile.yml`을 읽는다. 없으면 `/sdlc-init`을 먼저 돌린다 — 프로필을 지어내지
   않는다. `sdlc_runtime`이 없으면 `references/runtime.md`의 발견 순서를 따른다.
   **산출물 언어는 프로필의 `lang`이고**(없으면 `ko`) 대화 언어가 아니다 — 그 언어의 템플릿을
   쓰고 대화 언어와 다르면 한 줄로 알린다.
2. 이 문서를 읽는다. `references/prose.md`는 보고된 린트 규칙의 해석이 필요하거나 `full` 티어의
   글자 한도를 미리 계산해야 할 때만 읽는다 — 같은 규칙을 `check-set.mjs`가 강제하고 걸린 규칙의
   이름을 말해 준다. 다른 참조는 스킬이 지정할 때만 읽는다. 런타임 도구의 소스는 읽지 않는다 —
   검사기가 하는 말은 실행하면 나온다.
3. `schema_version`은 산출물 세트의 첫 문서(finding·intent)면 프로필의 `sdlc_version`, 하위 문서면
   상위 문서의 값이다. 상위가 프로필과 달라도 산출물 세트의 버전을 유지하고 차이를 보고한다.
4. 템플릿의 주석과 placeholder는 지우고 헤딩 층은 그대로 둔다. `generated_by`를 채운다.

끝:

5. `check-set.mjs`를 직접 한 번 돌리고 결과를 그대로 보고한다. 훅이 조용히 꺼질 수 있으므로
   생략하지 않는다.
6. 통과하면 `status: in_review`로 저장하고 요약(경로 · 티어 · 검사 결과 · 남은 질문)을 보고한 뒤
   **바로 승인 편집을 시도한다** — `status: accepted`와 `approved_by`를 한 편집에 쓴다. 가드가
   그 편집을 승인 다이얼로그로 만들므로 대화로 먼저 «승인할까요»를 묻지 않는다. 거절되면 그대로
   두고 이유를 묻는다. 막는 질문이 열려 있으면 승인 편집을 시도하지 않는다.
   - `approved_by`는 프로필의 `owner`, 없으면 `git config user.name`이다. 사람 이름이어야 하고
     `generated_by`와 달라야 한다. 둘 다 없으면 한 번 묻는다.
   - finding은 승인이 아니라 경로 확정이다 — 승인 편집 대신 `routed_to`와 `status`를 채운다.
   - ADR은 산출물 세트에 속하지 않아 `schema_version`이 언제나 5고 상위 문서가 없다. 나머지는 같다.
7. 승인된 뒤 커밋한다. 도구를 다시 돌리지 않는다 — 승인 편집이 깨뜨릴 수 있는 유일한 규칙은
   가드가 쓰기 전에 막고, CI의 `check-all`이 모든 세트를 다시 읽는다.

자율 경로면(`SDLC_AUTONOMY_ROUTE`가 있으면) `references/autonomy.md`의
「What the writing skills do under a route」를 함께 따른다.
