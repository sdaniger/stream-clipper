from __future__ import annotations

import json
import os
import urllib.request
import urllib.error
from typing import Any, Dict, Optional


def _config() -> Optional[Dict[str, str]]:
    api_key = (os.getenv("LLM_API_KEY") or os.getenv("GEMINI_API_KEY") or os.getenv("GROQ_API_KEY") or "").strip()
    if not api_key:
        return None
    provider = (os.getenv("LLM_PROVIDER") or "gemini").strip()
    if provider == "gemini":
        return {
            "provider": provider,
            "api_key": api_key,
            "model": (os.getenv("LLM_MODEL") or "gemini-2.0-flash").strip(),
            "endpoint": (os.getenv("LLM_API_URL") or "https://generativelanguage.googleapis.com/v1beta").strip(),
        }
    return {
        "provider": provider,
        "api_key": api_key,
        "model": (os.getenv("LLM_MODEL") or "gpt-4o-mini").strip(),
        "endpoint": (os.getenv("LLM_API_URL") or "https://api.openai.com/v1/chat/completions").strip(),
    }


def _fallback(candidate: Dict[str, Any], base_youtube: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "title": base_youtube.get("title") or "配信ハイライト",
        "description": base_youtube.get("description") or "自動生成された切り抜き候補です。",
        "tags": base_youtube.get("tags") or ["切り抜き", "ハイライト"],
        "pinned_comment": "どの場面が一番好きでしたか？",
        "thumbnail_text": [str(candidate.get("category") or "ハイライト")],
        "social_post": base_youtube.get("title") or "配信ハイライトを公開しました。",
        "fallback": True,
    }


def build_llm_metadata(candidate: Dict[str, Any], base_youtube: Dict[str, Any], vod_title: Optional[str], streamer_name: Optional[str]) -> Dict[str, Any]:
    cfg = _config()
    if not cfg:
        return _fallback(candidate, base_youtube)

    prompt = json.dumps({
        "instruction": "You are a Japanese VTuber clip editor. Return JSON only with title, description, tags, pinned_comment, thumbnail_text, social_post.",
        "vod_title": vod_title,
        "streamer": streamer_name,
        "candidate": {
            "kind": candidate.get("kind"),
            "category": candidate.get("category"),
            "clip_start": candidate.get("clip_start"),
            "clip_end": candidate.get("clip_end"),
            "reasons": candidate.get("reasons"),
            "representative_comments": candidate.get("representative_comments"),
        },
        "fallback_metadata": base_youtube,
    }, ensure_ascii=False)

    try:
        if cfg["provider"] == "gemini":
            url = f'{cfg["endpoint"]}/models/{cfg["model"]}:generateContent?key={cfg["api_key"]}'
            payload = {
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {"temperature": 0.4, "maxOutputTokens": 1200, "responseMimeType": "application/json"},
            }
            req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers={"Content-Type": "application/json"})
            raw = json.loads(urllib.request.urlopen(req, timeout=45).read().decode("utf-8"))
            text = raw.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "")
        else:
            payload = {
                "model": cfg["model"],
                "messages": [
                    {"role": "system", "content": "Return JSON only."},
                    {"role": "user", "content": prompt},
                ],
                "temperature": 0.4,
                "max_tokens": 1200,
                "response_format": {"type": "json_object"} if cfg["provider"] == "openai" else None,
            }
            req = urllib.request.Request(
                cfg["endpoint"],
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json", "Authorization": f'Bearer {cfg["api_key"]}'},
            )
            raw = json.loads(urllib.request.urlopen(req, timeout=45).read().decode("utf-8"))
            text = raw.get("choices", [{}])[0].get("message", {}).get("content", "")
        parsed = json.loads(text[text.find("{"): text.rfind("}") + 1])
        return {
            "title": str(parsed.get("title") or base_youtube.get("title") or "配信ハイライト")[:100],
            "description": str(parsed.get("description") or base_youtube.get("description") or ""),
            "tags": list(parsed.get("tags") or base_youtube.get("tags") or [])[:30],
            "pinned_comment": str(parsed.get("pinned_comment") or "どの場面が一番好きでしたか？")[:300],
            "thumbnail_text": list(parsed.get("thumbnail_text") or [])[:5],
            "social_post": str(parsed.get("social_post") or parsed.get("title") or base_youtube.get("title") or "")[:280],
            "provider": f'{cfg["provider"]}/{cfg["model"]}',
        }
    except (Exception, urllib.error.URLError):
        return _fallback(candidate, base_youtube)
