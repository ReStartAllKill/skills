# 자율 실행

사람이 미리 승인하고 커밋한 정책으로 문서 작성 범위를 위임한다. 문서별 승인자는
`policy:<경로 id>`이며, 정책의 `owner`가 위임 책임자다.

## 정책 형식

프로필의 `autonomy` 경로를 사용하며 기본값은 `.claude/autonomy.yml`이다.

```yaml
version: 1
owner: "플랫폼팀 책임자"
routes:
  ci-failure-triage:
    trigger: band_breach
    bands: [ci_test_failure_rate]
    max_tier: light
    advance_to: intent
    tools: "Read,Grep,Glob,Edit,Write"
    expires: 2026-12-31
    max_turns: 80
```

각 경로에 `trigger`, `max_tier`, `advance_to`, `tools`, `expires`를 채운다.
`max_tier`는 light 또는 standard다. full은 자율 승인하지 않는다.
`advance_to`는 finding·intent·spec·plan 중 선택한다. 호환 값 implement는 `target_branch`가
필요하지만 현재 디스패처는 plan까지만 작성하고 구현은 실행하지 않는다.

## 실행

```sh
node <sdlc_runtime>/tools/dispatch-auto.mjs <repo> \
  --route ci-failure-triage --signal "CI 실패율 12.4%" [--dry-run]
```

1. 프로필·정책·만료·가드 등록을 확인한다. 실제 실행은 변경이 없는 Git 작업 트리에서 시작한다.
2. `spec_dir`는 `.claude/` 밖에 둔다. 경로 제한의 이유와 기본값은 `references/profile.md`를 따른다.
3. 정책의 도구에 `Skill`, Git 조회 세 가지, 검사기·린터·밴드 검사 명령을 추가해 실행한다.
   기본 턴 상한은 80이다. 도구 허용 목록은 파일 경로 전체를 제한하는 샌드박스를 대신하지 않는다.
4. 에이전트 종료 후 전체 산출물 세트를 필수 모드로 검사한다. 에이전트 성공, 검사 성공, 산출물 변경,
   빈 인덱스를 확인한 뒤 산출물만 커밋한다. 커밋 실패도 실행 실패로 보고한다.
5. 허용 범위·실제 도구 사용·거부 수·비용·검사·커밋 결과를 `.claude/autonomy-runs.jsonl`에 남긴다.
   시작 전 작업 트리 검사에서는 이 로그 한 파일만 제외한다. 다른 수정·미추적 파일은 계속 차단한다.

`--dry-run`은 실행 명령만 보여주며 에이전트를 호출하거나 커밋하지 않는다.

## 승인 경계

가드는 해당 실행의 `SDLC_AUTONOMY_ROUTE`와 같은 정책 승인만 허용한다.
검사기는 정책 존재·만료·최대 티어·최종 단계를 대조한다. 사람 세션에서는 `policy:` 승인을 쓰지 않는다.

위임을 넘거나 판단할 정보가 부족하면 `approved_by`를 비우고 `in_review`로 남긴다.
열린 질문과 수행하지 않은 조치를 기록한다. `/implement-spec`은 사람이 실행 시점을 정한다.

```sh
node <sdlc_runtime>/tools/autonomy.mjs <repo> --strict
```
