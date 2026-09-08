# SDLC 평가

문서 회귀 평가, 런타임 평가, 모델 행동 평가를 구분한다. 아래 명령은 이 디렉터리에서 실행한다.

```sh
node run.mjs                         # 문서·런타임 전체
node run.mjs prose-rot               # 문서 케이스 하나
node run.mjs runtime                 # 런타임만
node --test runner.test.mjs           # 평가 러너 자체의 회귀 테스트
python3 -m unittest discover -s ../../skills/eval/agent-eval/scripts -p 'test_*.py'  # 채점·리포트
node forward-eval.mjs --list          # 모델 행동 케이스 목록
node forward-eval.mjs <results.json>  # 독립 실행 결과 채점
```

## 문서 회귀 평가

케이스는 해당 작성 스킬의 `evals/cases/`에 둔다. 정상 문서와 결함 문서를 같은 배치에서
검사해 오탐과 누락을 확인한다. 번역체·메타 문장·중복 표를 의도적으로 넣은 결함 문서는 교정하지 않는다.

- `expected.json`에 오류·경고 수와 기대 지적을 기록한다.
- 종료 코드도 대조한다. 기대 오류가 있으면 1, 오류가 없으면 0이어야 한다. 경고만 있으면 0이다.
  실행 예외나 시그널 종료는 통과로 처리하지 않는다.
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

## 평가 도구의 회귀 테스트와 CI

`runner.test.mjs`는 임시 저장소와 가짜 검사기로 런타임 단독 실행, 알 수 없는 케이스,
검사기 예외·시그널 종료·잘못된 종료 코드를 검사한다.
`test_scorecard.py`는 미채점 결과와 하네스 실행 오류의 집계 거부, 정상적인 미검출과 대조군,
점수·리포트 CLI의 실패 처리를 검사한다.

저장소의 `.github/workflows/ci.yml`은 push와 pull request에서 Linux·macOS의 Node.js 24와
Python 3.12로 스킬 등록, 평가 러너, 채점·리포트, 문서·런타임 회귀 테스트를 실행한다.
외부 패키지 설치나 모델 API 호출 없이 실행하며, 실제 모델 행동과 승인 UI 검증은 별도로 수행한다.
