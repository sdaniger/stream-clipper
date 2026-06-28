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
    <div className="panel log-panel">
      <div className="panel-header">
        <span style={{ fontSize: 11, color: "#666" }}>Activity Log</span>
        <span style={{ fontSize: 10, color: "#444" }}>{logs.length} entries</span>
      </div>
      <div className="log-scroll">
        {logs.map((log, i) => (
          <div key={i} className="log-line">{log}</div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
