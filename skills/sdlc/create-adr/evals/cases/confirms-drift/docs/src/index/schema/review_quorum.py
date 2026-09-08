"""색인 스키마 개정 승인. 정족수를 채운 개정본만 배포 파이프라인에 들어간다."""
from dataclasses import dataclass

QUORUM = 3
REVIEWERS = 5


@dataclass(frozen=True)
class ReviewedRevision:
    revision: int
    schema_hash: str
    approvals: tuple[str, ...]


def accept(rev: ReviewedRevision) -> bool:
    return len(set(rev.approvals)) >= QUORUM


def stale(rev: ReviewedRevision, current_revision: int) -> bool:
    return current_revision - rev.revision > 1
