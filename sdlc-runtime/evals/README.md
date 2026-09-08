# SDLC 평가

문서 회귀 평가, 런타임 평가, 모델 행동 평가를 구분한다. 아래 명령은 이 디렉터리에서 실행한다.

```sh
node run.mjs                         # 문서·런타임 전체
node run.mjs prose-rot               # 문서 케이스 하나
node run.mjs runtime                 # 런타임만
node forward-eval.mjs --list          # 모델 행동 케이스 목록
node forward-eval.mjs <results.json>  # 독립 실행 결과 채점
```

## 문서 회귀 평가

케이스는 해당 작성 스킬의 `evals/cases/`에 둔다. 정상 문서와 결함 문서를 같은 배치에서
검사해 오탐과 누락을 확인한다. 번역체·메타 문장·중복 표를 의도적으로 넣은 결함 문서는 교정하지 않는다.

- `expected.json`에 오류·경고 수와 기대 지적을 기록한다.
- `chain-broken`은 구조 검사만, `prose-rot`·`prose-style`은 문체 검사만 실패해야 한다.
- `@INTENT_SHA@`와 `@SPEC_SHA@`는 러너가 임시 Git 저장소의 실제 커밋으로 치환한다.
- v1·v3 대조군은 호환성을 검사한다. v4 작업 증거는 런타임 평가가 검사한다.

```sh
node ../tools/check-artifacts.mjs --version
node ../tools/check-artifacts.mjs --supports-schema 4
```

## 런타임 평가

`runtime-smoke.mjs`는 임시 저장소에서 다음을 검사한다.

- 작업 커밋의 귀속, 검증 로그와 코드의 일치, 완료 상태.
- 작업 레벨·프롬프트·워크트리·커밋 범위·정리.
- 승인 가드의 반환값, 훅 설치, 정책 위임 경계.
- 전체 검사 실패의 종료 코드, 런타임 드리프트, 스키마 마이그레이션.

가드 반환값 검사는 실제 Claude의 승인 UI 동작을 검증하지 않는다.
자율 디스패처의 회귀 평가는 가짜 CLI와 임시 저장소를 사용한다.

## 모델 행동 평가

요청과 판정 기준은 `forward-cases.json`, 실행 방법은 `FORWARD_EVAL.md`를 따른다.
문서 검사 통과만으로 모델의 판단 품질을 판정하지 않는다. 모델이나 스킬을 크게 바꾸면
독립 실행 결과와 관찰 증거를 남긴다. 외부 push·PR·실서비스 변경은 평가 범위에서 제외한다.
