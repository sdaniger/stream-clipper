"use client";
import React, { useEffect, useState } from "react";

type SavedClip = {
  id: string;
  title: string;
  streamer: string;
  archiveTitle: string;
  detectedAt: string;
  duration: string;
  confidence: number;
  status: string;
  createdAt: string;
  clipPath: string | null;
  commentBurnedPath: string | null;
};

export default function ClipsGallery() {
  const [clips, setClips] = useState<SavedClip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/media/clips")
      .then((res) => res.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setClips(data.clips ?? []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="text-xs text-slate-500">Loading clips...</div>;
  }

  if (error) {
    return <div className="text-xs text-red-400">Error: {error}</div>;
  }

  if (clips.length === 0) {
    return (
      <div className="glass-panel rounded-lg p-6 text-center">
        <p className="text-sm text-slate-400">No saved clips yet.</p>
        <p className="text-xs text-slate-500 mt-1">Run the pipeline to generate clips — they will appear here.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {clips.map((clip) => (
        <div key={clip.id} className="glass-panel rounded-lg p-3 flex flex-col gap-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-white truncate" title={clip.title}>
                {clip.title}
              </h3>
              {clip.archiveTitle && (
                <p className="text-[11px] text-slate-400 truncate">{clip.archiveTitle}</p>
              )}
            </div>
            <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
              clip.confidence >= 80 ? "bg-violet-500/20 text-violet-200" :
              clip.confidence >= 50 ? "bg-amber-500/20 text-amber-200" :
              "bg-slate-500/20 text-slate-300"
            }`}>
              {clip.confidence}%
            </span>
          </div>

          <div className="flex flex-wrap gap-1.5 text-[10px] text-slate-500">
            {clip.streamer && (
              <span className="rounded bg-white/[0.04] px-1.5 py-0.5">{clip.streamer}</span>
            )}
            {clip.detectedAt && (
              <span className="rounded bg-white/[0.04] px-1.5 py-0.5">{clip.detectedAt}</span>
            )}
            {clip.duration && (
              <span className="rounded bg-white/[0.04] px-1.5 py-0.5">{clip.duration}</span>
            )}
          </div>

          <div className="flex gap-2 mt-auto pt-1">
            {clip.clipPath && (
              <a
                href={`/api/media/files?path=${encodeURIComponent(clip.clipPath)}`}
                download
                className="flex-1 rounded border border-slate-600 bg-slate-700/30 px-2 py-1 text-[11px] text-slate-300 text-center hover:bg-slate-700/50 transition"
              >
                Download Clip
              </a>
            )}
            {clip.commentBurnedPath && (
              <a
                href={`/api/media/files?path=${encodeURIComponent(clip.commentBurnedPath)}`}
                download
                className="flex-1 rounded border border-cyan-600 bg-cyan-700/30 px-2 py-1 text-[11px] text-cyan-200 text-center hover:bg-cyan-700/50 transition"
              >
                With Comments
              </a>
            )}
          </div>

          <p className="text-[10px] text-slate-600">
            {new Date(clip.createdAt).toLocaleDateString("ja-JP", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
          </p>
        </div>
      ))}
    </div>
  );
}
