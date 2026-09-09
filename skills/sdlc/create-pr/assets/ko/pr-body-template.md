<!-- If the repository has .github/pull_request_template.md, follow that instead of this file. -->
<!-- Delete every guide comment — pr-body-lint.sh blocks a body that still carries them. -->

## 🎯 Intent

<!-- What state the system should be in once this lands. One or two sentences. The goal, not the
     method. Where an artifact set exists, take it from intent.md's OUT-* and cite «basis: OUT-00N». -->

### Non-goals

<!-- What this deliberately does not do. If there is none, delete this subheading too. -->

-

## 🔍 Problem

<!-- What is uncomfortable, risky or wrong right now. Write the system's current state, not the
     author's motivation. Two numbers at most, the ones that carry the conclusion. Where an artifact set
     exists, take it from finding.md's EV-* and intent.md's problem section. -->

<!-- Keep this only when the cause is what is in dispute:
> **Root cause:**
>
> **Not the cause:**
-->

<!-- Links: Closes #N (fully closes it) · Refs #N (partial or related) · Depends on #N (merge order) -->

## 🔄 Behavior & Changes

<!-- Only when observable behaviour changes or the change runs in several directions. Otherwise
     delete the section. Cells are words (allowed, rejected, idempotent, -). No ✅/❌ — verification
     results belong under Verification. -->

| Scenario | Before | After |
| --- | --- | --- |
|  |  |  |

### Changes

<!-- 무엇을 그렇게 정했는지가 먼저. 구현 세부는 하위 불릿으로. 파일 나열이 아니다. -->

-

## ⚠️ Risks & Review Points

<!-- 위험·확인 지점이 있을 때만. PII·자격증명·되돌리기 어려운 쓰기·스키마·권한 경계를 건드렸으면
     생략할 수 없다. 🟢 만 남으면 섹션째 지운다. 아래 범례 한 줄은 그대로 둔다. -->

Risk 는 확률이 아니라 **틀렸을 때 치르는 대가** — 🔴 조용히 잘못된 상태로 남음 · 🟡 드러나고 되돌릴 수 있음 · 🟢 영향 범위가 좁음.

| Area | Risk | Review Point |
| --- | --- | --- |
|  |  |  |

> **Reviewer Focus:**

<!-- 저자가 답을 구하는 질문은 콜아웃에 섞지 않는다:
> **Open question:**
-->

## 🧪 Verification

<!-- 검증할 동작·지표가 있을 때만. 측정값은 근거 문단에, 예측은 Expected After 열에. -->

| Metric | Before | Expected After |
| --- | ---: | ---: |
|  |  |  |

-
