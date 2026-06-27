export type CandidateStatus = "selected" | "pending" | "rejected";

export type TranscriptSegment = {
  start: string;
  end: string;
  speaker: string;
  text: string;
  highlight?: boolean;
};

export type ClipTranscriptOutput = {
  jsonPath: string;
  srtPath: string;
  txtPath: string;
};

export type ClipTranscription = {
  engine: string;
  model: string;
  device: string;
  computeType: string;
  language: string | null;
  durationSeconds: number | null;
  text: string;
  segments: TranscriptSegment[];
  srt: string;
  txt: string;
  outputs: ClipTranscriptOutput;
  createdAt: string;
};

export type GeneratedClipReference = {
  inputPath: string;
  outputPath: string;
  absoluteOutputPath: string;
  start: string;
  duration: string;
  mode: "copy" | "reencode";
  commandPreview: string;
};

export type CommentBurnedClipReference = {
  candidateId: string;
  variantId?: string;
  inputClipPath: string;
  assPath: string;
  outputPath: string;
  absoluteOutputPath: string;
  commandPreview: string;
  createdAt: string;
};

export type CommentAssetReference = {
  candidateId: string;
  jsonPath: string;
  assPath: string;
  jsonFileName: string;
  assFileName: string;
  createdAt: string;
};

export type ExportPackageAssetReference = {
  label: string;
  kind: "video" | "transcript" | "comments" | "thumbnail";
  fileName: string;
  packagePath: string;
  sourcePath?: string;
  sizeBytes: number;
};

export type ExportPackageReference = {
  candidateId: string;
  packagePath: string;
  absolutePackagePath: string;
  metadataPath: string;
  notesPath: string;
  copiedAssets: ExportPackageAssetReference[];
  createdAt: string;
};

export type ThumbnailCandidateReference = {
  candidateId: string;
  sourceClipPath: string;
  timestamp: string;
  outputPath: string;
  absoluteOutputPath: string;
  commandPreview: string;
  createdAt: string;
};

export type RepresentativeComment = {
  time: string;
  author: string;
  text: string;
  intensity: "low" | "medium" | "high";
};

export type DetectionReason = {
  label: string;
  detail: string;
  score: number;
};

export type CandidateWarning = {
  label: string;
  detail: string;
  severity: "low" | "medium" | "high";
};

export type ClipCandidateMarker = {
  id: string;
  time: string;
  label: string;
  kind: "setup" | "funny" | "peak" | "ending" | "note";
};

export type ClipCandidateVariant = {
  id: string;
  label: string;
  start: string;
  end: string;
  duration: string;
  description: string;
  tradeoff: string;
  recommended?: boolean;
};

export type ClipCandidateNotes = {
  editPlan: string;
  titleIdea: string;
  thumbnailIdea: string;
  uploadText: string;
};

export type ClipCandidate = {
  id: string;
  title: string;
  streamer: string;
  archiveTitle: string;
  detectedAt: string;
  duration: string;
  confidence: number;
  status: CandidateStatus;
  summary: string;
  whyDetected: string[];
  tags: string[];
  chat: {
    messages: number;
    peakPerMinute: number;
    topPhrases: string[];
    sentiment: string;
  };
  peak: {
    offset: string;
    label: string;
    intensity: number;
    sparkline: number[];
  };
  transcript: string[];
  transcriptSegments: TranscriptSegment[];
  generatedClip?: GeneratedClipReference;
  commentAssets?: CommentAssetReference;
  commentBurnedClip?: CommentBurnedClipReference;
  exportPackage?: ExportPackageReference;
  thumbnailCandidates?: ThumbnailCandidateReference[];
  transcription?: ClipTranscription;
  representativeComments: RepresentativeComment[];
  detectionReasons: DetectionReason[];
  warnings: CandidateWarning[];
  notes: ClipCandidateNotes;
  markers: ClipCandidateMarker[];
  variants: ClipCandidateVariant[];
  selectedVariantId: string;
  visualTone: string;
};

export const statusLabels: Record<CandidateStatus, string> = {
  selected: "Selected",
  pending: "Pending",
  rejected: "Rejected"
};

export const mockCandidates: ClipCandidate[] = [
  {
    id: "c01",
    title: "Boss fight panic turns into perfect clutch",
    streamer: "Mika Hoshino",
    archiveTitle: "Elden Ring DLC endurance stream",
    detectedAt: "01:18:42",
    duration: "02:34",
    confidence: 94,
    status: "pending",
    summary:
      "Mika nearly loses the run, screams through a last-second dodge, then lands the final hit while chat floods the screen.",
    whyDetected: ["Chat velocity spiked 4.8x", "Repeated emotes", "Streamer volume peak"],
    tags: ["clutch", "gaming", "panic"],
    chat: {
      messages: 1382,
      peakPerMinute: 642,
      topPhrases: ["NO WAY", "CLUTCH", "SHE DID IT"],
      sentiment: "Hype shock"
    },
    peak: {
      offset: "01:41",
      label: "Final hit lands",
      intensity: 98,
      sparkline: [18, 24, 28, 35, 46, 72, 93, 98, 84, 58, 40, 32]
    },
    transcript: [
      "Wait, wait, I have no heals. I have no heals!",
      "If I dodge this, we win. Please. Please.",
      "I did it? I DID IT!"
    ],
    transcriptSegments: [
      { start: "00:08", end: "00:18", speaker: "Mika", text: "Wait, wait, I have no heals. I have no heals!" },
      { start: "00:44", end: "00:58", speaker: "Mika", text: "Chat, stop typing panic. I can feel the panic through the screen." },
      { start: "01:29", end: "01:43", speaker: "Mika", text: "If I dodge this, we win. Please. Please.", highlight: true },
      { start: "01:43", end: "01:52", speaker: "Mika", text: "I did it? I DID IT!", highlight: true }
    ],
    representativeComments: [
      { time: "01:28", author: "chat", text: "NO HEALS RUN", intensity: "medium" },
      { time: "01:39", author: "chat", text: "NO WAY NO WAY", intensity: "high" },
      { time: "01:44", author: "chat", text: "CLUTCH QUEEN", intensity: "high" },
      { time: "01:50", author: "chat", text: "clip this right now", intensity: "medium" }
    ],
    detectionReasons: [
      { label: "Chat velocity", detail: "Messages rose from 134/min to 642/min during the final exchange.", score: 98 },
      { label: "Audio reaction", detail: "Streamer volume peaked at the dodge and again at the victory scream.", score: 93 },
      { label: "Repeated phrases", detail: "NO WAY, CLUTCH, and SHE DID IT repeated across multiple users.", score: 91 }
    ],
    warnings: [
      { label: "Audio spike", detail: "Victory scream may need light compression before export.", severity: "medium" },
      { label: "Context check", detail: "Include at least 20 seconds before the final dodge so the no-heal setup is clear.", severity: "low" }
    ],
    notes: {
      editPlan: "Open with the no-heals panic, cut tightly to final dodge, then hold on chat flood.",
      titleIdea: "VTuber wins impossible boss fight with no heals left",
      thumbnailIdea: "Mika shocked face, boss HP at 1%, big CLUTCH text.",
      uploadText: "Include the no-heal setup and final-hit payoff. Mention this is a mock candidate review."
    },
    markers: [
      { id: "c01-m1", time: "00:08", label: "No-heals setup", kind: "setup" },
      { id: "c01-m2", time: "01:29", label: "Final dodge attempt", kind: "peak" },
      { id: "c01-m3", time: "01:43", label: "Victory scream", kind: "ending" }
    ],
    variants: [
      { id: "c01-short", label: "Short punch", start: "01:18", end: "02:00", duration: "00:42", description: "Fast version focused only on the final dodge and victory.", tradeoff: "High impact, but loses the no-heal setup." },
      { id: "c01-standard", label: "Standard clip", start: "00:08", end: "02:00", duration: "01:52", description: "Keeps the no-heal setup, final dodge, and chat explosion.", tradeoff: "Best balance for context and pace.", recommended: true },
      { id: "c01-context", label: "Context cut", start: "00:00", end: "02:28", duration: "02:28", description: "Longer build-up for viewers who did not watch the stream.", tradeoff: "Safer context, slower opening." }
    ],
    selectedVariantId: "c01-standard",
    visualTone: "from-cyan-400/30 via-blue-500/20 to-violet-500/30"
  },
  {
    id: "c02",
    title: "Accidental lore reveal during superchat reading",
    streamer: "Rin Kagami",
    archiveTitle: "Late night zatsu and marshmallow Q&A",
    detectedAt: "00:47:10",
    duration: "01:48",
    confidence: 87,
    status: "selected",
    summary:
      "A casual answer turns into an unexpected character backstory hint, and chat immediately starts connecting old references.",
    whyDetected: ["Keyword cluster: lore", "Clip requests detected", "Sustained chat density"],
    tags: ["lore", "zatsu", "community"],
    chat: {
      messages: 904,
      peakPerMinute: 388,
      topPhrases: ["LORE", "WRITE THAT DOWN", "WAIT"],
      sentiment: "Curious chaos"
    },
    peak: {
      offset: "00:56",
      label: "Backstory hint",
      intensity: 89,
      sparkline: [22, 24, 28, 36, 52, 68, 82, 89, 86, 79, 70, 61]
    },
    transcript: [
      "I probably should not say this yet, but she was not always alone.",
      "No, no, do not clip that. I mean, you can clip it, but pretend you did not hear it.",
      "Chat is moving too fast. Stop investigating!"
    ],
    transcriptSegments: [
      { start: "00:11", end: "00:23", speaker: "Rin", text: "This question is dangerous because the answer is technically spoilers." },
      { start: "00:40", end: "00:54", speaker: "Rin", text: "I probably should not say this yet, but she was not always alone.", highlight: true },
      { start: "00:58", end: "01:11", speaker: "Rin", text: "No, no, do not clip that. I mean, you can clip it, but pretend you did not hear it.", highlight: true },
      { start: "01:20", end: "01:32", speaker: "Rin", text: "Chat is moving too fast. Stop investigating!" }
    ],
    representativeComments: [
      { time: "00:43", author: "chat", text: "LORE????", intensity: "high" },
      { time: "00:49", author: "chat", text: "WRITE THAT DOWN", intensity: "high" },
      { time: "01:02", author: "chat", text: "too late we clipped it", intensity: "medium" },
      { time: "01:28", author: "chat", text: "timeline detectives assemble", intensity: "medium" }
    ],
    detectionReasons: [
      { label: "Lore keyword cluster", detail: "Lore, backstory, timeline, and spoiler appeared together within 60 seconds.", score: 92 },
      { label: "Clip requests", detail: "Multiple users explicitly asked for the scene to be clipped.", score: 86 },
      { label: "Sustained density", detail: "Chat stayed elevated after the reveal instead of dropping immediately.", score: 83 }
    ],
    warnings: [
      { label: "Spoiler sensitivity", detail: "May reveal planned character lore. Confirm with channel guidelines before publishing.", severity: "high" }
    ],
    notes: {
      editPlan: "Keep the accidental reveal and immediate backpedal. Avoid overcutting the awkward pause.",
      titleIdea: "Rin accidentally drops hidden lore on stream",
      thumbnailIdea: "Rin panic expression with LORE? and blurred timeline notes.",
      uploadText: "Flag potential lore spoilers and keep wording playful rather than accusatory."
    },
    markers: [
      { id: "c02-m1", time: "00:11", label: "Spoiler warning setup", kind: "setup" },
      { id: "c02-m2", time: "00:40", label: "Backstory hint", kind: "peak" },
      { id: "c02-m3", time: "00:58", label: "Do not clip that", kind: "funny" }
    ],
    variants: [
      { id: "c02-short", label: "Reveal only", start: "00:34", end: "01:12", duration: "00:38", description: "Starts immediately before the backstory hint.", tradeoff: "Very shareable but may feel abrupt." },
      { id: "c02-standard", label: "Standard clip", start: "00:08", end: "01:35", duration: "01:27", description: "Includes the question, reveal, backpedal, and chat investigation.", tradeoff: "Best context for lore fans.", recommended: true },
      { id: "c02-context", label: "Full Q&A beat", start: "00:00", end: "01:48", duration: "01:48", description: "Full candidate window for archival context.", tradeoff: "Slower, but safest for context." }
    ],
    selectedVariantId: "c02-standard",
    visualTone: "from-fuchsia-400/30 via-purple-500/20 to-indigo-500/30"
  },
  {
    id: "c03",
    title: "Chat baits a perfectly timed jump scare",
    streamer: "Aoi Lunar",
    archiveTitle: "First horror game in six months",
    detectedAt: "02:06:33",
    duration: "02:06",
    confidence: 91,
    status: "pending",
    summary:
      "Chat insists the hallway is safe seconds before a jump scare hits. Aoi's reaction turns into a long laugh spiral.",
    whyDetected: ["Reaction audio peak", "Laughter burst", "Chat phrase reversal"],
    tags: ["horror", "reaction", "funny"],
    chat: {
      messages: 1127,
      peakPerMinute: 512,
      topPhrases: ["SAFE", "SORRY", "LMAO"],
      sentiment: "Mischievous"
    },
    peak: {
      offset: "00:39",
      label: "Jump scare",
      intensity: 95,
      sparkline: [16, 18, 20, 21, 26, 31, 95, 90, 74, 62, 54, 48]
    },
    transcript: [
      "You promise? You promise nothing happens here?",
      "Why did I trust you? Why did I trust any of you?",
      "I am laughing, but my soul left five seconds ago."
    ],
    transcriptSegments: [
      { start: "00:06", end: "00:19", speaker: "Aoi", text: "You promise? You promise nothing happens here?" },
      { start: "00:33", end: "00:43", speaker: "Aoi", text: "Okay, hallway is safe. I believe you.", highlight: true },
      { start: "00:43", end: "00:58", speaker: "Aoi", text: "Why did I trust you? Why did I trust any of you?", highlight: true },
      { start: "01:14", end: "01:29", speaker: "Aoi", text: "I am laughing, but my soul left five seconds ago." }
    ],
    representativeComments: [
      { time: "00:22", author: "chat", text: "safe hallway :)", intensity: "medium" },
      { time: "00:39", author: "chat", text: "SAFE SAFE SAFE", intensity: "high" },
      { time: "00:45", author: "chat", text: "SORRYYYY", intensity: "high" },
      { time: "01:07", author: "chat", text: "her soul buffered", intensity: "medium" }
    ],
    detectionReasons: [
      { label: "Reaction audio", detail: "Sharp scream peak followed by sustained laughter and voice tremble.", score: 97 },
      { label: "Phrase reversal", detail: "Safe hallway messages flipped into apology spam immediately after scare.", score: 91 },
      { label: "Clip commands", detail: "Several users sent clip and timestamp requests in the next minute.", score: 85 }
    ],
    warnings: [
      { label: "Loud scare", detail: "Jump scare and scream may need a headphone warning or audio normalization.", severity: "medium" },
      { label: "Setup timing", detail: "Do not start too close to the scare; the chat bait is the joke.", severity: "low" }
    ],
    notes: {
      editPlan: "Preserve chat bait before the scare. Cut after laughter settles, not immediately after scream.",
      titleIdea: "Chat promises the hallway is safe. It was not.",
      thumbnailIdea: "Aoi frozen mid-scream with SAFE? stamped over dark hallway.",
      uploadText: "Add headphone warning if using the raw scream peak."
    },
    markers: [
      { id: "c03-m1", time: "00:06", label: "Chat promises safety", kind: "setup" },
      { id: "c03-m2", time: "00:39", label: "Jump scare hit", kind: "peak" },
      { id: "c03-m3", time: "01:14", label: "Soul left body line", kind: "funny" }
    ],
    variants: [
      { id: "c03-short", label: "Jump scare short", start: "00:27", end: "01:03", duration: "00:36", description: "Quick setup into scare and apology spam.", tradeoff: "Punchy, but chat bait has less time to breathe." },
      { id: "c03-standard", label: "Standard clip", start: "00:02", end: "01:34", duration: "01:32", description: "Keeps promise, scare, distrust, and laugh spiral.", tradeoff: "Best comedic structure.", recommended: true },
      { id: "c03-context", label: "Horror segment", start: "00:00", end: "02:06", duration: "02:06", description: "Full candidate window with recovery banter.", tradeoff: "Longer ending may dilute the punchline." }
    ],
    selectedVariantId: "c03-standard",
    visualTone: "from-rose-400/30 via-red-500/20 to-orange-500/30"
  },
  {
    id: "c04",
    title: "Unexpected duet with a viewer's piano cover",
    streamer: "Noa Prism",
    archiveTitle: "Karaoke request night",
    detectedAt: "01:35:08",
    duration: "03:12",
    confidence: 82,
    status: "pending",
    summary:
      "Noa notices a viewer's piano arrangement and sings over it live, creating a quiet emotional moment.",
    whyDetected: ["Positive sentiment climb", "Donation messages", "Long retention window"],
    tags: ["karaoke", "wholesome", "music"],
    chat: {
      messages: 731,
      peakPerMinute: 244,
      topPhrases: ["BEAUTIFUL", "CRYING", "THANK YOU"],
      sentiment: "Warm awe"
    },
    peak: {
      offset: "02:18",
      label: "High note resolves",
      intensity: 84,
      sparkline: [20, 24, 31, 38, 44, 51, 58, 63, 71, 84, 78, 70]
    },
    transcript: [
      "This arrangement is yours? It is so gentle.",
      "Can I try singing with it once? Just once.",
      "Thank you for letting me borrow your sound."
    ],
    transcriptSegments: [
      { start: "00:18", end: "00:30", speaker: "Noa", text: "This arrangement is yours? It is so gentle." },
      { start: "00:45", end: "00:56", speaker: "Noa", text: "Can I try singing with it once? Just once.", highlight: true },
      { start: "01:42", end: "02:20", speaker: "Noa", text: "Soft chorus over the viewer piano cover.", highlight: true },
      { start: "02:38", end: "02:51", speaker: "Noa", text: "Thank you for letting me borrow your sound." }
    ],
    representativeComments: [
      { time: "00:49", author: "chat", text: "permission granted", intensity: "medium" },
      { time: "01:54", author: "chat", text: "BEAUTIFUL", intensity: "high" },
      { time: "02:17", author: "chat", text: "crying at 3am", intensity: "high" },
      { time: "02:44", author: "chat", text: "thank you pianist", intensity: "medium" }
    ],
    detectionReasons: [
      { label: "Positive sentiment", detail: "Thank-you messages and emotional comments climbed across the whole song section.", score: 87 },
      { label: "Donation messages", detail: "Small donations arrived during and immediately after the high note.", score: 78 },
      { label: "Retention signal", detail: "Long quiet moment held chat attention instead of dropping activity.", score: 81 }
    ],
    warnings: [
      { label: "Music rights", detail: "Confirm viewer arrangement permission before using in a public clip.", severity: "high" },
      { label: "Pacing", detail: "This works as a slower emotional short, not a fast punchline clip.", severity: "low" }
    ],
    notes: {
      editPlan: "Let the song breathe. Avoid meme pacing and keep the thank-you line after the high note.",
      titleIdea: "Noa sings with a viewer's piano cover live",
      thumbnailIdea: "Soft stage lighting, piano keys, and small THANK YOU caption.",
      uploadText: "Credit the viewer arrangement if permission is confirmed."
    },
    markers: [
      { id: "c04-m1", time: "00:18", label: "Viewer arrangement noticed", kind: "setup" },
      { id: "c04-m2", time: "01:42", label: "Duet section begins", kind: "peak" },
      { id: "c04-m3", time: "02:38", label: "Thank-you line", kind: "ending" }
    ],
    variants: [
      { id: "c04-short", label: "Emotional beat", start: "01:32", end: "02:55", duration: "01:23", description: "Focuses on the duet and thank-you payoff.", tradeoff: "Misses how spontaneous the moment was." },
      { id: "c04-standard", label: "Standard clip", start: "00:14", end: "02:58", duration: "02:44", description: "Includes discovery, request for permission, duet, and gratitude.", tradeoff: "Best emotional arc.", recommended: true },
      { id: "c04-context", label: "Full song moment", start: "00:00", end: "03:12", duration: "03:12", description: "Full candidate length for a slower music-focused edit.", tradeoff: "May be too long for quick highlight feeds." }
    ],
    selectedVariantId: "c04-standard",
    visualTone: "from-amber-300/30 via-pink-400/20 to-purple-500/30"
  },
  {
    id: "c05",
    title: "Three-minute tangent about convenience store soup",
    streamer: "Kuro Natsume",
    archiveTitle: "Morning work-along stream",
    detectedAt: "00:22:54",
    duration: "03:04",
    confidence: 58,
    status: "rejected",
    summary:
      "A cozy but low-stakes tangent about soup preferences gets moderate chat activity without a clear punchline.",
    whyDetected: ["Topic repetition", "Small chat rise", "Food keyword cluster"],
    tags: ["zatsu", "food", "low-priority"],
    chat: {
      messages: 286,
      peakPerMinute: 118,
      topPhrases: ["SOUP", "MISO", "BASED"],
      sentiment: "Cozy"
    },
    peak: {
      offset: "01:26",
      label: "Miso ranking",
      intensity: 56,
      sparkline: [18, 23, 26, 31, 45, 56, 52, 47, 42, 35, 29, 24]
    },
    transcript: [
      "You can judge a store by the soup shelf. This is science.",
      "Corn soup is not a meal, but emotionally it is a blanket.",
      "Maybe this is not clip-worthy. I understand."
    ],
    transcriptSegments: [
      { start: "00:22", end: "00:36", speaker: "Kuro", text: "You can judge a store by the soup shelf. This is science." },
      { start: "01:05", end: "01:18", speaker: "Kuro", text: "Corn soup is not a meal, but emotionally it is a blanket." },
      { start: "01:34", end: "01:51", speaker: "Kuro", text: "Miso is dependable. Corn is comfort. Clam chowder is ambition.", highlight: true },
      { start: "02:22", end: "02:34", speaker: "Kuro", text: "Maybe this is not clip-worthy. I understand." }
    ],
    representativeComments: [
      { time: "00:31", author: "chat", text: "soup tier list arc", intensity: "medium" },
      { time: "01:08", author: "chat", text: "emotionally a blanket", intensity: "medium" },
      { time: "01:39", author: "chat", text: "clam chowder catching strays", intensity: "low" },
      { time: "02:30", author: "chat", text: "cozy not clip", intensity: "low" }
    ],
    detectionReasons: [
      { label: "Topic repetition", detail: "Food terms repeated heavily for several minutes.", score: 62 },
      { label: "Small chat rise", detail: "Chat rose modestly but did not produce a sharp peak.", score: 52 },
      { label: "Quote candidate", detail: "One line about corn soup got repeated by chat.", score: 57 }
    ],
    warnings: [
      { label: "Weak payoff", detail: "Cozy discussion has no strong turn, reveal, or reaction beat.", severity: "medium" },
      { label: "Low score", detail: "Confidence is below the default review threshold.", severity: "low" }
    ],
    notes: {
      editPlan: "Probably reject unless making a cozy compilation. If used, isolate the corn soup line.",
      titleIdea: "Kuro explains why soup is emotionally a blanket",
      thumbnailIdea: "Convenience store soup shelf with cozy blanket doodle.",
      uploadText: "Low-priority candidate for compilation use only."
    },
    markers: [
      { id: "c05-m1", time: "00:22", label: "Soup shelf thesis", kind: "setup" },
      { id: "c05-m2", time: "01:05", label: "Corn soup quote", kind: "funny" },
      { id: "c05-m3", time: "02:22", label: "Self-aware ending", kind: "ending" }
    ],
    variants: [
      { id: "c05-short", label: "Quote only", start: "00:58", end: "01:22", duration: "00:24", description: "Only preserves the corn soup blanket line.", tradeoff: "Best if this is used at all.", recommended: true },
      { id: "c05-standard", label: "Standard clip", start: "00:18", end: "02:36", duration: "02:18", description: "Keeps the full soup ranking tangent.", tradeoff: "Very low payoff." },
      { id: "c05-context", label: "Cozy segment", start: "00:00", end: "03:04", duration: "03:04", description: "Full tangent for a relaxed compilation.", tradeoff: "Too slow for a standalone clip." }
    ],
    selectedVariantId: "c05-short",
    visualTone: "from-emerald-400/20 via-lime-500/10 to-yellow-500/20"
  },
  {
    id: "c06",
    title: "Translator notes become the actual joke",
    streamer: "Sera Byte",
    archiveTitle: "Indie mystery game finale",
    detectedAt: "03:14:19",
    duration: "02:22",
    confidence: 78,
    status: "pending",
    summary:
      "An awkward machine-translated line derails the finale for a minute, then Sera improvises a running bit from it.",
    whyDetected: ["Laughter density", "Repeated quote", "Chat clipping commands"],
    tags: ["comedy", "translation", "gaming"],
    chat: {
      messages: 612,
      peakPerMinute: 301,
      topPhrases: ["THE FISH KNOWS", "CLIP", "WHAT"],
      sentiment: "Absurd"
    },
    peak: {
      offset: "01:03",
      label: "Quote lands",
      intensity: 80,
      sparkline: [12, 18, 24, 37, 48, 65, 80, 74, 69, 59, 43, 35]
    },
    transcript: [
      "The fish knows my taxes? That cannot be right.",
      "Wait, maybe the fish does know. Should I be afraid?",
      "Final boss is accounting. This game is too real."
    ],
    transcriptSegments: [
      { start: "00:21", end: "00:34", speaker: "Sera", text: "The fish knows my taxes? That cannot be right.", highlight: true },
      { start: "00:47", end: "01:00", speaker: "Sera", text: "Wait, maybe the fish does know. Should I be afraid?" },
      { start: "01:03", end: "01:17", speaker: "Sera", text: "Final boss is accounting. This game is too real.", highlight: true },
      { start: "01:41", end: "01:55", speaker: "Sera", text: "I cannot emotionally recover from tax fish lore." }
    ],
    representativeComments: [
      { time: "00:25", author: "chat", text: "THE FISH KNOWS", intensity: "high" },
      { time: "00:51", author: "chat", text: "tax fish canon", intensity: "medium" },
      { time: "01:06", author: "chat", text: "accounting boss phase", intensity: "high" },
      { time: "01:33", author: "chat", text: "clip the fish", intensity: "medium" }
    ],
    detectionReasons: [
      { label: "Laughter density", detail: "Streamer laughter and chat laughter overlapped for 50 seconds.", score: 83 },
      { label: "Repeated quote", detail: "THE FISH KNOWS repeated more than any other phrase in the archive hour.", score: 81 },
      { label: "Clip commands", detail: "Clip requests appeared around the improvised accounting line.", score: 75 }
    ],
    warnings: [
      { label: "Translation context", detail: "Clip needs the mistranslated line visible or explained for the joke to land.", severity: "medium" }
    ],
    notes: {
      editPlan: "Open on the bad translation text, then let Sera escalate the tax fish bit.",
      titleIdea: "The fish knows her taxes and she cannot recover",
      thumbnailIdea: "Mystery fish, tax form, and Sera confused expression.",
      uploadText: "Needs clear subtitles or the mistranslated line will not land."
    },
    markers: [
      { id: "c06-m1", time: "00:21", label: "Bad translation appears", kind: "setup" },
      { id: "c06-m2", time: "01:03", label: "Accounting boss joke", kind: "peak" },
      { id: "c06-m3", time: "01:41", label: "Tax fish lore tag", kind: "ending" }
    ],
    variants: [
      { id: "c06-short", label: "Quote short", start: "00:18", end: "01:18", duration: "01:00", description: "Bad translation into accounting boss punchline.", tradeoff: "Clean and fast, but loses recovery banter.", recommended: true },
      { id: "c06-standard", label: "Standard clip", start: "00:16", end: "01:56", duration: "01:40", description: "Includes setup, repeated quote, punchline, and final tag.", tradeoff: "Best for subtitles." },
      { id: "c06-context", label: "Full bit", start: "00:00", end: "02:22", duration: "02:22", description: "Full translation derail sequence.", tradeoff: "Longer than needed for the joke." }
    ],
    selectedVariantId: "c06-short",
    visualTone: "from-sky-400/30 via-teal-500/20 to-emerald-400/20"
  }
];
