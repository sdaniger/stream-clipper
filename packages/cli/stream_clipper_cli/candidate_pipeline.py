"""
Candidate generators for short, medium, and long highlight clips.

These are the three pipelines that consume a TimelineWindow list and emit
candidates with a clip range, sub-scores, and metadata. They are kept
deliberately separate:

  - short candidate:  a single high-score peak, 45-90s
  - medium candidate: 2-3 nearby peaks merged, 3-5 min
  - long candidate:   multi-peak cluster, 8-12 min

A single peak is never stretched to 10 minutes. Long candidates come from
multiple peaks. Long score is computed via the formula specified in the
project spec.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field, asdict
from typing import Dict, List, Optional, Sequence, Set, Tuple

from stream_clipper_cli.timeline_scoring import TimelineWindow


# ─── Specs ───────────────────────────────────────────────────────────────────

SHORT_MIN = 45.0
SHORT_MAX = 90.0
SHORT_PEAK_HALF_WINDOW = 20.0  # +/- 20s around the peak as the default

MEDIUM_MIN = 180.0   # 3 min
MEDIUM_MAX = 300.0   # 5 min
MEDIUM_TARGET_PEAK_GAP = 60.0   # seconds between peaks to consider them part of the same cluster
MEDIUM_MAX_PEAKS = 3

LONG_MIN = 480.0   # 8 min
LONG_MAX = 720.0   # 12 min
LONG_PEAK_GAP = 120.0  # seconds; windows closer than this can belong to the same long clip
LONG_MIN_PEAK_COUNT = 2


# ─── Data classes ────────────────────────────────────────────────────────────

@dataclass
class Candidate:
    """A single highlight candidate (any length)."""
    candidate_id: str
    kind: str  # "short" | "medium" | "long"
    rank: int
    start: float          # window.start
    end: float            # window.end
    peak_time: float
    peak_window_index: int
    clip_start: float
    clip_end: float
    clip_duration: float
    score: float          # ranking score used for sorting
    chat_count: int
    unique_author_count: int
    keyword_hits: int
    laugh_score: float
    surprise_score: float
    clip_worthy_score: float
    reaction_score: float
    burst_score: float
    total_score: float
    peak_count: int = 1
    peak_centers: List[float] = field(default_factory=list)
    matched_keywords: List[str] = field(default_factory=list)
    reasons: List[str] = field(default_factory=list)
    topic_coherence_score: float = 0.0
    sustained_chat_score: float = 0.0
    dead_air_penalty: float = 0.0
    long_score: float = 0.0
    category: str = "general"
    confidence: float = 0.0
    representative_comments: List[dict] = field(default_factory=list)
    overlap_group: Optional[str] = None

    def to_dict(self) -> dict:
        return asdict(self)


# ─── Helpers ────────────────────────────────────────────────────────────────

def _safe_clip_range(
    requested_start: float,
    requested_end: float,
    hard_min: float,
    hard_max: float,
    vod_duration: Optional[float] = None,
) -> Tuple[float, float]:
    """
    Clamp a requested clip range so it sits in [hard_min, hard_max] and
    inside [0, vod_duration]. After extension, the range is re-clamped
    against vod_duration to avoid running off the end of the VOD.
    """
    start = max(0.0, requested_start)
    end = max(start, requested_end)
    if vod_duration is not None and vod_duration > 0:
        end = min(end, vod_duration)
        start = min(start, max(0.0, vod_duration - 1.0))
    dur = end - start
    if dur < hard_min:
        # extend end to hit hard_min, then re-clamp against vod_duration
        end = start + hard_min
        if vod_duration is not None and vod_duration > 0:
            end = min(end, vod_duration)
            # If we cannot extend the end further, push start back so the
            # clip still meets hard_min.
            if end - start < hard_min:
                start = max(0.0, end - hard_min)
    if end - start > hard_max:
        end = start + hard_max
    return start, end


def _aggregate_windows(
    windows: Sequence[TimelineWindow],
    indices: Sequence[int],
) -> Dict[str, float]:
    chat = 0
    keyword_hits = 0
    laugh = 0.0; surprise = 0.0; clip_worthy = 0.0; reaction = 0.0
    burst = 0.0; total = 0.0
    matched: List[str] = []
    for i in indices:
        w = windows[i]
        chat += w.chat_count
        keyword_hits += w.keyword_hits
        laugh += w.laugh_score
        surprise += w.surprise_score
        clip_worthy += w.clip_worthy_score
        reaction += w.reaction_score
        burst += w.burst_score
        total += w.total_score
        matched.extend(w.matched_reactions)
        matched.extend(w.matched_laughs)
        matched.extend(w.matched_surprises)
        matched.extend(w.matched_clip_worthy)
    return {
        "chat_count": chat,
        "unique_author_count_sum": float(sum(windows[i].unique_author_count for i in indices)),
        "unique_author_count_max": float(max((windows[i].unique_author_count for i in indices), default=0)),
        "keyword_hits": keyword_hits,
        "laugh_score": laugh,
        "surprise_score": surprise,
        "clip_worthy_score": clip_worthy,
        "reaction_score": reaction,
        "burst_score": burst,
        "total_score": total,
        "matched_keywords": list(set(matched)),
        "representative_comments": _merge_representative_comments(windows, indices),
    }


def _merge_representative_comments(windows: Sequence[TimelineWindow], indices: Sequence[int], limit: int = 5) -> List[dict]:
    out: List[dict] = []
    seen: Set[str] = set()
    for i in sorted(indices, key=lambda k: windows[k].total_score, reverse=True):
        for c in getattr(windows[i], "representative_comments", []) or []:
            msg = str(c.get("message", "")).strip()
            key = msg.lower()
            if not msg or key in seen:
                continue
            seen.add(key)
            out.append(c)
            if len(out) >= limit:
                return out
    return out


def _candidate_category(laugh: float, surprise: float, clip_worthy: float, burst: float, matched: Sequence[str]) -> str:
    joined = " ".join(matched).lower()
    if any(k in joined for k in ("事故", "放送事故", "bug", "バグ", "落ちた")):
        return "accident"
    if any(k in joined for k in ("かわいい", "可愛い", "尊い", "助かる")):
        return "cute"
    scores = {
        "funny": laugh,
        "surprise": surprise,
        "clip_worthy": clip_worthy,
        "hype": clip_worthy + burst * 0.4,
    }
    return max(scores, key=scores.get) if any(v > 0 for v in scores.values()) else "chat_spike"


def _confidence(score: float, max_score: float, unique_authors: int, reaction_hits: int, peak_count: int = 1) -> float:
    ratio = score / max(1.0, max_score)
    value = 45.0 + ratio * 35.0 + min(15.0, unique_authors * 1.2) + min(10.0, reaction_hits * 0.4) + min(8.0, (peak_count - 1) * 3.0)
    return round(max(0.0, min(99.0, value)), 1)


def _adjust_short_range(windows: Sequence[TimelineWindow], peak_index: int, start: float, end: float, vod_duration: Optional[float]) -> Tuple[float, float]:
    peak = windows[peak_index]
    threshold = max(1.0, peak.total_score * 0.35)
    left = peak_index
    while left > 0 and peak.center - windows[left - 1].center <= 45 and windows[left - 1].total_score >= threshold:
        left -= 1
    right = peak_index
    while right + 1 < len(windows) and windows[right + 1].center - peak.center <= 60 and windows[right + 1].total_score >= threshold:
        right += 1
    req_start = min(start, max(0.0, windows[left].start - 8.0))
    req_end = max(end, windows[right].end + 12.0)
    return _safe_clip_range(req_start, req_end, SHORT_MIN, SHORT_MAX, vod_duration)


def _assign_overlap_groups(candidates: List[Candidate]) -> None:
    groups: List[Tuple[str, float, float]] = []
    for c in sorted(candidates, key=lambda item: item.clip_start):
        assigned = None
        for group_id, start, end in groups:
            overlap = max(0.0, min(c.clip_end, end) - max(c.clip_start, start))
            denom = max(1.0, min(c.clip_duration, end - start))
            if overlap / denom >= 0.5:
                assigned = group_id
                break
        if assigned is None:
            assigned = f"scene_{len(groups) + 1:03d}"
            groups.append((assigned, c.clip_start, c.clip_end))
        c.overlap_group = assigned


def _topic_coherence(
    windows: Sequence[TimelineWindow],
    indices: Sequence[int],
) -> float:
    """
    Coarse topic coherence: keyword overlap between consecutive windows.
    Higher = same theme continues; lower = topic jumps.
    """
    if len(indices) < 2:
        return 0.0
    overlaps = []
    for a, b in zip(indices, indices[1:]):
        ka = set(windows[a].matched_reactions + windows[a].matched_laughs + windows[a].matched_surprises + windows[a].matched_clip_worthy)
        kb = set(windows[b].matched_reactions + windows[b].matched_laughs + windows[b].matched_surprises + windows[b].matched_clip_worthy)
        if not ka or not kb:
            overlaps.append(0.0)
            continue
        inter = len(ka & kb)
        union = len(ka | kb)
        overlaps.append(inter / union if union else 0.0)
    return sum(overlaps) / len(overlaps) if overlaps else 0.0


def _dead_air_penalty(
    windows: Sequence[TimelineWindow],
    clip_start: float,
    clip_end: float,
) -> float:
    """
    Penalty for low-activity windows inside the clip range. 0 = no penalty.
    """
    if clip_end <= clip_start:
        return 0.0
    # Identify window indices whose [start, end) overlaps [clip_start, clip_end)
    inside_indices: List[int] = []
    for i, w in enumerate(windows):
        if w.end <= clip_start:
            continue
        if w.start >= clip_end:
            break
        if w.chat_count > 0 or w.total_score > 0:
            inside_indices.append(i)
    if not inside_indices:
        return 0.0
    chat = sum(windows[i].chat_count for i in inside_indices)
    duration = clip_end - clip_start
    rate = chat / max(1.0, duration)
    if rate >= 1.0:
        return 0.0
    return max(0.0, 1.0 - rate)


def _sustained_chat_score(
    windows: Sequence[TimelineWindow],
    indices: Sequence[int],
) -> float:
    """
    Aggregate chat density across the candidate's windows. Higher = sustained.
    """
    if not indices:
        return 0.0
    total_chat = sum(windows[i].chat_count for i in indices)
    span = max(1.0, windows[indices[-1]].end - windows[indices[0]].start)
    return total_chat / span


# ─── Short candidates ────────────────────────────────────────────────────────

def generate_short_candidates(
    windows: Sequence[TimelineWindow],
    top_n: int = 5,
    vod_duration: Optional[float] = None,
    min_gap: float = 90.0,
    min_score: float = 0.0,
) -> List[Candidate]:
    """
    Short = a single high-score peak window surrounded by context.

    Rules:
      - Pick windows with total_score > 0 (or above `min_score`)
      - Sort by total_score desc
      - For each candidate, clip range = peak.center +/- SHORT_PEAK_HALF_WINDOW,
        clamped to [SHORT_MIN, SHORT_MAX]
      - Enforce min_gap between candidate centers
    """
    candidates: List[Candidate] = []
    max_score = max((w.total_score for w in windows), default=0.0)
    ranked = sorted(
        [i for i, w in enumerate(windows) if w.total_score > min_score],
        key=lambda i: windows[i].total_score,
        reverse=True,
    )

    selected_indices: List[int] = []
    for i in ranked:
        w = windows[i]
        if any(abs(w.center - windows[j].center) < min_gap for j in selected_indices):
            continue
        selected_indices.append(i)
        if len(selected_indices) >= top_n:
            break

    for rank, i in enumerate(selected_indices, 1):
        w = windows[i]
        # initial symmetric range
        req_start = w.center - SHORT_PEAK_HALF_WINDOW
        req_end = w.center + SHORT_PEAK_HALF_WINDOW
        clip_start, clip_end = _safe_clip_range(
            req_start, req_end, SHORT_MIN, SHORT_MAX, vod_duration
        )
        clip_start, clip_end = _adjust_short_range(windows, i, clip_start, clip_end, vod_duration)

        agg = _aggregate_windows(windows, [i])
        reasons = _build_short_reasons(w, agg)

        candidates.append(Candidate(
            candidate_id=f"short_{rank:03d}",
            kind="short",
            rank=rank,
            start=w.start,
            end=w.end,
            peak_time=w.center,
            peak_window_index=i,
            clip_start=clip_start,
            clip_end=clip_end,
            clip_duration=round(clip_end - clip_start, 3),
            score=round(w.total_score, 3),
            chat_count=agg["chat_count"],
            unique_author_count=int(agg["unique_author_count_max"]),
            keyword_hits=agg["keyword_hits"],
            laugh_score=round(agg["laugh_score"], 3),
            surprise_score=round(agg["surprise_score"], 3),
            clip_worthy_score=round(agg["clip_worthy_score"], 3),
            reaction_score=round(agg["reaction_score"], 3),
            burst_score=round(agg["burst_score"], 3),
            total_score=round(agg["total_score"], 3),
            peak_count=1,
            peak_centers=[w.center],
            matched_keywords=agg["matched_keywords"],
            reasons=reasons,
            category=_candidate_category(agg["laugh_score"], agg["surprise_score"], agg["clip_worthy_score"], agg["burst_score"], agg["matched_keywords"]),
            confidence=_confidence(w.total_score, max_score, int(agg["unique_author_count_max"]), int(agg["keyword_hits"])),
            representative_comments=agg["representative_comments"],
        ))

    _assign_overlap_groups(candidates)
    return candidates


def _build_short_reasons(w: TimelineWindow, agg: Dict[str, float]) -> List[str]:
    reasons: List[str] = []
    if w.chat_count >= 5:
        reasons.append(f"コメント密度が高い ({int(w.chat_count)}件)")
    if w.keyword_hits > 0:
        reasons.append(f"リアクション/キーワードが集中 ({int(w.keyword_hits)}件)")
    if w.laugh_score >= 3:
        reasons.append(f"笑い系キーワード ({w.laugh_score:.0f})")
    if w.surprise_score >= 3:
        reasons.append(f"驚き系キーワード ({w.surprise_score:.0f})")
    if w.clip_worthy_score >= 3:
        reasons.append(f"神・天才系 ({w.clip_worthy_score:.0f})")
    if w.burst_score >= 5:
        reasons.append("周辺と比べてバースト")
    if w.unique_author_count >= 3:
        reasons.append(f"複数視聴者が反応 ({w.unique_author_count}人)")
    if not reasons:
        reasons.append("チャット活動を検出")
    return reasons


# ─── Medium candidates ───────────────────────────────────────────────────────

def generate_medium_candidates(
    windows: Sequence[TimelineWindow],
    top_n: int = 5,
    vod_duration: Optional[float] = None,
    min_gap: float = 180.0,
    min_score: float = 0.0,
    max_peaks: int = MEDIUM_MAX_PEAKS,
) -> List[Candidate]:
    """
    Medium = 2-3 nearby peaks merged into a 3-5 min range.

    Algorithm:
      1. Sort windows by total_score desc, keep those with score > min_score.
      2. Greedy: pick the highest-scoring window, then merge any other
         windows within MEDIUM_PEAK_GAP of it (up to max_peaks total).
      3. Clip range = [first_window.start, last_window.end], padded to fit
         [MEDIUM_MIN, MEDIUM_MAX].
      4. Score = sum of merged window scores.
      5. Deduplicate by min_gap between candidate centers.
    """
    indices = [i for i, w in enumerate(windows) if w.total_score > min_score]
    indices.sort(key=lambda i: windows[i].total_score, reverse=True)

    used: Set[int] = set()
    candidates: List[Candidate] = []
    max_score = max((w.total_score for w in windows), default=0.0)

    for i in indices:
        if i in used:
            continue
        # Start a new medium cluster from this peak
        cluster: List[int] = [i]
        used.add(i)

        # Greedy merge of nearby peaks
        # We look at remaining windows sorted by total_score; include those
        # within MEDIUM_PEAK_GAP of any existing cluster member, until max_peaks.
        for j in indices:
            if j in used or len(cluster) >= max_peaks:
                continue
            wj = windows[j]
            if any(abs(wj.center - windows[k].center) <= MEDIUM_TARGET_PEAK_GAP for k in cluster):
                cluster.append(j)
                used.add(j)

        if len(cluster) < 2:
            # Medium requires 2-3 peaks; treat as short fallback candidate.
            # (We drop it from the medium list; the short list will catch it.)
            # Re-release all cluster members so the short list can still pick them.
            for k in cluster:
                used.discard(k)
            continue

        cluster.sort(key=lambda k: windows[k].start)
        first = cluster[0]
        last = cluster[-1]
        peak_idx = max(cluster, key=lambda k: windows[k].total_score)
        peak_window = windows[peak_idx]

        req_start = windows[first].start
        req_end = windows[last].end

        # Pad slightly to reach MEDIUM_MIN if too short
        clip_start, clip_end = _safe_clip_range(
            req_start, req_end, MEDIUM_MIN, MEDIUM_MAX, vod_duration
        )

        agg = _aggregate_windows(windows, cluster)
        coherence = _topic_coherence(windows, cluster)
        dead_air = _dead_air_penalty(windows, clip_start, clip_end)

        score = agg["total_score"] + coherence * 5.0 - dead_air * 3.0

        # dedup by min_gap between centers
        if any(abs(peak_window.center - c.peak_time) < min_gap for c in candidates):
            continue

        rank = len(candidates) + 1
        cluster_idx_for_peak = cluster.index(peak_idx)
        candidates.append(Candidate(
            candidate_id=f"medium_{rank:03d}",
            kind="medium",
            rank=rank,
            start=windows[first].start,
            end=windows[last].end,
            peak_time=peak_window.center,
            peak_window_index=cluster_idx_for_peak,
            clip_start=clip_start,
            clip_end=clip_end,
            clip_duration=round(clip_end - clip_start, 3),
            score=round(score, 3),
            chat_count=agg["chat_count"],
            unique_author_count=int(agg["unique_author_count_max"]),
            keyword_hits=agg["keyword_hits"],
            laugh_score=round(agg["laugh_score"], 3),
            surprise_score=round(agg["surprise_score"], 3),
            clip_worthy_score=round(agg["clip_worthy_score"], 3),
            reaction_score=round(agg["reaction_score"], 3),
            burst_score=round(agg["burst_score"], 3),
            total_score=round(agg["total_score"], 3),
            peak_count=len(cluster),
            peak_centers=[windows[k].center for k in cluster],
            matched_keywords=agg["matched_keywords"],
            reasons=_build_medium_reasons(cluster, windows, agg, coherence, dead_air),
            topic_coherence_score=round(coherence, 3),
            sustained_chat_score=round(_sustained_chat_score(windows, cluster), 3),
            dead_air_penalty=round(dead_air, 3),
            category=_candidate_category(agg["laugh_score"], agg["surprise_score"], agg["clip_worthy_score"], agg["burst_score"], agg["matched_keywords"]),
            confidence=_confidence(score, max_score * max(1, len(cluster)), int(agg["unique_author_count_max"]), int(agg["keyword_hits"]), len(cluster)),
            representative_comments=agg["representative_comments"],
        ))

        if len(candidates) >= top_n:
            break

    # re-rank by score desc
    candidates.sort(key=lambda c: c.score, reverse=True)
    for idx, c in enumerate(candidates, 1):
        c.rank = idx
        c.candidate_id = f"medium_{idx:03d}"
    _assign_overlap_groups(candidates)
    return candidates


def _build_medium_reasons(
    cluster: List[int],
    windows: Sequence[TimelineWindow],
    agg: Dict[str, float],
    coherence: float,
    dead_air: float,
) -> List[str]:
    reasons: List[str] = []
    reasons.append(f"{len(cluster)} ピークを統合")
    if agg["chat_count"] >= 30:
        reasons.append(f"コメント総数 {int(agg['chat_count'])}")
    if agg["laugh_score"] >= 5:
        reasons.append(f"笑い系 {agg['laugh_score']:.0f}")
    if agg["surprise_score"] >= 5:
        reasons.append(f"驚き系 {agg['surprise_score']:.0f}")
    if coherence >= 0.4:
        reasons.append("話題が一貫している")
    if dead_air >= 0.5:
        reasons.append("低反応区間あり")
    return reasons


def _infer_step(windows: Sequence[TimelineWindow]) -> int:
    """Best-effort step inference from consecutive window starts."""
    if len(windows) < 2:
        return 10
    diffs = []
    for a, b in zip(windows, windows[1:]):
        d = b.start - a.start
        if d > 0:
            diffs.append(d)
    if not diffs:
        return 10
    return int(round(sum(diffs) / len(diffs)))


def _local_peaks_within_run(
    windows: Sequence[TimelineWindow],
    run: Sequence[int],
    top_n: int = 8,
) -> List[int]:
    """
    Identify local peak windows within an active run. A local peak is a
    window whose total_score is >= both immediate neighbors (when present)
    in the run. We then take the top `top_n` local peaks by total_score.
    """
    if not run:
        return []
    if len(run) == 1:
        return [run[0]]

    local_peaks: List[int] = []
    for pos, idx in enumerate(run):
        cur = windows[idx].total_score
        left = windows[run[pos - 1]].total_score if pos > 0 else -math.inf
        right = windows[run[pos + 1]].total_score if pos < len(run) - 1 else -math.inf
        if cur >= left and cur >= right and cur > 0:
            local_peaks.append(idx)

    # Sort by total_score desc and keep top_n
    local_peaks.sort(key=lambda k: windows[k].total_score, reverse=True)
    return local_peaks[:top_n]


# ─── Long candidates ─────────────────────────────────────────────────────────

def generate_long_candidates(
    windows: Sequence[TimelineWindow],
    top_n: int = 3,
    vod_duration: Optional[float] = None,
    min_gap: float = 360.0,
    min_score: float = 0.0,
    min_peak_count: int = LONG_MIN_PEAK_COUNT,
    max_peaks: int = 8,
) -> List[Candidate]:
    """
    Long = multi-peak cluster spanning 8-12 min.

    Algorithm:
      1. Group windows into runs separated by low-activity gaps
         (median - 50% of median chat count for a gap > LONG_PEAK_GAP).
      2. Within each run, find local peak windows (top by total_score).
      3. Build a candidate for each run with at least min_peak_count peaks.
      4. Compute long_score per the project spec.
      5. Deduplicate by min_gap between candidate centers.
    """
    if not windows:
        return []

    # Find activity runs separated by long quiet gaps. We define a window
    # as "active" when its chat count is above the threshold (50% of the
    # median). A run is a maximal consecutive sequence of active windows.
    # We then merge runs whose temporal gap (the distance from the end of
    # one run to the start of the next) is <= LONG_PEAK_GAP.
    median_chat = _median([w.chat_count for w in windows]) or 0
    threshold = max(1, int(median_chat * 0.5))

    active_runs: List[List[int]] = []
    current: List[int] = []
    for i, w in enumerate(windows):
        if w.chat_count >= threshold:
            current.append(i)
        else:
            if current:
                active_runs.append(current)
                current = []
    if current:
        active_runs.append(current)

    # Merge runs that are close together (gap between end of run A and
    # start of run B is <= LONG_PEAK_GAP).
    runs: List[List[int]] = []
    for run in active_runs:
        if runs:
            prev_last_idx = runs[-1][-1]
            gap = windows[run[0]].start - windows[prev_last_idx].end
            if gap <= LONG_PEAK_GAP:
                runs[-1] = runs[-1] + run
                continue
        runs.append(run)

    candidates: List[Candidate] = []
    max_score = max((w.total_score for w in windows), default=0.0)

    for run in runs:
        if not run:
            continue
        # Pick local peak windows within this run: a local peak is a
        # window whose total_score is >= both immediate neighbors in the
        # run. Then we take the top max_peaks of those local peaks.
        peak_indices = _local_peaks_within_run(windows, run, top_n=max_peaks)
        peak_indices.sort(key=lambda k: windows[k].start)
        peak_count = len(peak_indices)
        if peak_count < min_peak_count:
            continue

        peak_window_idx = max(peak_indices, key=lambda k: windows[k].total_score)
        peak_window = windows[peak_window_idx]
        peak_idx_in_cluster = peak_indices.index(peak_window_idx)

        first = peak_indices[0]
        last = peak_indices[-1]
        req_start = windows[first].start
        req_end = windows[last].end

        clip_start, clip_end = _safe_clip_range(
            req_start, req_end, LONG_MIN, LONG_MAX, vod_duration
        )

        agg = _aggregate_windows(windows, peak_indices)
        coherence = _topic_coherence(windows, peak_indices)
        dead_air = _dead_air_penalty(windows, clip_start, clip_end)
        sustained = _sustained_chat_score(windows, peak_indices)
        avg_score = agg["total_score"] / max(1, peak_count)
        max_peak = max(windows[k].total_score for k in peak_indices)
        unique_author_score = float(agg["unique_author_count_max"])
        keyword_score = float(agg["keyword_hits"])

        long_score = (
            peak_count * 2.0
            + sustained * 1.5
            + avg_score * 1.0
            + max_peak * 1.2
            + unique_author_score * 0.8
            + keyword_score * 1.2
            + coherence * 2.0
            - dead_air * 1.5
        )

        # dedup by min_gap between centers
        if any(abs(peak_window.center - c.peak_time) < min_gap for c in candidates):
            continue

        rank = len(candidates) + 1
        candidates.append(Candidate(
            candidate_id=f"long_{rank:03d}",
            kind="long",
            rank=rank,
            start=windows[first].start,
            end=windows[last].end,
            peak_time=peak_window.center,
            peak_window_index=peak_idx_in_cluster,
            clip_start=clip_start,
            clip_end=clip_end,
            clip_duration=round(clip_end - clip_start, 3),
            score=round(long_score, 3),
            chat_count=agg["chat_count"],
            unique_author_count=int(agg["unique_author_count_max"]),
            keyword_hits=agg["keyword_hits"],
            laugh_score=round(agg["laugh_score"], 3),
            surprise_score=round(agg["surprise_score"], 3),
            clip_worthy_score=round(agg["clip_worthy_score"], 3),
            reaction_score=round(agg["reaction_score"], 3),
            burst_score=round(agg["burst_score"], 3),
            total_score=round(agg["total_score"], 3),
            peak_count=peak_count,
            peak_centers=[windows[k].center for k in peak_indices],
            matched_keywords=agg["matched_keywords"],
            reasons=_build_long_reasons(peak_count, coherence, dead_air, sustained),
            topic_coherence_score=round(coherence, 3),
            sustained_chat_score=round(sustained, 3),
            dead_air_penalty=round(dead_air, 3),
            long_score=round(long_score, 3),
            category=_candidate_category(agg["laugh_score"], agg["surprise_score"], agg["clip_worthy_score"], agg["burst_score"], agg["matched_keywords"]),
            confidence=_confidence(long_score, max_score * max(1, peak_count), int(agg["unique_author_count_max"]), int(agg["keyword_hits"]), peak_count),
            representative_comments=agg["representative_comments"],
        ))

        if len(candidates) >= top_n:
            break

    candidates.sort(key=lambda c: c.long_score, reverse=True)
    for idx, c in enumerate(candidates, 1):
        c.rank = idx
        c.candidate_id = f"long_{idx:03d}"
    _assign_overlap_groups(candidates)
    return candidates


def _build_long_reasons(
    peak_count: int,
    coherence: float,
    dead_air: float,
    sustained: float,
) -> List[str]:
    reasons: List[str] = []
    reasons.append(f"複数ピーク ({peak_count})")
    if sustained >= 0.5:
        reasons.append(f"持続的なチャット ({sustained:.2f}/s)")
    if coherence >= 0.3:
        reasons.append("話題が連続")
    if dead_air >= 0.5:
        reasons.append("低反応区間あり")
    return reasons


def _median(values: Sequence[float]) -> float:
    if not values:
        return 0.0
    s = sorted(values)
    n = len(s)
    if n % 2 == 1:
        return float(s[n // 2])
    return (s[n // 2 - 1] + s[n // 2]) / 2.0


# ─── Orchestrator ────────────────────────────────────────────────────────────

def generate_all_candidates(
    windows: Sequence[TimelineWindow],
    vod_duration: Optional[float] = None,
    short_top: int = 5,
    medium_top: int = 5,
    long_top: int = 3,
    min_score: float = 0.0,
) -> Dict[str, List[Candidate]]:
    """
    Run all three candidate generators and return a dict keyed by kind.
    """
    result = {
        "short": generate_short_candidates(
            windows, top_n=short_top, vod_duration=vod_duration, min_score=min_score,
        ),
        "medium": generate_medium_candidates(
            windows, top_n=medium_top, vod_duration=vod_duration, min_score=min_score,
        ),
        "long": generate_long_candidates(
            windows, top_n=long_top, vod_duration=vod_duration, min_score=min_score,
        ),
    }
    all_candidates = result["short"] + result["medium"] + result["long"]
    _assign_overlap_groups(all_candidates)
    return result
