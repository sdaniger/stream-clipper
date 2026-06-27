"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function GlobalError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error("Global error:", error);
  }, [error]);

  return (
    <html lang="ja">
      <body className="min-h-screen bg-slate-950 font-sans antialiased text-slate-100">
        <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-6 px-6 py-12 text-center">
          <div className="rounded-full border border-rose-300/40 bg-rose-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.26em] text-rose-100">
            Unexpected Error
          </div>
          <h1 className="text-3xl font-bold text-white sm:text-4xl">
            Something went wrong rendering this page.
          </h1>
          <p className="max-w-md text-sm leading-6 text-slate-300">
            The app hit an unrecoverable error. You can try again, or reload the page. The full error has been logged to the browser console.
          </p>
          {error.digest && (
            <code className="rounded-2xl border border-white/10 bg-black/40 px-3 py-1.5 text-xs text-slate-300">
              digest: {error.digest}
            </code>
          )}
          <pre className="max-h-48 w-full overflow-auto rounded-2xl border border-white/10 bg-black/40 p-3 text-left text-xs text-slate-300">
            {error.message}
          </pre>
          <div className="flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={reset}
              className="rounded-2xl border border-cyan-200/45 bg-cyan-300/15 px-5 py-2.5 text-sm font-semibold text-cyan-50 transition hover:bg-cyan-300/25"
            >
              Try again
            </button>
            <Link
              href="/"
              className="rounded-2xl border border-white/15 bg-white/[0.04] px-5 py-2.5 text-sm font-semibold text-slate-200 transition hover:bg-white/10"
            >
              Reload home
            </Link>
          </div>
        </main>
      </body>
    </html>
  );
}
