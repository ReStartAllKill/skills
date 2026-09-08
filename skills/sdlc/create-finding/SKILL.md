---
name: create-finding
description: '운영에서 난 신호를 사슬의 입력으로 만든다 — 장애·이상 지표·스캔 결과·인시던트. "장애 정리해줘", "이 알림 어떻게 할지 판단해줘", "포스트모템 써줘" 에 쓴다. Usage: /create-finding <알림 · 지표 · 티켓 · 스레드>'
---

# 발견 기록

운영 신호를 `<spec_dir>/findings/<FND-id>-<slug>/finding.md`에 기록하고 후속 경로를 정한다.
티어는 다른 문서에서 상속하지 않고 관측한 영향을 기준으로 정한다. 기본은 light,
사용자 영향이나 반복 장애는 standard, 보안 경계·광범위 장애·복구 불가능한 데이터 영향은 full이다.

## 절차

시작과 검사는 `<sdlc_runtime>/conventions.md`의 「스킬 공통 절차」를 따른다.
finding의 `accepted`는 사람의 승인이 아니라 경로 확정을 뜻한다.

1. 신호 출처와 `trigger`, 허용 범위를 확인한다. `band_breach`면 `references/bands.md`와
   프로필의 밴드 등록부를 읽는다. 기준값이나 권한을 추정해서 채우지 않는다.
2. `assets/finding-template.md`로 작성한다.
   - `EV-*`: 측정값·기준·시각·재현 명령.
   - `HYP-*`: EV를 가리키는 `근거:`와 반증 방법.
   - 조치: 실제 수행한 일, 결과, 허용 근거. 조사하지 못한 범위와 수행하지 않은 조치도 적는다.
3. 아래 기준으로 경로를 정한다. 재발 방지 항목은 모든 경로에 작성한다.
4. 검사기와 린터를 실행하고 결과를 보고한다. 밴드 조정 기록은 `references/bands.md`를 따른다.

## 경로

| 경로 | 기준 | 상태와 후속 처리 |
|---|---|---|
| patch | 한 PR로 해결할 수 있다 | `accepted`, `routed_to: patch:<PR 링크>` |
| intent | 구조적 문제·여러 서비스의 공통 문제·제품 판단이 필요하다 | 대상 intent가 없으면 `in_review`, `routed_to: null` |
| dismiss | 오탐이거나 검토 결과 조치하지 않는다 | `rejected`, `routed_to: dismiss:<사유>` |

경계를 판단하기 어려우면 intent로 보낸다. intent 경로는 `/create-intent <finding 경로>`를 안내한다.
intent가 생기면 양쪽 상대 경로를 연결하고 finding을 `accepted`로 바꾼 뒤 다시 검사한다.
PR 링크가 아직 없는 patch도 경로 확정 전 상태로 남긴다. 이 스킬이 PR 생성 권한을 부여하지는 않는다.

## 보고

문서 경로, 티어, 상태, 후속 경로, 검사기·린터의 오류와 경고 수, 남은 질문을 보고한다.
