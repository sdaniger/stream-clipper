"use client";
import React, { useRef, useEffect } from "react";

interface Props {
  logs: string[];
}

export default function LogPanel({ logs }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs.length]);

  return (
    <div className="glass-panel rounded-lg p-2">
      <div className="flex justify-between items-center mb-1">
        <span className="text-[11px] text-slate-500">Activity Log</span>
        <span className="text-[10px] text-slate-600">{logs.length} entries</span>
      </div>
      <div className="max-h-[70px] overflow-y-auto">
        {logs.map((log, i) => (
          <div key={i} className="text-[11px] text-slate-600 font-mono leading-relaxed whitespace-nowrap">{log}</div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
