/**
 * Subtitle types shared between client and server.
 * NOTE: All Gemini API calls happen server-side (server.ts) for security.
 * This file only contains client-side helpers and type definitions.
 */

export interface Subtitle {
  start: number;
  end: number;
  text: string;
}

/**
 * Generate subtitles by uploading video to our secure server endpoint.
 * The server calls Gemini with the API key — it never reaches the browser.
 */
export async function generateSubtitles(
  videoFile: File,
  fileId?: string
): Promise<Subtitle[]> {
  const formData = new FormData();

  if (fileId) {
    // If video was already downloaded server-side, just pass the fileId
    formData.append("fileId", fileId);
  } else {
    // Upload the file for analysis
    formData.append("video", videoFile);
  }

  const response = await fetch("/api/subtitles", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(err.error || `Server error ${response.status}`);
  }

  const data = await response.json();
  return Array.isArray(data.subtitles) ? data.subtitles : [];
}

/**
 * Format seconds to SRT timestamp format
 */
export function formatSRTTime(seconds: number): string {
  const h = Math.floor(seconds / 3600).toString().padStart(2, "0");
  const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, "0");
  const s = Math.floor(seconds % 60).toString().padStart(2, "0");
  const ms = Math.floor((seconds % 1) * 1000).toString().padStart(3, "0");
  return `${h}:${m}:${s},${ms}`;
}

/**
 * Generate SRT file content from subtitles array
 */
export function generateSRTContent(subtitles: Subtitle[]): string {
  return subtitles
    .map(
      (sub, i) =>
        `${i + 1}\n${formatSRTTime(sub.start)} --> ${formatSRTTime(sub.end)}\n${sub.text}`
    )
    .join("\n\n");
}

/**
 * Download subtitles as SRT file
 */
export function downloadSRT(subtitles: Subtitle[], filename = "subtitles.srt"): void {
  const content = generateSRTContent(subtitles);
  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Get the currently active subtitle for a given playback time
 */
export function getActiveSubtitle(
  subtitles: Subtitle[],
  currentTime: number
): Subtitle | null {
  return subtitles.find(
    (sub) => currentTime >= sub.start && currentTime <= sub.end
  ) || null;
}