export function getBackendApiBaseUrl() {
  return process.env.TRANSCRIPTION_API_BASE_URL ?? process.env.NEXT_PUBLIC_TRANSCRIPTION_API_BASE_URL ?? "http://127.0.0.1:8000";
}

export async function proxyJsonRequest(path: string, init?: RequestInit & { timeoutMs?: number }) {
  const backendUrl = `${getBackendApiBaseUrl()}${path}`;
  const { timeoutMs, ...fetchInit } = init ?? {};
  const timeout = timeoutMs ?? 300_000; // 5 minutes default
  const timeoutSignal = AbortSignal.timeout(timeout);
  const callerSignal = fetchInit.signal as AbortSignal | undefined;
  const signal = callerSignal
    ? AbortSignal.any([callerSignal, timeoutSignal])
    : timeoutSignal;
  const response = await fetch(backendUrl, {
    ...fetchInit,
    signal,
    headers: {
      "Content-Type": "application/json",
      ...(fetchInit?.headers ?? {})
    },
    cache: "no-store"
  });
  const text = await response.text();
  let payload: unknown = null;

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { error: text };
    }
  }

  return { response, payload };
}
