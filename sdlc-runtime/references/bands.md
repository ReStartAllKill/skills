# 탐지 밴드

`finding.md`가 `band_breach`에서 시작한다면 정상 기준은 모델이 아니라 등록부가 정해야 한다.
정본은 profile의 `bands` 경로이며 기본값은 `.claude/bands.yml`이다.

## 형식

```yaml
version: 1
bands:
  ci_test_failure_rate:
    metric: "CI 테스트 실패율"
    source: "gh run list --limit 200 --json conclusion"
    window: "rolling_30d"
    rule: "western_electric 3σ"
    autonomy_tier: diagnose
    owner: "플랫폼팀"
    revised:
      - "2026-09-04 FND-2026-001 — 3σ → 4σ · 배포 창 중 정상 변동"
```

밴드마다 `metric`·`source`·`window`·`rule`·`autonomy_tier`·`owner`가 필수다. `source`는
문장이 아니라 재현 명령이다.

## finding 연결

- `trigger: band_breach`면 `band`가 필수이고 등록부에 존재해야 한다.
- finding의 `autonomy_tier`는 등록부 값과 같아야 한다.
- 밴드를 조정했으면 `revised:`에 날짜·finding ID·변경 이유를 남긴다.
- 조정하지 않으면 finding §경로 판정에 `밴드 조정: 조정 없음 — <근거>`를 적는다.

```sh
node <sdlc_runtime>/tools/bands.mjs <repo-root>
```
