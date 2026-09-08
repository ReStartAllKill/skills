#!/usr/bin/env python3
"""워크트리의 워크스페이스 패키지가 **선언했는데 링크되지 않은** 의존성을 이어준다.

왜 필요한가: 평가 케이스의 스캐폴드가 `package.json` 에 의존성을 새로 추가하면(작성 역할
케이스에서 흔하다), 원본 레포의 `node_modules` 에는 그 링크가 없다. 러너는 `pnpm install` 을
돌리지 않으므로(루트 `node_modules` 가 원본 레포로 향하는 심볼릭 링크라 install 하면 사용자
레포를 건드린다) 그대로 두면 평가 대상이 "Cannot find module" 에 막혀 게이트를 통과할 수
없다 — 정답지의 `gate_actual: PASS` 가 도달 불가능한 값이 된다.

  - 워크스페이스 의존성(`@rwa/*` 등)은 **워크트리 자신의** 패키지로 상대 링크한다.
  - 외부 의존성은 원본 레포의 다른 패키지에 이미 링크된 실체를 찾아 절대경로로 건다(읽기 전용).

원본 레포는 절대 수정하지 않는다. 멱등하다 — 이미 있는 링크는 건드리지 않는다.

    resolve-workspace-deps.py <worktree> <repo>
"""
import json
import os
import sys
from pathlib import Path


def workspace_dirs(root: Path):
    for parent in ("apps", "packages"):
        base = root / parent
        if base.is_dir():
            for d in sorted(base.iterdir()):
                if (d / "package.json").is_file():
                    yield d


def pkg_name(d: Path):
    try:
        return json.load(open(d / "package.json")).get("name")
    except ValueError:
        return None


def declared_deps(d: Path):
    try:
        pj = json.load(open(d / "package.json"))
    except ValueError:
        return []
    out = []
    for field in ("dependencies", "devDependencies"):
        out.extend((pj.get(field) or {}).keys())
    return out


def find_in_repo(repo: Path, dep: str):
    """원본 레포에서 이 의존성이 이미 링크된 자리를 찾아 실체 경로를 돌려준다."""
    candidates = [repo / "node_modules" / dep]
    for d in workspace_dirs(repo):
        candidates.append(d / "node_modules" / dep)
    for c in candidates:
        if c.is_symlink() or c.exists():
            try:
                return c.resolve(strict=True)
            except OSError:
                continue
    return None


def main() -> int:
    tree, repo = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()
    names = {}
    for d in workspace_dirs(tree):
        n = pkg_name(d)
        if n:
            names[n] = d

    made, missing = [], []
    for d in workspace_dirs(tree):
        nm = d / "node_modules"
        for dep in declared_deps(d):
            target = nm / dep
            if target.is_symlink() or target.exists():
                continue
            target.parent.mkdir(parents=True, exist_ok=True)   # @scope/ 디렉터리
            if dep in names:
                # 워크트리 안쪽으로 상대 링크 — 원본 레포로 새지 않게 한다
                rel = os.path.relpath(names[dep], target.parent)
                target.symlink_to(rel)
                made.append(f"{d.name}: {dep} -> {rel}")
            else:
                real = find_in_repo(repo, dep)
                if real is None:
                    missing.append(f"{d.name}: {dep}")
                    continue
                target.symlink_to(real)   # 외부 의존성은 원본 store 를 절대경로로 참조(읽기 전용)
                made.append(f"{d.name}: {dep} -> {real}")

    for m in made:
        print(f"  + {m}")
    if missing:
        print("  ※ 원본 레포에서 못 찾은 의존성 (게이트가 깨질 수 있다):", file=sys.stderr)
        for m in missing:
            print(f"    - {m}", file=sys.stderr)
    if not made and not missing:
        print("  (추가로 이을 의존성 없음)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
