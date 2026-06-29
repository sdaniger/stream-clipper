"use client";
import React, { useRef, useEffect, useState } from "react";

interface LogEntry {
  level: "user" | "info" | "warn" | "error";
  message: string;
}

interface Props {
  logs: LogEntry[];
  diagnostic?: Record<string, unknown> | null;
}

export default function LogPanel({ logs, diagnostic }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [diagnosticOpen, setDiagnosticOpen] = useState(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs.length]);

  return (
    <div className="glass-panel rounded-lg p-2">
      <div className="flex justify-between items-center mb-1">
        <span className="text-[11px] text-slate-400 font-semibold">操作ログ</span>
        <div className="flex items-center gap-2">
          {diagnostic && (
            <button
              onClick={() => setDiagnosticOpen(!diagnosticOpen)}
              className="text-[10px] text-slate-500 hover:text-slate-300"
            >
              {diagnosticOpen ? "▼" : "▶"} 技術情報
            </button>
          )}
          <span className="text-[10px] text-slate-600">{logs.length} 件</span>
        </div>
      </div>
      <div className="max-h-[100px] overflow-y-auto">
        {logs.length === 0 ? (
          <div className="text-[11px] text-slate-600 italic py-1">操作ログがここに表示されます</div>
        ) : (
          logs.map((log, i) => (
            <div
              key={i}
              className={`text-[11px] leading-relaxed flex items-start gap-1.5 ${
                log.level === "error"
                  ? "text-red-300"
                  : log.level === "warn"
                    ? "text-amber-300"
                    : log.level === "info"
                      ? "text-slate-500"
                      : "text-slate-300"
              }`}
            >
              <span className="text-slate-600 flex-shrink-0">
                {log.level === "error" ? "✕" : log.level === "warn" ? "⚠" : log.level === "info" ? "·" : "•"}
              </span>
              <span>{log.message}</span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
      {diagnostic && diagnosticOpen && (
        <div className="mt-2 pt-2 border-t border-slate-700/50">
          <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">技術情報（開発者向け）</div>
          <div className="bg-slate-950 rounded p-2 max-h-[150px] overflow-y-auto">
            {Object.entries(diagnostic).map(([key, value]) => (
              <div key={key} className="text-[10px] text-slate-500 font-mono flex">
                <span className="text-slate-600 w-[160px] flex-shrink-0">{key}:</span>
                <span className="text-slate-400">{String(value)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
