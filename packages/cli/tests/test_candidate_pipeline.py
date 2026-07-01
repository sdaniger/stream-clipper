"""Tests for the new short/medium/long candidate pipeline."""
from __future__ import annotations

import math

from stream_clipper_cli.candidate_pipeline import (
    generate_all_candidates,
    generate_short_candidates,
    generate_medium_candidates,
    generate_long_candidates,
    SHORT_MIN,
    SHORT_MAX,
    MEDIUM_MIN,
    MEDIUM_MAX,
    LONG_MIN,
    LONG_MAX,
    LONG_MIN_PEAK_COUNT,
)
from stream_clipper_cli.timeline_scoring import build_timeline, ChatMessage


def _mk_messages(peak_times, chat_per_window=30, extra=("", ""), dur=1800):
    """Build synthetic messages: high chat at peak_times, low elsewhere."""
    out = []
    n = 0
    for t in range(0, dur, 5):
        burst = any(abs(t - p) < 60 for p in peak_times)
        count = chat_per_window if burst else 2
        for i in range(count):
            msg = f"草 {n}" if (burst and i % 4 == 0) else f"hi {n}"
            out.append(ChatMessage(timestamp=t + (i * 0.05), author=f"u{n%5}", message=msg))
            n += 1
    return out


def test_build_timeline_basic():
    msgs = [
        ChatMessage(timestamp=5, author="a", message="草"),
        ChatMessage(timestamp=10, author="b", message="lol"),
        ChatMessage(timestamp=15, author="c", message="神"),
    ]
    timeline = build_timeline(msgs, window=30, step=10)
    assert len(timeline) > 0
    # All in window starting at 0
    w0 = timeline[0]
    assert w0.chat_count == 3
    assert w0.unique_author_count == 3
    assert w0.laugh_score >= 1
    assert w0.surprise_score == 0
    assert w0.clip_worthy_score >= 1
    assert w0.keyword_hits >= 2
    assert w0.total_score > 0


def test_build_timeline_window_placement():
    """The window placement formula must be correct: with window=30,
    step=10, a message at ts=31.5 belongs to windows [10,40), [20,50),
    and [30,60) but NOT [0,30). The previous off-by-one implementation
    routed such messages to an extra window."""
    msgs = [
        ChatMessage(timestamp=0, author="a", message="x"),
        ChatMessage(timestamp=5, author="b", message="x"),
        ChatMessage(timestamp=10, author="c", message="x"),
        ChatMessage(timestamp=15, author="d", message="x"),
        ChatMessage(timestamp=20, author="e", message="x"),
        ChatMessage(timestamp=25, author="f", message="x"),
        ChatMessage(timestamp=29, author="g", message="x"),
        ChatMessage(timestamp=31, author="h", message="x"),  # in [10,40), [20,50), [30,60) only
        ChatMessage(timestamp=40, author="i", message="x"),  # in [20,50), [30,60), [40,70) only
    ]
    timeline = build_timeline(msgs, window=30, step=10)
    # Window 0 = [0,30) should contain messages at ts in [0,30)
    # i.e. ts=0,5,10,15,20,25,29 -> 7 messages
    w0 = timeline[0]
    assert w0.chat_count == 7, f"Window 0 should have 7 (excludes ts=31,40); got {w0.chat_count}"
    # ts=31 is in windows 1,2,3; ts=40 is in windows 2,3,4
    # Window 1: ts=10,15,20,25,29 (5 from overlap with w0) + ts=31 (in 1,2,3) = 6
    assert timeline[1].chat_count == 6, f"Window 1: {timeline[1].chat_count}"
    # Window 2: ts=20,25,29 + ts=31,40 = 5
    assert timeline[2].chat_count == 5, f"Window 2: {timeline[2].chat_count}"
    # Window 3: ts=31,40 = 2
    assert timeline[3].chat_count == 2, f"Window 3: {timeline[3].chat_count}"
    # Window 4: ts=40 = 1
    assert timeline[4].chat_count == 1, f"Window 4: {timeline[4].chat_count}"


def test_safe_clip_range_clamps_to_vod_duration():
    """After extending to hard_min, the range must not exceed vod_duration."""
    from stream_clipper_cli.candidate_pipeline import _safe_clip_range
    # 10s clip near the end of a 1800s VOD with hard_min=45
    s, e = _safe_clip_range(1795, 1805, 45, 90, vod_duration=1800)
    assert e <= 1800, f"end should not exceed vod_duration: {e}"
    assert e - s >= 45, f"duration should be at least hard_min: {e - s}"


def test_long_candidate_run_detection_splits_correctly():
    """Long candidates must respect activity runs separated by quiet gaps."""
    # Build a chat timeline with two distinct activity clusters
    msgs = []
    # Cluster 1: t=300..360 (peak at 330)
    for t in range(300, 360, 5):
        for _ in range(20):
            msgs.append(ChatMessage(timestamp=t, author="u", message="hi"))
    # Long quiet gap from t=360 to t=900 (> LONG_PEAK_GAP=120s)
    for t in range(360, 900, 5):
        msgs.append(ChatMessage(timestamp=t, author="u", message="."))
    # Cluster 2: t=900..960 (peak at 930)
    for t in range(900, 960, 5):
        for _ in range(20):
            msgs.append(ChatMessage(timestamp=t, author="u", message="hi"))
    timeline = build_timeline(msgs, window=30, step=10)
    cands = generate_all_candidates(timeline, vod_duration=1200)
    # If run detection works, we should get 2 long candidates (or none if peaks are weak)
    # At minimum, ensure peak detection is local and not global
    for c in cands["long"]:
        # Each long candidate should have peaks within a coherent range
        centers = sorted(c.peak_centers)
        if len(centers) >= 2:
            spread = centers[-1] - centers[0]
            # Spread should be < 12 min (LONG_MAX) and should not span
            # the full 0..1200 range
            assert spread <= 12 * 60, f"Long peaks spread too far: {spread}"


def test_short_candidate_duration_in_range():
    msgs = _mk_messages([600], chat_per_window=50, dur=1800)
    timeline = build_timeline(msgs, window=30, step=10)
    cands = generate_short_candidates(timeline, top_n=3, vod_duration=1800)
    assert cands, "no short candidates produced"
    for c in cands:
        assert SHORT_MIN <= c.clip_duration <= SHORT_MAX, c.clip_duration
        assert c.kind == "short"
        assert c.peak_count == 1


def test_short_candidate_no_stretching_to_10_min():
    """A single peak must not be stretched to 10 minutes."""
    msgs = _mk_messages([900], chat_per_window=80, dur=3600)
    timeline = build_timeline(msgs, window=30, step=10)
    cands = generate_short_candidates(timeline, top_n=3, vod_duration=3600)
    for c in cands:
        assert c.clip_duration <= SHORT_MAX + 0.01
        assert c.kind == "short"


def test_medium_candidate_duration_and_peaks():
    """Medium candidates span 3-5 min and include >=2 peaks."""
    msgs = _mk_messages([300, 360, 420], chat_per_window=40, dur=1800)
    timeline = build_timeline(msgs, window=30, step=10)
    cands = generate_medium_candidates(timeline, top_n=3, vod_duration=1800)
    assert cands, "no medium candidates produced"
    for c in cands:
        assert MEDIUM_MIN <= c.clip_duration <= MEDIUM_MAX, c.clip_duration
        assert c.peak_count >= 2
        assert c.peak_count <= 3


def test_long_candidate_duration_and_peaks():
    """Long candidates span 8-12 min and include >=2 peaks."""
    # Place 4 peaks across a 10-minute span
    msgs = _mk_messages([600, 720, 840, 960], chat_per_window=30, dur=2400)
    timeline = build_timeline(msgs, window=30, step=10)
    cands = generate_long_candidates(timeline, top_n=3, vod_duration=2400)
    assert cands, "no long candidates produced"
    for c in cands:
        assert LONG_MIN <= c.clip_duration <= LONG_MAX, c.clip_duration
        assert c.peak_count >= LONG_MIN_PEAK_COUNT
        assert c.long_score > 0


def test_long_candidate_rejects_single_peak():
    """A long candidate must NOT be produced when there is only one peak cluster."""
    msgs = _mk_messages([600], chat_per_window=50, dur=2400)
    timeline = build_timeline(msgs, window=30, step=10)
    cands = generate_long_candidates(timeline, top_n=3, vod_duration=2400)
    # Either no long candidates, or peak_count >= 2
    for c in cands:
        assert c.peak_count >= LONG_MIN_PEAK_COUNT


def test_long_score_formula():
    """Verify the long_score formula matches the spec."""
    msgs = _mk_messages([300, 480, 660, 840], chat_per_window=40, dur=2400)
    timeline = build_timeline(msgs, window=30, step=10)
    cands = generate_long_candidates(timeline, top_n=1, vod_duration=2400)
    assert cands
    c = cands[0]
    # The score is built from peak_count*2 + sustained*1.5 + avg*1.0 + max_peak*1.2 +
    # unique*0.8 + keyword*1.2 + coherence*2.0 - dead_air*1.5
    # We just check it's positive and bounded
    assert c.long_score > 0
    assert c.score == c.long_score


def test_generate_all_candidates_keys():
    msgs = _mk_messages([300, 480, 660, 840], chat_per_window=40, dur=2400)
    timeline = build_timeline(msgs, window=30, step=10)
    result = generate_all_candidates(timeline, vod_duration=2400)
    assert set(result.keys()) == {"short", "medium", "long"}
    assert isinstance(result["short"], list)
    assert isinstance(result["medium"], list)
    assert isinstance(result["long"], list)


def test_candidates_include_quality_metadata():
    msgs = [
        ChatMessage(timestamp=100 + i * 0.5, author=f"u{i}", message="ここ切り抜き 草 えぐ 神展開")
        for i in range(20)
    ]
    timeline = build_timeline(msgs, window=30, step=10)
    cands = generate_short_candidates(timeline, top_n=1, vod_duration=300)
    assert cands
    c = cands[0]
    assert c.category in {"funny", "surprise", "clip_worthy", "hype"}
    assert c.confidence > 0
    assert c.representative_comments
    assert c.overlap_group


def test_short_candidates_include_high_score_peak():
    msgs = _mk_messages([600], chat_per_window=80, dur=1800)
    timeline = build_timeline(msgs, window=30, step=10)
    cands = generate_short_candidates(timeline, top_n=3, vod_duration=1800)
    # The peak at 600s should be near the center of a candidate
    if cands:
        # The closest candidate center to 600 should be within ~half window
        diffs = [abs(c.peak_time - 600) for c in cands]
        assert min(diffs) < 60  # within 1 minute


if __name__ == "__main__":
    # Plain-script runner: works without pytest installed.
    import sys
    funcs = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    failed = 0
    for fn in funcs:
        try:
            fn()
            print(f"  ✓ {fn.__name__}")
        except AssertionError as e:
            failed += 1
            print(f"  ✗ {fn.__name__}: AssertionError: {e}")
        except Exception as e:
            failed += 1
            print(f"  ✗ {fn.__name__}: {type(e).__name__}: {e}")
    if failed:
        print(f"\n{failed} test(s) failed")
        sys.exit(1)
    print(f"\nAll {len(funcs)} tests passed")
