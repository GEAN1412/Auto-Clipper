import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import ytdl from "ytdl-core";
import fs from "fs";
import multer from "multer";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import { v4 as uuidv4 } from "uuid";

if (ffmpegStatic) {
  ffmpeg.setFfmpegPath(ffmpegStatic);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure temp directory exists
const tempDir = path.join(__dirname, "temp");
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir);
}

const upload = multer({ 
  dest: "temp/",
  limits: { fileSize: 500 * 1024 * 1024 } // 500MB limit
});

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '500mb' }));
  app.use(express.urlencoded({ limit: '500mb', extended: true }));

  // Log all requests
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
    next();
  });

  // API routes
  app.get("/api/download", async (req, res) => {
    const { url } = req.query;
    if (!url || typeof url !== "string") {
      return res.status(400).json({ error: "URL is required" });
    }

    try {
      if (ytdl.validateURL(url)) {
        const info = await ytdl.getInfo(url);
        const format = ytdl.chooseFormat(info.formats, { quality: "highestvideo", filter: "audioandvideo" });
        
        res.setHeader("Content-Disposition", `attachment; filename="video.mp4"`);
        res.setHeader("Content-Type", "video/mp4");
        
        ytdl(url, { format }).pipe(res);
      } else {
        const response = await fetch(url);
        if (!response.ok) throw new Error("Failed to fetch video");
        
        const contentType = response.headers.get("content-type");
        if (contentType) res.setHeader("Content-Type", contentType);
        
        const arrayBuffer = await response.arrayBuffer();
        res.send(Buffer.from(arrayBuffer));
      }
    } catch (error) {
      console.error("Download error:", error);
      res.status(500).json({ error: "Failed to download video." });
    }
  });

  app.post("/api/clip", (req, res, next) => {
    upload.single("video")(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({ error: "File too large (Limit: 500MB)" });
        }
        return res.status(400).json({ error: err.message });
      } else if (err) {
        return res.status(500).json({ error: "Unknown upload error" });
      }
      next();
    });
  }, async (req, res) => {
    const { startTime, duration, aspectRatio, subtitles, burnSubtitles } = req.body;
    const videoPath = req.file?.path;
    const videoUrl = req.body.videoUrl;

    if (!videoPath && !videoUrl) {
      return res.status(400).json({ error: "Video file or URL is required" });
    }

    const outputId = uuidv4();
    const outputPath = path.join(tempDir, `${outputId}.mp4`);
    const srtPath = path.join(tempDir, `${outputId}.srt`);

    try {
      let inputSource = videoPath || videoUrl;

      // If it's a YouTube URL, get the stream URL first
      if (videoUrl && ytdl.validateURL(videoUrl)) {
        const info = await ytdl.getInfo(videoUrl);
        const format = ytdl.chooseFormat(info.formats, { quality: "highestvideo", filter: "audioandvideo" });
        inputSource = format.url;
      }

      // Handle subtitles if burning
      if (burnSubtitles === "true" && subtitles) {
        const subsArray = JSON.parse(subtitles);
        let srtContent = "";
        subsArray.forEach((sub: any, i: number) => {
          const formatTime = (seconds: number) => {
            const h = Math.floor(seconds / 3600).toString().padStart(2, "0");
            const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, "0");
            const s = Math.floor(seconds % 60).toString().padStart(2, "0");
            const ms = Math.floor((seconds % 1) * 1000).toString().padStart(3, "0");
            return `${h}:${m}:${s},${ms}`;
          };
          srtContent += `${i + 1}\n${formatTime(sub.start)} --> ${formatTime(sub.end)}\n${sub.text}\n\n`;
        });
        fs.writeFileSync(srtPath, srtContent);
      }

      let command = ffmpeg(inputSource)
        .setStartTime(startTime)
        .setDuration(duration);

      const filters: string[] = [];
      if (aspectRatio === "9:16") {
        filters.push("crop=ih*9/16:ih,scale=1080:1920");
      } else if (aspectRatio === "1:1") {
        filters.push("crop=ih:ih,scale=1080:1080");
      } else {
        filters.push("scale=1920:1080");
      }

      if (burnSubtitles === "true" && fs.existsSync(srtPath)) {
        // Use subtitles filter. Note: path might need escaping for ffmpeg
        filters.push(`subtitles=${srtPath.replace(/\\/g, "/")}`);
      }

      if (filters.length > 0) {
        command.videoFilters(filters);
      }

      command
        .output(outputPath)
        .on("end", () => {
          res.sendFile(outputPath, () => {
            // Cleanup
            if (videoPath && fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
            if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
            if (fs.existsSync(srtPath)) fs.unlinkSync(srtPath);
          });
        })
        .on("error", (err) => {
          console.error("FFmpeg error:", err);
          res.status(500).json({ error: "FFmpeg processing failed" });
          if (videoPath && fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
        })
        .run();

    } catch (error) {
      console.error("Clipping error:", error);
      res.status(500).json({ error: "Failed to clip video" });
    }
  });

  // Global error handler for API routes
  app.use("/api", (err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error("API Error:", err);
    res.status(err.status || 500).json({
      error: "Internal Server Error",
      message: err.message,
      path: req.path
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
