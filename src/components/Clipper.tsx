import React, { useState, useRef, useCallback, useEffect } from "react";
import { useDropzone } from "react-dropzone";
import {
  Scissors,
  Download,
  Upload,
  Link as LinkIcon,
  Type as SubtitleIcon,
  Loader2,
  Play,
  Pause,
  CheckCircle,
  AlertCircle,
  Clock,
  Film,
  Wand2,
  X,
  RefreshCw,
} from "lucide-react";
import { generateSubtitles, downloadSRT, getActiveSubtitle, Subtitle } from "../services/geminiService";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ─── Types ───────────────────────────────────────────────────────────────────
type AspectRatio = "16:9" | "9:16" | "1:1";
type Tab = "upload" | "link";
type ProcessingState = "idle" | "downloading" | "analyzing" | "clipping" | "done" | "error";

// ─── Helper ───────────────────────────────────────────────────────────────────
function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, "0");
  const s = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ state, message }: { state: ProcessingState; message?: string }) {
  const configs: Record<ProcessingState, { color: string; label: string; icon: React.ReactNode }> = {
    idle: { color: "text-zinc-400", label: "Ready", icon: <div className="w-2 h-2 rounded-full bg-zinc-400" /> },
    downloading: { color: "text-amber-400", label: "Downloading...", icon: <Loader2 className="w-3 h-3 animate-spin" /> },
    analyzing: { color: "text-blue-400", label: "AI Analyzing...", icon: <Loader2 className="w-3 h-3 animate-spin" /> },
    clipping: { color: "text-purple-400", label: "Processing...", icon: <Loader2 className="w-3 h-3 animate-spin" /> },
    done: { color: "text-emerald-400", label: "Done", icon: <CheckCircle className="w-3 h-3" /> },
    error: { color: "text-red-400", label: "Error", icon: <AlertCircle className="w-3 h-3" /> },
  };
  const cfg = configs[state];
  return (
    <div className={cn("flex items-center gap-1.5 text-xs font-mono", cfg.color)}>
      {cfg.icon}
      <span>{message || cfg.label}</span>
    </div>
  );
}

function TimelineSlider({
  duration,
  startTime,
  clipDuration,
  currentTime,
  onStartChange,
  onDurationChange,
  onSeek,
}: {
  duration: number;
  startTime: number;
  clipDuration: number;
  currentTime: number;
  onStartChange: (v: number) => void;
  onDurationChange: (v: number) => void;
  onSeek: (v: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const isDraggingStart = useRef(false);
  const isDraggingEnd = useRef(false);
  const isDraggingPlayhead = useRef(false);

  const toPercent = (s: number) => Math.min(100, Math.max(0, (s / duration) * 100));
  const startPct = toPercent(startTime);
  const endPct = toPercent(startTime + clipDuration);
  const playPct = toPercent(currentTime);

  const getTimeFromEvent = (e: MouseEvent | React.MouseEvent) => {
    if (!trackRef.current) return 0;
    const rect = trackRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    return (x / rect.width) * duration;
  };

  const handleMouseDown = (type: "start" | "end" | "playhead") => (e: React.MouseEvent) => {
    e.preventDefault();
    if (type === "start") isDraggingStart.current = true;
    if (type === "end") isDraggingEnd.current = true;
    if (type === "playhead") isDraggingPlayhead.current = true;

    const onMove = (me: MouseEvent) => {
      const t = getTimeFromEvent(me);
      if (isDraggingStart.current) {
        const newStart = Math.max(0, Math.min(t, startTime + clipDuration - 1));
        const newDur = Math.max(1, startTime + clipDuration - newStart);
        onStartChange(newStart);
        onDurationChange(newDur);
      }
      if (isDraggingEnd.current) {
        const newEnd = Math.max(startTime + 1, Math.min(t, duration));
        onDurationChange(newEnd - startTime);
      }
      if (isDraggingPlayhead.current) {
        onSeek(Math.max(0, Math.min(t, duration)));
      }
    };
    const onUp = () => {
      isDraggingStart.current = false;
      isDraggingEnd.current = false;
      isDraggingPlayhead.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const handleTrackClick = (e: React.MouseEvent) => {
    if (isDraggingStart.current || isDraggingEnd.current || isDraggingPlayhead.current) return;
    const t = getTimeFromEvent(e);
    onSeek(t);
  };

  return (
    <div className="space-y-3">
      {/* Labels */}
      <div className="flex items-center justify-between text-[10px] font-mono text-zinc-500">
        <span>0:00</span>
        <span className="text-zinc-300">
          {formatTime(startTime)} → {formatTime(startTime + clipDuration)}{" "}
          <span className="text-zinc-500">({clipDuration.toFixed(1)}s)</span>
        </span>
        <span>{formatTime(duration)}</span>
      </div>

      {/* Track */}
      <div
        ref={trackRef}
        className="relative h-10 bg-zinc-800 rounded cursor-pointer select-none"
        onClick={handleTrackClick}
      >
        {/* Background waveform effect */}
        <div className="absolute inset-0 flex items-center gap-px px-1 opacity-20 pointer-events-none">
          {Array.from({ length: 80 }).map((_, i) => (
            <div
              key={i}
              className="flex-1 bg-zinc-400 rounded-full"
              style={{ height: `${20 + Math.sin(i * 0.7) * 15 + Math.random() * 15}%` }}
            />
          ))}
        </div>

        {/* Selected range highlight */}
        <div
          className="absolute top-0 bottom-0 bg-violet-500/30 border-t border-b border-violet-500"
          style={{ left: `${startPct}%`, width: `${endPct - startPct}%` }}
        />

        {/* Playhead */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-white z-20 cursor-ew-resize"
          style={{ left: `${playPct}%` }}
          onMouseDown={handleMouseDown("playhead")}
        >
          <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-3 h-3 bg-white rounded-full shadow" />
        </div>

        {/* Start handle */}
        <div
          className="absolute top-0 bottom-0 w-3 bg-violet-500 cursor-ew-resize z-10 flex items-center justify-center rounded-l"
          style={{ left: `${startPct}%`, transform: "translateX(-100%)" }}
          onMouseDown={handleMouseDown("start")}
        >
          <div className="w-0.5 h-4 bg-white/60 rounded" />
        </div>

        {/* End handle */}
        <div
          className="absolute top-0 bottom-0 w-3 bg-violet-500 cursor-ew-resize z-10 flex items-center justify-center rounded-r"
          style={{ left: `${endPct}%` }}
          onMouseDown={handleMouseDown("end")}
        >
          <div className="w-0.5 h-4 bg-white/60 rounded" />
        </div>
      </div>

      {/* Numeric inputs */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[10px] font-mono text-zinc-500 mb-1">START (sec)</label>
          <input
            type="number"
            value={startTime.toFixed(1)}
            step="0.5"
            min={0}
            max={duration - 1}
            onChange={(e) => {
              const v = parseFloat(e.target.value) || 0;
              onStartChange(Math.max(0, Math.min(v, duration - 1)));
            }}
            className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 text-zinc-100 font-mono text-sm rounded focus:outline-none focus:border-violet-500 transition-colors"
          />
        </div>
        <div>
          <label className="block text-[10px] font-mono text-zinc-500 mb-1">DURATION (sec)</label>
          <input
            type="number"
            value={clipDuration.toFixed(1)}
            step="0.5"
            min={1}
            max={Math.max(1, duration - startTime)}
            onChange={(e) => {
              const v = parseFloat(e.target.value) || 1;
              onDurationChange(Math.max(1, Math.min(v, duration - startTime)));
            }}
            className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 text-zinc-100 font-mono text-sm rounded focus:outline-none focus:border-violet-500 transition-colors"
          />
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function Clipper() {
  const [tab, setTab] = useState<Tab>("upload");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [serverFileId, setServerFileId] = useState<string | null>(null);
  const [linkUrl, setLinkUrl] = useState("");
  const [videoDuration, setVideoDuration] = useState(60);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [startTime, setStartTime] = useState(0);
  const [clipDuration, setClipDuration] = useState(15);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("16:9");
  const [subtitles, setSubtitles] = useState<Subtitle[]>([]);
  const [burnSubtitles, setBurnSubtitles] = useState(false);
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [processingState, setProcessingState] = useState<ProcessingState>("idle");
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const animFrameRef = useRef<number>();

  // Sync video playback time
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onTime = () => setCurrentTime(video.currentTime);
    const onPlay = () => {
      setIsPlaying(true);
      const tick = () => {
        setCurrentTime(video.currentTime);
        animFrameRef.current = requestAnimationFrame(tick);
      };
      animFrameRef.current = requestAnimationFrame(tick);
    };
    const onPause = () => {
      setIsPlaying(false);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
    const onLoaded = () => {
      setVideoDuration(video.duration || 60);
      setClipDuration(Math.min(15, video.duration || 15));
    };
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("loadedmetadata", onLoaded);
    return () => {
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("loadedmetadata", onLoaded);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [videoSrc]);

  const handleSeek = useCallback((t: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = t;
      setCurrentTime(t);
    }
  }, []);

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) videoRef.current.pause();
    else videoRef.current.play();
  };

  const setClipToCurrentTime = () => {
    setStartTime(Math.max(0, currentTime));
  };

  // Drop zone
  const onDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;
    if (file.size > 500 * 1024 * 1024) {
      setErrorMessage("File too large (max 500MB). Use a link instead.");
      return;
    }
    setVideoFile(file);
    if (videoSrc) URL.revokeObjectURL(videoSrc);
    setVideoSrc(URL.createObjectURL(file));
    setServerFileId(null);
    setOutputUrl(null);
    setSubtitles([]);
    setErrorMessage(null);
    setProcessingState("idle");
  }, [videoSrc]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "video/*": [] },
    multiple: false,
  } as any);

  // Download from URL
  const handleLinkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!linkUrl.trim()) return;

    setProcessingState("downloading");
    setStatusMessage("Downloading video...");
    setErrorMessage(null);

    try {
      const res = await fetch("/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: linkUrl }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Download failed" }));
        throw new Error(err.error || "Download failed");
      }

      const data = await res.json();
      const { fileId, duration, mimeType } = data;

      setServerFileId(fileId);
      setVideoFile(null);
      setVideoSrc(`/api/temp/${fileId}`);
      setVideoDuration(duration || 60);
      setClipDuration(Math.min(15, duration || 15));
      setOutputUrl(null);
      setSubtitles([]);
      setProcessingState("idle");
      setStatusMessage("");
    } catch (err: any) {
      setProcessingState("error");
      setErrorMessage(err.message || "Failed to download. Try uploading the file directly.");
    }
  };

  // Generate subtitles
  const handleGenerateSubtitles = async () => {
    if (!videoFile && !serverFileId) return;

    setProcessingState("analyzing");
    setStatusMessage("AI is transcribing video...");
    setErrorMessage(null);

    try {
      let subs: Subtitle[];
      if (videoFile) {
        subs = await generateSubtitles(videoFile);
      } else {
        // Pass a dummy File to satisfy type, server uses fileId
        const dummyFile = new File([], "video.mp4", { type: "video/mp4" });
        subs = await generateSubtitles(dummyFile, serverFileId!);
      }
      setSubtitles(subs);
      setProcessingState("idle");
      setStatusMessage(`${subs.length} subtitle segments generated`);
    } catch (err: any) {
      setProcessingState("error");
      setErrorMessage(err.message || "Failed to generate subtitles");
    }
  };

  // Clip video
  const handleClip = async () => {
    if (!videoFile && !serverFileId && !linkUrl) return;

    setProcessingState("clipping");
    setStatusMessage("FFmpeg is processing...");
    setErrorMessage(null);
    setOutputUrl(null);

    try {
      const formData = new FormData();

      if (videoFile) {
        formData.append("video", videoFile);
      } else if (serverFileId) {
        formData.append("fileId", serverFileId);
      } else {
        formData.append("videoUrl", linkUrl);
      }

      formData.append("startTime", startTime.toString());
      formData.append("duration", clipDuration.toString());
      formData.append("aspectRatio", aspectRatio);
      formData.append("burnSubtitles", burnSubtitles.toString());

      if (subtitles.length > 0) {
        formData.append("subtitles", JSON.stringify(subtitles));
      }

      const res = await fetch("/api/clip", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Processing failed" }));
        throw new Error(err.error || "Processing failed");
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setOutputUrl(url);
      setProcessingState("done");
      setStatusMessage("Clip ready!");
    } catch (err: any) {
      setProcessingState("error");
      setErrorMessage(err.message || "Processing failed. Please try again.");
    }
  };

  const hasVideo = !!videoSrc;
  const isWorking = ["downloading", "analyzing", "clipping"].includes(processingState);
  const activeSubtitle = getActiveSubtitle(subtitles, currentTime);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="border-b border-zinc-800/60 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-violet-600 flex items-center justify-center">
            <Scissors className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-zinc-100 tracking-tight">AutoClipper Pro</h1>
            <p className="text-[10px] font-mono text-zinc-500">v2.0 // Gemini-Powered</p>
          </div>
        </div>
        <StatusBadge state={processingState} message={statusMessage || undefined} />
      </header>

      <div className="flex h-[calc(100vh-57px)]">
        {/* ── Left Panel ──────────────────────────────────────────── */}
        <aside className="w-80 border-r border-zinc-800/60 flex flex-col overflow-y-auto">
          {/* Tab switcher */}
          <div className="flex border-b border-zinc-800/60">
            {(["upload", "link"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  "flex-1 py-3 text-xs font-mono uppercase tracking-widest transition-colors",
                  tab === t
                    ? "text-violet-400 border-b-2 border-violet-500"
                    : "text-zinc-500 hover:text-zinc-300"
                )}
              >
                {t === "upload" ? <><Upload className="w-3 h-3 inline mr-1" />Upload</> : <><LinkIcon className="w-3 h-3 inline mr-1" />Link</>}
              </button>
            ))}
          </div>

          <div className="p-4 space-y-4 flex-1">
            {/* Upload tab */}
            {tab === "upload" && (
              <div
                {...getRootProps()}
                className={cn(
                  "border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-all",
                  isDragActive
                    ? "border-violet-500 bg-violet-500/10"
                    : videoFile
                    ? "border-emerald-500/50 bg-emerald-500/5"
                    : "border-zinc-700 hover:border-zinc-500"
                )}
              >
                <input {...getInputProps()} />
                {videoFile ? (
                  <>
                    <CheckCircle className="w-8 h-8 text-emerald-500 mx-auto mb-3" />
                    <p className="text-xs font-mono text-emerald-400 break-all">{videoFile.name}</p>
                    <p className="text-[10px] text-zinc-500 mt-1">
                      {(videoFile.size / 1024 / 1024).toFixed(1)} MB
                    </p>
                  </>
                ) : (
                  <>
                    <Upload className="w-8 h-8 text-zinc-600 mx-auto mb-3" />
                    <p className="text-xs font-mono text-zinc-400">
                      {isDragActive ? "Drop it here" : "Drag & drop or click"}
                    </p>
                    <p className="text-[10px] text-zinc-600 mt-1">MP4, MOV, WebM, AVI — max 500MB</p>
                  </>
                )}
              </div>
            )}

            {/* Link tab */}
            {tab === "link" && (
              <form onSubmit={handleLinkSubmit} className="space-y-3">
                <div>
                  <label className="block text-[10px] font-mono text-zinc-500 mb-1.5">VIDEO URL</label>
                  <input
                    type="url"
                    value={linkUrl}
                    onChange={(e) => setLinkUrl(e.target.value)}
                    placeholder="https://example.com/video.mp4"
                    className="w-full px-3 py-2.5 bg-zinc-900 border border-zinc-700 text-zinc-100 font-mono text-xs rounded focus:outline-none focus:border-violet-500 transition-colors placeholder:text-zinc-600"
                  />
                  <p className="text-[10px] text-zinc-600 mt-1">Direct video URLs supported. YouTube may require manual upload due to restrictions.</p>
                </div>
                <button
                  type="submit"
                  disabled={isWorking || !linkUrl.trim()}
                  className="w-full py-2.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 font-mono text-xs uppercase rounded transition-all disabled:opacity-40 flex items-center justify-center gap-2"
                >
                  {processingState === "downloading" ? (
                    <><Loader2 className="w-3 h-3 animate-spin" /> Downloading...</>
                  ) : (
                    <><Download className="w-3 h-3" /> Fetch Video</>
                  )}
                </button>
              </form>
            )}

            {/* ── Clip Controls (shown when video is loaded) ── */}
            {hasVideo && (
              <>
                <div className="border-t border-zinc-800/60 pt-4 space-y-4">
                  <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">Aspect Ratio</p>
                  <div className="grid grid-cols-3 gap-2">
                    {(["16:9", "9:16", "1:1"] as AspectRatio[]).map((ratio) => (
                      <button
                        key={ratio}
                        onClick={() => setAspectRatio(ratio)}
                        className={cn(
                          "py-2 border font-mono text-[10px] uppercase rounded transition-all",
                          aspectRatio === ratio
                            ? "bg-violet-600 border-violet-500 text-white"
                            : "border-zinc-700 text-zinc-400 hover:border-zinc-500"
                        )}
                      >
                        {ratio}
                      </button>
                    ))}
                  </div>

                  {/* Aspect ratio preview indicator */}
                  <div className="flex justify-center">
                    <div
                      className="bg-zinc-800 border border-zinc-700 rounded flex items-center justify-center"
                      style={{
                        width: aspectRatio === "9:16" ? 36 : aspectRatio === "1:1" ? 56 : 80,
                        height: aspectRatio === "9:16" ? 64 : aspectRatio === "1:1" ? 56 : 45,
                      }}
                    >
                      <Film className="w-4 h-4 text-zinc-600" />
                    </div>
                  </div>
                </div>

                {/* AI Subtitles */}
                <div className="border-t border-zinc-800/60 pt-4 space-y-3">
                  <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">AI Subtitles</p>
                  <button
                    onClick={handleGenerateSubtitles}
                    disabled={isWorking}
                    className="w-full py-2.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-200 font-mono text-xs uppercase rounded transition-all disabled:opacity-40 flex items-center justify-center gap-2"
                  >
                    {processingState === "analyzing" ? (
                      <><Loader2 className="w-3 h-3 animate-spin" /> Analyzing...</>
                    ) : (
                      <><Wand2 className="w-3 h-3" /> Generate Subtitles</>
                    )}
                  </button>

                  {subtitles.length > 0 && (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-mono text-emerald-400">
                          ✓ {subtitles.length} segments
                        </span>
                        <div className="flex gap-2">
                          <button
                            onClick={() => downloadSRT(subtitles)}
                            className="text-[10px] font-mono text-zinc-400 hover:text-zinc-200 underline"
                          >
                            .srt
                          </button>
                          <button
                            onClick={() => setSubtitles([])}
                            className="text-[10px] font-mono text-zinc-600 hover:text-red-400"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      </div>

                      <label className="flex items-center gap-2 cursor-pointer group">
                        <div
                          onClick={() => setBurnSubtitles(!burnSubtitles)}
                          className={cn(
                            "w-9 h-5 rounded-full transition-colors relative",
                            burnSubtitles ? "bg-violet-600" : "bg-zinc-700"
                          )}
                        >
                          <div
                            className={cn(
                              "absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform",
                              burnSubtitles ? "translate-x-4" : "translate-x-0.5"
                            )}
                          />
                        </div>
                        <span className="text-[10px] font-mono text-zinc-400 group-hover:text-zinc-200">
                          Burn into video
                        </span>
                      </label>

                      {/* Subtitle list */}
                      <div className="max-h-32 overflow-y-auto space-y-1 rounded border border-zinc-800 p-2">
                        {subtitles.map((sub, i) => (
                          <div
                            key={i}
                            onClick={() => handleSeek(sub.start)}
                            className="flex gap-2 text-[10px] font-mono cursor-pointer hover:bg-zinc-800/60 rounded px-1 py-0.5"
                          >
                            <span className="text-zinc-600 shrink-0">{formatTime(sub.start)}</span>
                            <span className="text-zinc-300 truncate">{sub.text}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>

                {/* Execute */}
                <div className="border-t border-zinc-800/60 pt-4">
                  <button
                    onClick={handleClip}
                    disabled={isWorking}
                    className="w-full py-3 bg-violet-600 hover:bg-violet-500 text-white font-mono text-xs uppercase tracking-widest rounded transition-all disabled:opacity-40 flex items-center justify-center gap-2 shadow-lg shadow-violet-900/40"
                  >
                    {processingState === "clipping" ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Processing...</>
                    ) : (
                      <><Scissors className="w-4 h-4" /> Cut Clip</>
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        </aside>

        {/* ── Main Panel ──────────────────────────────────────────── */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {/* Video Preview */}
          <div className="flex-1 flex items-center justify-center bg-zinc-900 relative min-h-0">
            {videoSrc ? (
              <>
                <video
                  ref={videoRef}
                  src={videoSrc}
                  className="max-w-full max-h-full object-contain"
                  onClick={togglePlay}
                  style={{ cursor: "pointer" }}
                />
                {/* Active subtitle overlay */}
                {activeSubtitle && (
                  <div className="absolute bottom-8 left-0 right-0 flex justify-center pointer-events-none">
                    <div className="bg-black/80 text-white px-4 py-2 rounded text-sm font-sans max-w-lg text-center">
                      {activeSubtitle.text}
                    </div>
                  </div>
                )}
                {/* Processing overlay */}
                {isWorking && (
                  <div className="absolute inset-0 bg-zinc-950/80 flex flex-col items-center justify-center gap-4">
                    <Loader2 className="w-10 h-10 text-violet-400 animate-spin" />
                    <p className="font-mono text-sm text-zinc-300">{statusMessage}</p>
                  </div>
                )}
              </>
            ) : (
              <div className="text-center space-y-4 p-8">
                <div className="w-24 h-24 rounded-2xl bg-zinc-800/60 flex items-center justify-center mx-auto">
                  <Film className="w-10 h-10 text-zinc-700" />
                </div>
                <p className="font-mono text-sm text-zinc-600">No video loaded</p>
                <p className="text-xs text-zinc-700">Upload a file or paste a link to begin</p>
              </div>
            )}
          </div>

          {/* Player controls + Timeline */}
          {hasVideo && (
            <div className="border-t border-zinc-800/60 bg-zinc-950 p-4 space-y-3">
              {/* Play controls */}
              <div className="flex items-center gap-3">
                <button
                  onClick={togglePlay}
                  className="w-8 h-8 rounded-full bg-zinc-800 hover:bg-zinc-700 flex items-center justify-center transition-colors"
                >
                  {isPlaying ? (
                    <Pause className="w-3.5 h-3.5 text-zinc-200" />
                  ) : (
                    <Play className="w-3.5 h-3.5 text-zinc-200 translate-x-px" />
                  )}
                </button>
                <span className="text-xs font-mono text-zinc-500">
                  {formatTime(currentTime)} / {formatTime(videoDuration)}
                </span>
                <button
                  onClick={setClipToCurrentTime}
                  title="Set clip start to current time"
                  className="ml-auto text-[10px] font-mono text-zinc-500 hover:text-violet-400 flex items-center gap-1 transition-colors"
                >
                  <Clock className="w-3 h-3" /> Set clip start here
                </button>
              </div>

              {/* Timeline */}
              <TimelineSlider
                duration={videoDuration}
                startTime={startTime}
                clipDuration={clipDuration}
                currentTime={currentTime}
                onStartChange={setStartTime}
                onDurationChange={setClipDuration}
                onSeek={handleSeek}
              />
            </div>
          )}
        </main>

        {/* ── Output Panel (slides in when done) ─────────────────── */}
        {outputUrl && (
          <aside className="w-80 border-l border-zinc-800/60 flex flex-col">
            <div className="border-b border-zinc-800/60 px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-emerald-500" />
                <span className="text-xs font-mono text-emerald-400">Output Ready</span>
              </div>
              <button
                onClick={() => setOutputUrl(null)}
                className="text-zinc-600 hover:text-zinc-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 p-4 space-y-4 overflow-y-auto">
              {/* Output preview */}
              <div className="rounded-lg overflow-hidden bg-zinc-900 border border-zinc-800">
                <video src={outputUrl} controls className="w-full" />
              </div>

              {/* Clip info */}
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: "Start", value: formatTime(startTime) },
                  { label: "Duration", value: `${clipDuration.toFixed(1)}s` },
                  { label: "Ratio", value: aspectRatio },
                  { label: "Subtitles", value: burnSubtitles && subtitles.length > 0 ? "Burned" : subtitles.length > 0 ? "SRT only" : "None" },
                ].map((item) => (
                  <div key={item.label} className="bg-zinc-900 rounded p-3 border border-zinc-800">
                    <p className="text-[10px] font-mono text-zinc-600 mb-0.5">{item.label}</p>
                    <p className="text-xs font-mono text-zinc-200 font-bold">{item.value}</p>
                  </div>
                ))}
              </div>

              {/* Download button */}
              <a
                href={outputUrl}
                download="clip.mp4"
                className="block w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-mono text-xs uppercase tracking-widest rounded text-center transition-colors shadow-lg shadow-emerald-900/40"
              >
                <Download className="w-4 h-4 inline mr-2" />
                Download MP4
              </a>

              {/* Make another */}
              <button
                onClick={() => {
                  setOutputUrl(null);
                  setProcessingState("idle");
                  setStatusMessage("");
                }}
                className="w-full py-2.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 font-mono text-xs uppercase rounded transition-colors flex items-center justify-center gap-2"
              >
                <RefreshCw className="w-3 h-3" /> Make Another
              </button>
            </div>
          </aside>
        )}
      </div>

      {/* Error Toast */}
      {errorMessage && (
        <div className="fixed bottom-4 right-4 max-w-md bg-red-950 border border-red-800 rounded-lg p-4 shadow-2xl flex items-start gap-3 z-50">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-red-300 mb-0.5">Error</p>
            <p className="text-xs text-red-400">{errorMessage}</p>
          </div>
          <button onClick={() => setErrorMessage(null)} className="text-red-600 hover:text-red-400 shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}