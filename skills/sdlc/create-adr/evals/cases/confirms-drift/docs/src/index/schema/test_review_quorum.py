from review_quorum import ReviewedRevision, accept, stale


def test_quorum_rejects_two_approvals():
    rev = ReviewedRevision(revision=7, schema_hash="a1b2", approvals=("a", "b"))
    assert accept(rev) is False


def test_quorum_accepts_three_distinct_reviewers():
    rev = ReviewedRevision(revision=7, schema_hash="a1b2", approvals=("a", "b", "c"))
    assert accept(rev) is True


def test_stale_revision_is_rejected():
    rev = ReviewedRevision(revision=5, schema_hash="a1b2", approvals=("a", "b", "c"))
    assert stale(rev, current_revision=7) is True
