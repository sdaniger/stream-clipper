import { getBackendApiBaseUrl } from "./api-proxy";
import { spawn } from "node:child_process";
import path from "node:path";

let spawnAttempted = false;
let spawnInProgress: Promise<boolean> | null = null;

export type BackendHealth = {
  alive: boolean;
  engine: string | null;
  device: string | null;
  model: string | null;
  error: string | null;
};

export async function checkBackendHealth(): Promise<BackendHealth> {
  try {
    const res = await fetch(`${getBackendApiBaseUrl()}/api/transcription/health`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) {
      return { alive: false, engine: null, device: null, model: null, error: `HTTP ${res.status}` };
    }
    const json = await res.json();
    return {
      alive: true,
      engine: json.engine ?? null,
      device: json.device ?? null,
      model: json.default_model ?? null,
      error: null,
    };
  } catch (err) {
    return {
      alive: false,
      engine: null,
      device: null,
      model: null,
      error: err instanceof Error ? err.message : "Unknown",
    };
  }
}

function findApiRoot(): string {
  const candidate = path.resolve(process.cwd(), "apps", "api");
  return candidate;
}

export async function spawnBackend(): Promise<boolean> {
  // deduplicate concurrent spawn attempts
  if (spawnInProgress) return spawnInProgress;

  spawnInProgress = (async () => {
    if (spawnAttempted) return false;
    spawnAttempted = true;

    const apiRoot = findApiRoot();
    const venvPython = path.join(apiRoot, ".venv", "bin", "uvicorn");
    const envFile = path.join(apiRoot, ".env");

    try {
      const envVars = { ...process.env };
      try {
        const envContent = await import("node:fs/promises").then((fs) =>
          fs.readFile(envFile, "utf-8")
        );
        for (const line of envContent.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) continue;
          const eqIdx = trimmed.indexOf("=");
          if (eqIdx > 0) {
            envVars[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
          }
        }
      } catch { /* .env not found, use process.env */ }

      const child = spawn(venvPython, [
        "app.main:app",
        "--host", "0.0.0.0",
        "--port", "8000",
      ], {
        cwd: apiRoot,
        env: envVars,
        stdio: "ignore",
        detached: false,
      });

      // Prevent uncaught ENOENT errors from crashing the process.
      child.on("error", () => {});

      // wait up to 3s for backend to become healthy
      for (let i = 0; i < 6; i++) {
        await new Promise((r) => setTimeout(r, 500));
        const health = await checkBackendHealth();
        if (health.alive) return true;
      }
      return false;
    } catch {
      return false;
    }
  })();

  return spawnInProgress;
}
