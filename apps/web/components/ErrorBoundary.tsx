"use client";

import React from "react";

interface Props {
  children: React.ReactNode;
  fallbackTitle?: string;
  fallbackBody?: string;
}

interface State {
  hasError: boolean;
  message: string;
}

/**
 * A small React error boundary. If a child component throws during
 * render we display a minimal recovery screen instead of letting the
 * whole Studio UI go blank.
 */
export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, message: "" };

  static getDerivedStateFromError(error: unknown): State {
    const message =
      error instanceof Error ? error.message : "An unknown error occurred.";
    return { hasError: true, message };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    // Surface the error so it's not lost; in production this could go
    // to a logging endpoint.
    if (typeof console !== "undefined") {
      console.error("ErrorBoundary caught:", error, info);
    }
  }

  private handleReset = () => {
    this.setState({ hasError: false, message: "" });
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }
    const title = this.props.fallbackTitle ?? "Something went wrong";
    const body =
      this.props.fallbackBody ??
      "An unexpected error occurred in this section. You can try again or reload the page.";
    return (
      <div
        role="alert"
        className="m-3 sm:m-4 rounded-xl border border-red-500/40 bg-red-500/[0.05] p-4 sm:p-6 text-slate-100"
      >
        <div className="flex items-center gap-2 mb-2">
          <span className="text-red-400 text-lg">⚠</span>
          <h2 className="text-sm sm:text-base font-semibold text-red-200">
            {title}
          </h2>
        </div>
        <p className="text-xs sm:text-sm text-red-100/80 leading-relaxed mb-3">
          {body}
        </p>
        {this.state.message && (
          <pre className="text-[10px] sm:text-xs font-mono bg-slate-950/60 text-slate-300 rounded p-2 mb-3 overflow-x-auto whitespace-pre-wrap break-all">
            {this.state.message}
          </pre>
        )}
        <button
          type="button"
          onClick={this.handleReset}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-cyan-600/60 hover:bg-cyan-500/70 text-white transition-colors"
        >
          Try again
        </button>
      </div>
    );
  }
}
