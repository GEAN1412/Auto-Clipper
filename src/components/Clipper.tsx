import React, { useState, useRef } from "react";
import { useDropzone } from "react-dropzone";
import { Scissors, Download, Upload, Link as LinkIcon, Type as SubtitleIcon, Loader2, Play } from "lucide-react";
import { generateSubtitles, Subtitle } from "../services/geminiService";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function Clipper() {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [linkUrl, setLinkUrl] = useState("");
  const [startTime, setStartTime] = useState(0);
  const [duration, setDuration] = useState(10);
  const [aspectRatio, setAspectRatio] = useState<"16:9" | "9:16" | "1:1">("16:9");
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [subtitles, setSubtitles] = useState<Subtitle[]>([]);
  const [isGeneratingSubtitles, setIsGeneratingSubtitles] = useState(false);
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [burnSubtitles, setBurnSubtitles] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const downloadSRT = () => {
    if (subtitles.length === 0) return;
    
    let srt = "";
    subtitles.forEach((sub, i) => {
      const formatTime = (seconds: number) => {
        const h = Math.floor(seconds / 3600).toString().padStart(2, "0");
        const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, "0");
        const s = Math.floor(seconds % 60).toString().padStart(2, "0");
        const ms = Math.floor((seconds % 1) * 1000).toString().padStart(3, "0");
        return `${h}:${m}:${s},${ms}`;
      };
      srt += `${i + 1}\n${formatTime(sub.start)} --> ${formatTime(sub.end)}\n${sub.text}\n\n`;
    });

    const blob = new Blob([srt], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "subtitles.srt";
    a.click();
  };

  // No loading screen needed for server-side

  const onDrop = (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (file) {
      if (file.size > 500 * 1024 * 1024) { // 500MB limit check
        setError("File is too large. Please use a video smaller than 500MB or use the link feature.");
        return;
      }
      setVideoFile(file);
      setVideoUrl(URL.createObjectURL(file));
      setOutputUrl(null);
      setError(null);
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "video/*": [] },
    multiple: false,
  } as any);

  const handleLinkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!linkUrl) return;

    setIsProcessing(true);
    setError(null);
    try {
      const response = await fetch(`/api/download?url=${encodeURIComponent(linkUrl)}`);
      if (!response.ok) {
        let errorMessage = "Failed to download video";
        try {
          const errData = await response.json();
          errorMessage = errData.error || errData.message || errorMessage;
        } catch (e) {
          errorMessage = `Download error (${response.status})`;
        }
        throw new Error(errorMessage);
      }
      
      const blob = await response.blob();
      const file = new File([blob], "downloaded_video.mp4", { type: blob.type });
      setVideoFile(file);
      setVideoUrl(URL.createObjectURL(file));
      setOutputUrl(null);
    } catch (err: any) {
      setError("Failed to download video. YouTube links are supported, but TikTok/Instagram may require manual upload due to platform restrictions.");
    } finally {
      setIsProcessing(false);
    }
  };

  const processVideo = async () => {
    if (!videoFile && !linkUrl) return;

    setIsProcessing(true);
    setProgress(0);
    setError(null);

    try {
      const formData = new FormData();
      if (videoFile) {
        formData.append("video", videoFile);
      } else {
        formData.append("videoUrl", linkUrl);
      }
      
      formData.append("startTime", startTime.toString());
      formData.append("duration", duration.toString());
      formData.append("aspectRatio", aspectRatio);
      formData.append("burnSubtitles", burnSubtitles.toString());
      if (subtitles.length > 0) {
        formData.append("subtitles", JSON.stringify(subtitles));
      }

      const response = await fetch("/api/clip", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        let errorMessage = "Failed to process video";
        try {
          const errData = await response.json();
          errorMessage = errData.error || errData.message || errorMessage;
        } catch (e) {
          if (response.status === 413) {
            errorMessage = "File is too large for the server to process. Please try a smaller file (under 500MB) or use the link feature.";
          } else {
            errorMessage = `Server processing error (${response.status})`;
          }
        }
        throw new Error(errorMessage);
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      setOutputUrl(url);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to process video. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleGenerateSubtitles = async () => {
    if (!videoFile) return;

    setIsGeneratingSubtitles(true);
    setError(null);
    try {
      // Convert video to base64 for Gemini
      const reader = new FileReader();
      reader.readAsDataURL(videoFile);
      reader.onload = async () => {
        const base64 = (reader.result as string).split(",")[1];
        const subs = await generateSubtitles(base64, videoFile.type);
        setSubtitles(subs);
        setIsGeneratingSubtitles(false);
      };
    } catch (err: any) {
      setError("Failed to generate subtitles.");
      setIsGeneratingSubtitles(false);
    }
  };

  // No loading screen needed for server-side

  return (
    <div className="max-w-6xl mx-auto p-8 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-line pb-4">
        <div>
          <h1 className="text-4xl font-serif italic tracking-tight">AutoClipper Pro</h1>
          <p className="text-xs font-mono uppercase opacity-50">Version 1.0.0 // Professional Grade</p>
        </div>
        <div className="flex items-center space-x-4">
          <div className="text-right">
            <p className="text-[10px] font-mono opacity-50 uppercase">System Status</p>
            <p className="text-xs font-mono text-emerald-600">ENGINE READY</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Input & Controls */}
        <div className="space-y-6 lg:col-span-1">
          {/* Link Input */}
          <div className="p-6 bg-white border border-line rounded-sm space-y-4 shadow-sm">
            <div className="flex items-center space-x-2">
              <LinkIcon className="w-4 h-4 opacity-50" />
              <h2 className="text-xs font-mono uppercase tracking-widest">Import via Link</h2>
            </div>
            <form onSubmit={handleLinkSubmit} className="flex space-x-2">
              <input
                type="text"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="YouTube, TikTok, or Direct URL..."
                className="flex-1 px-3 py-2 border border-line font-mono text-sm focus:outline-none focus:ring-1 focus:ring-ink"
              />
              <button
                type="submit"
                disabled={isProcessing}
                className="px-4 py-2 bg-ink text-bg font-mono text-xs uppercase hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : "Fetch"}
              </button>
            </form>
          </div>

          {/* Upload Area */}
          <div
            {...getRootProps()}
            className={cn(
              "p-12 border-2 border-dashed border-line rounded-sm text-center cursor-pointer transition-colors",
              isDragActive ? "bg-ink/5" : "bg-white",
              videoFile && "border-emerald-500/50"
            )}
          >
            <input {...getInputProps()} />
            <Upload className="w-8 h-8 mx-auto mb-4 opacity-20" />
            <p className="text-xs font-mono uppercase tracking-widest">
              {videoFile ? videoFile.name : "Drag & Drop or Click to Upload"}
            </p>
          </div>

          {/* Clipping Controls */}
          <div className="p-6 bg-white border border-line rounded-sm space-y-6 shadow-sm">
            <div className="flex items-center space-x-2">
              <Scissors className="w-4 h-4 opacity-50" />
              <h2 className="text-xs font-mono uppercase tracking-widest">Clipping Parameters</h2>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-mono uppercase opacity-50 mb-1">Start Time (Seconds)</label>
                <input
                  type="number"
                  value={startTime}
                  onChange={(e) => setStartTime(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-line font-mono text-sm"
                />
              </div>
              <div>
                <label className="block text-[10px] font-mono uppercase opacity-50 mb-1">Duration (Seconds)</label>
                <input
                  type="number"
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-line font-mono text-sm"
                />
              </div>
              <div>
                <label className="block text-[10px] font-mono uppercase opacity-50 mb-1">Aspect Ratio</label>
                <div className="grid grid-cols-3 gap-2">
                  {(["16:9", "9:16", "1:1"] as const).map((ratio) => (
                    <button
                      key={ratio}
                      onClick={() => setAspectRatio(ratio)}
                      className={cn(
                        "py-2 border border-line font-mono text-[10px] uppercase transition-colors",
                        aspectRatio === ratio ? "bg-ink text-bg" : "bg-white hover:bg-ink/5"
                      )}
                    >
                      {ratio}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <button
              onClick={processVideo}
              disabled={!videoFile || isProcessing}
              className="w-full py-3 bg-ink text-bg font-mono text-xs uppercase tracking-widest hover:opacity-90 disabled:opacity-50 transition-all flex items-center justify-center space-x-2"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Processing...</span>
                </>
              ) : (
                <>
                  <Scissors className="w-4 h-4" />
                  <span>Execute Clip</span>
                </>
              )}
            </button>
          </div>

          {/* Subtitle Generator */}
          <div className="p-6 bg-white border border-line rounded-sm space-y-4 shadow-sm">
            <div className="flex items-center space-x-2">
              <SubtitleIcon className="w-4 h-4 opacity-50" />
              <h2 className="text-xs font-mono uppercase tracking-widest">AI Auto-Subtitles</h2>
            </div>
            <div className="flex items-center justify-between">
              <button
                onClick={handleGenerateSubtitles}
                disabled={!videoFile || isGeneratingSubtitles}
                className="flex-1 py-2 border border-line font-mono text-[10px] uppercase hover:bg-ink hover:text-bg transition-all flex items-center justify-center space-x-2"
              >
                {isGeneratingSubtitles ? (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>Analyzing...</span>
                  </>
                ) : (
                  <>
                    <SubtitleIcon className="w-3 h-3" />
                    <span>Generate Subtitles</span>
                  </>
                )}
              </button>
              {subtitles.length > 0 && (
                <button
                  onClick={downloadSRT}
                  className="ml-2 p-2 border border-line hover:bg-ink hover:text-bg transition-all"
                  title="Download SRT"
                >
                  <Download className="w-3 h-3" />
                </button>
              )}
            </div>

            <div className="flex items-center space-x-2 py-2">
              <input
                type="checkbox"
                id="burnSubs"
                checked={burnSubtitles}
                onChange={(e) => setBurnSubtitles(e.target.checked)}
                className="w-4 h-4 border-line rounded-sm"
              />
              <label htmlFor="burnSubs" className="text-[10px] font-mono uppercase opacity-70 cursor-pointer">
                Burn Subtitles into Video
              </label>
            </div>

            {subtitles.length > 0 && (
              <div className="max-h-40 overflow-y-auto border border-line p-2 space-y-2">
                {subtitles.map((sub, i) => (
                  <div key={i} className="text-[10px] font-mono border-b border-line/10 pb-1">
                    <span className="opacity-50">[{sub.start}s - {sub.end}s]</span> {sub.text}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Preview */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-ink p-1 rounded-sm shadow-2xl overflow-hidden aspect-video relative flex items-center justify-center">
            {videoUrl ? (
              <video
                ref={videoRef}
                src={videoUrl}
                controls
                className="max-h-full max-w-full"
              />
            ) : (
              <div className="text-bg/20 flex flex-col items-center">
                <Play className="w-16 h-16 mb-4" />
                <p className="font-mono text-xs uppercase tracking-widest">Waiting for Input...</p>
              </div>
            )}
            
            {/* Overlay for processing */}
            {isProcessing && (
              <div className="absolute inset-0 bg-ink/80 flex flex-col items-center justify-center text-bg space-y-4">
                <Loader2 className="w-12 h-12 animate-spin" />
                <p className="font-mono text-sm uppercase tracking-widest">Processing on Server...</p>
                <p className="font-mono text-[10px] uppercase opacity-50">This may take a few moments</p>
              </div>
            )}
          </div>

          {/* Output Section */}
          {outputUrl && (
            <div className="p-8 bg-white border border-line rounded-sm space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Play className="w-4 h-4 text-emerald-600" />
                  <h2 className="text-xs font-mono uppercase tracking-widest text-emerald-600">Output Generated</h2>
                </div>
                <a
                  href={outputUrl}
                  download="clipped_video.mp4"
                  className="px-6 py-2 bg-emerald-600 text-white font-mono text-xs uppercase tracking-widest hover:bg-emerald-700 transition-colors flex items-center space-x-2"
                >
                  <Download className="w-4 h-4" />
                  <span>Download Result</span>
                </a>
              </div>
              <div className="aspect-video bg-ink p-1 rounded-sm overflow-hidden flex items-center justify-center">
                <video src={outputUrl} controls className="max-h-full max-w-full" />
              </div>
            </div>
          )}

          {error && (
            <div className="p-4 bg-red-50 border border-red-200 text-red-600 font-mono text-xs uppercase">
              Error: {error}
            </div>
          )}

          {/* Technical Specs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "Encoder", value: "Server-Side FFmpeg" },
              { label: "Format", value: "H.264 / MP4" },
              { label: "Preset", value: "Ultrafast" },
              { label: "AI Engine", value: "Gemini 3 Flash" },
            ].map((spec, i) => (
              <div key={i} className="p-4 border border-line bg-white">
                <p className="text-[10px] font-mono uppercase opacity-50">{spec.label}</p>
                <p className="text-xs font-mono font-bold uppercase">{spec.value}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
