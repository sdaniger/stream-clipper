const HELIX_BASE = "https://api.twitch.tv/helix";
const CLIENT_ID = process.env.TWITCH_CLIENT_ID ?? "";

export type HelixClipResult = {
  id: string;
  edit_url: string;
  embed_url: string;
  game_id: string;
  duration: number;
  created_at: string;
  broadcaster_id: string;
};

export type HelixUser = {
  id: string;
  login: string;
  display_name: string;
};

export function extractVodIdFromUrl(url: string): string | null {
  const m = url.match(/twitch\.tv\/videos\/(\d+)/);
  return m ? m[1] : null;
}

export function secondsToTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  if (h > 0) return `${h}h${String(m).padStart(2, "0")}m${String(s).padStart(2, "0")}s`;
  if (m > 0) return `${m}m${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

export function buildVodTimestampUrl(vodId: string, seconds: number): string {
  return `https://www.twitch.tv/videos/${vodId}?t=${secondsToTimestamp(seconds)}`;
}

async function helixRequest<T>(path: string, oauthToken: string, init?: RequestInit): Promise<T> {
  if (!CLIENT_ID) throw new Error("TWITCH_CLIENT_ID env var is not set.");
  if (!oauthToken) throw new Error("Twitch OAuth token is required.");

  const res = await fetch(`${HELIX_BASE}${path}`, {
    ...init,
    headers: {
      "Client-Id": CLIENT_ID,
      "Authorization": `Bearer ${oauthToken.replace(/^oauth:/, "")}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Twitch Helix API error ${res.status}: ${body.slice(0, 500)}`);
  }

  return res.json() as Promise<T>;
}

export async function validateHelixToken(oauthToken: string): Promise<HelixUser> {
  const data = await helixRequest<{ data: HelixUser[] }>("/users", oauthToken);
  if (!data.data?.length) throw new Error("Twitch token is valid but returned no user data.");
  return data.data[0];
}

export async function createHelixClip(input: {
  vodId: string;
  startSeconds: number;
  duration: number;
  oauthToken: string;
}): Promise<HelixClipResult> {
  const { vodId, startSeconds, duration, oauthToken } = input;

  const params = new URLSearchParams({
    vod_id: vodId,
    vod_offset: String(Math.round(startSeconds)),
    duration: String(Math.min(60, Math.max(5, duration))),
  });

  // First, get the broadcaster_id from the VOD metadata via the videos endpoint.
  const vodData = await helixRequest<{ data: Array<{ id: string; user_id: string }> }>(
    `/videos?id=${vodId}`,
    oauthToken,
  );
  const vod = vodData.data?.[0];
  if (!vod) throw new Error(`VOD ${vodId} not found or not accessible.`);

  params.set("broadcaster_id", vod.user_id);

  // Use the new VOD clips endpoint (POST /helix/videos/clips).
  // Falls back to /helix/clips if the new endpoint is unavailable.
  let clipData: { data: HelixClipResult[] };
  try {
    clipData = await helixRequest<{ data: HelixClipResult[] }>(
      `/videos/clips?${params.toString()}`,
      oauthToken,
      { method: "POST" },
    );
  } catch {
    // Fallback to legacy endpoint
    clipData = await helixRequest<{ data: HelixClipResult[] }>(
      `/clips?${params.toString()}`,
      oauthToken,
      { method: "POST" },
    );
  }

  if (!clipData.data?.length) throw new Error("Clip creation returned no data.");
  return clipData.data[0];
}
