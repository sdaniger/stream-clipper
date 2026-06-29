"use client";

import React, { useRef, useEffect } from "react";
import TwitchVodPlayer, { type TwitchVodPlayerHandle } from "./TwitchVodPlayer";
import LocalVideoPlayer, { type LocalVideoPlayerHandle } from "./LocalVideoPlayer";
import TimelineGraph from "./TimelineGraph";
import ClipActionPanel from "./ClipActionPanel";
import { useI18n } from "@/lib/i18n";
import type { HighlightCandidate } from "@/lib/twitch-time";
import type { TimelineRow } from "@/lib/studio-api";

interface Props {
  mode: "twitch" | "local";
  videoId: string | null;
  videoPath: string;
  vodTitle: string | null;

  // Player state
  playerStartTime: number;
  playerReloadKey: number;
  currentTime: number;
  videoDuration: number;

  // Player refs
  twitchPlayerRef: React.MutableRefObject<TwitchVodPlayerHandle | null>;
  localPlayerRef: React.MutableRefObject<LocalVideoPlayerHandle | null>;

  // Timeline + selected candidate
  timeline: TimelineRow[];
  selectedCandidate: HighlightCandidate | null;

  // Callbacks
  onTimeUpdate: (time: number) => void;
  onDurationChange: (duration: number) => void;
  onSeek: (time: number) => void;
  onJumpStart: () => void;
  onJumpPeak: () => void;
  onJumpEnd: () => void;
  onPreview: () => void;
  onSetStartFromCurrent: () => void;
  onSetEndFromCurrent: () => void;
  onSelectCandidate: (c: HighlightCandidate) => void;
}

export default function VideoArea({
  mode,
  videoId,
  videoPath,
  vodTitle,
  playerStartTime,
  playerReloadKey,
  currentTime,
  videoDuration,
  twitchPlayerRef,
  localPlayerRef,
  timeline,
  selectedCandidate,
  onTimeUpdate,
  onDurationChange,
  onSeek,
  onJumpStart,
  onJumpPeak,
  onJumpEnd,
  onPreview,
  onSetStartFromCurrent,
  onSetEndFromCurrent,
  onSelectCandidate,
}: Props) {
  const { t } = useI18n();

  const hasVideo = (mode === "twitch" && !!videoId) || (mode === "local" && !!videoPath.trim());
  const canEditRange = !!selectedCandidate && hasVideo;

  return (
    <div className="glass-panel rounded-lg overflow-hidden">
      {/* Video player */}
      {hasVideo ? (
        <div>
          {mode === "twitch" && videoId ? (
            <TwitchVodPlayer
              ref={twitchPlayerRef}
              videoId={videoId}
              startTimeSeconds={playerStartTime}
              reloadKey={playerReloadKey}
              onTimeUpdate={onTimeUpdate}
            />
          ) : mode === "local" && videoPath.trim() ? (
            <LocalVideoPlayer
              ref={localPlayerRef}
              videoPath={videoPath}
              startTimeSeconds={playerStartTime}
              onTimeUpdate={onTimeUpdate}
              onDurationChange={onDurationChange}
            />
          ) : null}
        </div>
      ) : (
        <div className="aspect-video flex items-center justify-center text-sm text-slate-500 bg-slate-900/40">
          {t("studio.step1NoVodYet")}
        </div>
      )}

      {/* Timeline graph */}
      {timeline.length > 0 && (
        <TimelineGraph
          timeline={timeline}
          candidates={[] /* Don't render the candidate list inline — Step2CandidateList handles that */}
          selectedCandidate={selectedCandidate}
          currentTime={currentTime}
          duration={videoDuration}
          maxTime={0}
          onSeek={onSeek}
          onSelectCandidate={onSelectCandidate}
        />
      )}

      {/* Clip action panel (range adjustment) */}
      {selectedCandidate && (
        <ClipActionPanel
          candidate={selectedCandidate}
          hasLocalVideo={mode === "local" && !!videoPath.trim()}
          currentTime={currentTime}
          isPlayerAvailable={hasVideo}
          singleExportStatus="idle"
          batchExportStatus="idle"
          onJumpStart={onJumpStart}
          onJumpPeak={onJumpPeak}
          onJumpEnd={onJumpEnd}
          onPreviewRange={onPreview}
          onSetStartFromCurrent={onSetStartFromCurrent}
          onSetEndFromCurrent={onSetEndFromCurrent}
          onExportThisClip={() => {}}
          onExportTop5={() => {}}
          onSelectLocalVideo={() => {}}
          localVideoPath={mode === "local" ? videoPath : null}
        />
      )}
    </div>
  );
}
