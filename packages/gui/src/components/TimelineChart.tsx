import React from "react";
import {
  ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceArea, ReferenceLine,
} from "recharts";
import type { HighlightCandidate, TimelineRow } from "../api";
import { fmt } from "../utils";

interface Props {
  timeline: TimelineRow[];
  highlights: HighlightCandidate[];
  selectedHighlight: HighlightCandidate | null;
  onChartClick: (...args: unknown[]) => void;
  onSaveJson: () => void;
  onSaveCsv: () => void;
}

export default function TimelineChart({
  timeline, highlights, selectedHighlight,
  onChartClick, onSaveJson, onSaveCsv,
}: Props) {
  return (
    <div className="panel" style={{ flex: 1 }}>
      <div className="panel-header">
        <span className="panel-title">Engagement Timeline</span>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="btn btn-sm" onClick={onSaveJson}>Save JSON</button>
          <button className="btn btn-sm" onClick={onSaveCsv}>Save CSV</button>
        </div>
      </div>
      {timeline.length > 0 ? (
        <ResponsiveContainer width="100%" height={180}>
          <ComposedChart data={timeline} onClick={onChartClick as any}>
            <CartesianGrid strokeDasharray="3 3" stroke="#333" />
            <XAxis dataKey="start" tick={{ fill: "#888", fontSize: 10 }} tickFormatter={(v: number) => fmt(v)} />
            <YAxis tick={{ fill: "#888", fontSize: 10 }} />
            <Tooltip
              contentStyle={{ background: "#222", border: "1px solid #444", borderRadius: 6, fontSize: 12 }}
              labelFormatter={(v: number) => fmt(v)}
            />
            <Bar dataKey="score" fill="rgba(192,132,252,0.3)" isAnimationActive={false} cursor="pointer" />
            <Line type="monotone" dataKey="score" stroke="#c084fc" strokeWidth={2} dot={false} activeDot={{ r: 5, fill: "#c084fc", cursor: "pointer" }} />
            {highlights.map((h) => (
              <ReferenceArea key={h.rank} x1={h.start} x2={h.end} fill="rgba(192, 132, 252, 0.08)" />
            ))}
            {selectedHighlight && (
              <>
                <ReferenceLine x={selectedHighlight.start} stroke="#fbbf24" strokeDasharray="4 2" />
                <ReferenceLine x={selectedHighlight.end} stroke="#fbbf24" strokeDasharray="4 2" />
              </>
            )}
          </ComposedChart>
        </ResponsiveContainer>
      ) : (
        <div className="empty-state" style={{ height: 180 }}>
          Run analysis to see timeline
        </div>
      )}
    </div>
  );
}
