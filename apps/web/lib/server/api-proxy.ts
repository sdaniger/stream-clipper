export function getBackendApiBaseUrl() {
  return process.env.TRANSCRIPTION_API_BASE_URL ?? process.env.NEXT_PUBLIC_TRANSCRIPTION_API_BASE_URL ?? "http://127.0.0.1:8000";
}

export async function proxyJsonRequest(path: string, init?: RequestInit) {
  const backendUrl = `${getBackendApiBaseUrl()}${path}`;
  const response = await fetch(backendUrl, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
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
