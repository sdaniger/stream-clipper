"use client";
import React from "react";
import { ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceArea, ReferenceLine } from "recharts";
import type { TimelineRow, HighlightCandidate } from "@/lib/studio-api";

function fmt(v: number): string {
  const m = Math.floor(v / 60);
  const s = Math.floor(v % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

interface Props {
  timeline: TimelineRow[];
  highlights: HighlightCandidate[];
  selectedRank: number | null;
  currentTime: number;
  onChartClick: (...args: unknown[]) => void;
}

export default function HighlightChart({ timeline, highlights, selectedRank, currentTime, onChartClick }: Props) {
  return (
    <div className="glass-panel rounded-lg p-3">
      <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Engagement Timeline</div>
      {timeline.length > 0 ? (
        <ResponsiveContainer width="100%" height={200}>
          <ComposedChart data={timeline} onClick={onChartClick as any}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="start" tick={{ fill: "#94a3b8", fontSize: 10 }} tickFormatter={(v: number) => fmt(v)} />
            <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} />
            <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #475569", borderRadius: 6, fontSize: 12 }}
              labelFormatter={(v: any) => fmt(Number(v))} />
            <Bar dataKey="score" fill="rgba(192,132,252,0.25)" isAnimationActive={false} cursor="pointer" />
            <Line type="monotone" dataKey="score" stroke="#c084fc" strokeWidth={2} dot={false} activeDot={{ r: 5, fill: "#c084fc", cursor: "pointer" }} />
            {highlights.map((h) => (
              <ReferenceArea key={h.rank} x1={h.start} x2={h.end}
                fill={h.rank === selectedRank ? "rgba(251,191,36,0.12)" : "rgba(192,132,252,0.06)"}
                stroke={h.rank === selectedRank ? "#fbbf24" : "none"}
                strokeDasharray={h.rank === selectedRank ? "3 3" : undefined} />
            ))}
            <ReferenceLine x={currentTime} stroke="#ef4444" strokeWidth={2} label={{ value: "▶", fill: "#ef4444", fontSize: 14, position: "top" }} />
          </ComposedChart>
        </ResponsiveContainer>
      ) : (
        <div className="flex items-center justify-center h-[200px] text-slate-500 text-xs">Run analysis to see engagement timeline</div>
      )}
    </div>
  );
}
