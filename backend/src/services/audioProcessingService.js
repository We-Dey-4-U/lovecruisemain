// backend/src/services/audioProcessingService.js
//
// Handles everything that needs to happen to a raw uploaded audio
// file (mp3/aac/wav/flac) before it's usable in the radio queue:
//   1. Probe it (ffprobe) for duration + embedded tags
//   2. Extract embedded cover art, if present
//   3. Transcode + loudness-normalize to a consistent streaming
//      format (AAC 192kbps, -16 LUFS) via ffmpeg
//   4. Upload the processed audio + cover art to APPWRITE STORAGE
//      via the existing UploadService (NOT S3 — this project's
//      actual storage backend is Appwrite; see UploadService.js).
//
// Requires:
//   npm install fluent-ffmpeg @ffmpeg-installer/ffmpeg @ffprobe-installer/ffprobe
//   (node-appwrite is already a dependency via UploadService.js)
//
// Env vars: none new here — this file relies entirely on
// UploadService.js already being configured (APPWRITE_ENDPOINT,
// APPWRITE_PROJECT_ID, APPWRITE_API_KEY, APPWRITE_BUCKET_ID).
//
// IMPORTANT: this file expects a real file path on disk (ffmpeg
// needs one), which means the multer middleware feeding
// musicLibraryController.uploadSong MUST use diskStorage (see
// middlewares/audioUpload.js), not memoryStorage like the image
// upload route. Large audio files (up to ~100MB) also shouldn't be
// held fully in RAM per concurrent upload anyway.

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("@ffmpeg-installer/ffmpeg").path;
const ffprobePath = require("@ffprobe-installer/ffprobe").path;
const UploadService = require("./UploadService");

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

const ALLOWED_INPUT_EXT = [".mp3", ".aac", ".m4a", ".wav", ".flac"];
const TARGET_LOUDNESS_LUFS = -16; // broadcast-standard-ish target loudness
const OUTPUT_BITRATE = "192k";

function assertSupportedExtension(originalName) {
  const ext = path.extname(originalName || "").toLowerCase();
  if (!ALLOWED_INPUT_EXT.includes(ext)) {
    throw new Error(
      `Unsupported audio format "${ext || "unknown"}". Supported: ${ALLOWED_INPUT_EXT.join(", ")}`
    );
  }
  return ext;
}

function tempPath(suffix) {
  return path.join(os.tmpdir(), `radio-${crypto.randomBytes(8).toString("hex")}${suffix}`);
}

/**
 * Runs ffprobe on a local file and returns duration + embedded tags.
 * @param {string} filePath
 */
function probeAudio(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) return reject(err);
      const format = data.format || {};
      const tags = format.tags || {};
      resolve({
        durationSeconds: Math.round(Number(format.duration) || 0),
        title: tags.title || tags.TITLE || null,
        artist: tags.artist || tags.ARTIST || null,
        album: tags.album || tags.ALBUM || null,
        genre: tags.genre || tags.GENRE || null,
        hasEmbeddedArt: (data.streams || []).some(s => s.codec_type === "video") // cover art shows up as a "video" stream
      });
    });
  });
}

/**
 * Extracts embedded cover art (if any) to a local temp JPG file.
 * Returns null if the source has no embedded art.
 */
function extractCoverArt(filePath) {
  return new Promise((resolve) => {
    const outPath = tempPath(".jpg");
    ffmpeg(filePath)
      .outputOptions(["-an", "-vcodec", "copy"])
      .save(outPath)
      .on("end", () => {
        if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) {
          resolve(outPath);
        } else {
          resolve(null);
        }
      })
      .on("error", () => resolve(null)); // no embedded art — not a fatal error
  });
}

/**
 * Transcodes + loudness-normalizes the source audio to AAC.
 * Two-pass loudnorm (measure, then apply) gives much more accurate
 * results than a single-pass filter, which matters when tracks come
 * from wildly different sources (phone recordings vs studio masters).
 */
async function transcodeAndNormalize(inputPath) {
  const outputPath = tempPath(".m4a");

  // Pass 1: measure loudness stats without writing output.
  const measured = await new Promise((resolve, reject) => {
    let statsJson = "";
    ffmpeg(inputPath)
      .audioFilters(`loudnorm=I=${TARGET_LOUDNESS_LUFS}:TP=-1.5:LRA=11:print_format=json`)
      .format("null")
      .on("stderr", (line) => { statsJson += line; })
      .on("end", () => {
        try {
          const match = statsJson.match(/\{[\s\S]*\}/);
          resolve(match ? JSON.parse(match[0]) : null);
        } catch (e) {
          resolve(null); // fall back to single-pass normalization below
        }
      })
      .on("error", reject)
      .save(process.platform === "win32" ? "NUL" : "/dev/null");
  });

  // Pass 2: apply normalization using the measured stats (or a sane
  // single-pass default if measurement failed).
  const loudnormFilter = measured
    ? `loudnorm=I=${TARGET_LOUDNESS_LUFS}:TP=-1.5:LRA=11:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}:offset=${measured.target_offset}:linear=true:print_format=summary`
    : `loudnorm=I=${TARGET_LOUDNESS_LUFS}:TP=-1.5:LRA=11`;

  await new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .audioFilters(loudnormFilter)
      .audioCodec("aac")
      .audioBitrate(OUTPUT_BITRATE)
      .audioChannels(2)
      .audioFrequency(44100)
      .format("mp4") // m4a container
      .on("end", resolve)
      .on("error", reject)
      .save(outputPath);
  });

  return outputPath;
}

/**
 * Reads a local file into a buffer and pushes it through the
 * existing Appwrite UploadService, mirroring the exact interface
 * UploadService.uploadFile() expects (an Express.Multer.File-shaped
 * object: { buffer, originalname, mimetype }).
 *
 * Returns { fileId, url }.
 */
async function uploadLocalFileToAppwrite(localPath, filename, mimetype) {
  const buffer = fs.readFileSync(localPath);
  const fileLike = {
    originalname: filename,
    mimetype,
    size: buffer.length,
    buffer
  };
  const uploaded = await UploadService.uploadFile(fileLike);
  const url = UploadService.getFileViewUrl(uploaded.$id);
  return { fileId: uploaded.$id, url };
}

/**
 * Full pipeline: local temp file in -> { fileUrl, fileId, coverUrl,
 * coverFileId, metadata } out. Cleans up every temp file it
 * creates, success or failure.
 *
 * fileId/coverFileId are returned (and should be persisted alongside
 * file_url/cover_url in radio_songs) so deleteSong can later call
 * UploadService.deleteFile() and actually free the Appwrite storage
 * — the current deleteSong controller only deletes the DB row today.
 *
 * @param {string} localFilePath - path to the raw uploaded file on disk
 * @param {string} originalName  - original filename (used to validate extension)
 * @param {string} songId        - radio_songs.id, used to build a
 *                                 stable display filename
 */
async function processUploadedSong(localFilePath, originalName, songId) {
  assertSupportedExtension(originalName);

  const cleanup = [];
  try {
    const metadata = await probeAudio(localFilePath);
    if (!metadata.durationSeconds) {
      throw new Error("Could not read audio duration — file may be corrupt");
    }

    const normalizedPath = await transcodeAndNormalize(localFilePath);
    cleanup.push(normalizedPath);

    const { fileId, url: fileUrl } = await uploadLocalFileToAppwrite(
      normalizedPath,
      `song-${songId}.m4a`,
      "audio/mp4"
    );

    let coverUrl = null;
    let coverFileId = null;
    const coverPath = await extractCoverArt(localFilePath);
    if (coverPath) {
      cleanup.push(coverPath);
      const coverUpload = await uploadLocalFileToAppwrite(
        coverPath,
        `song-${songId}-cover.jpg`,
        "image/jpeg"
      );
      coverUrl = coverUpload.url;
      coverFileId = coverUpload.fileId;
    }

    return {
      fileUrl,
      fileId,
      coverUrl,
      coverFileId,
      durationSeconds: metadata.durationSeconds,
      suggestedTitle: metadata.title,
      suggestedArtist: metadata.artist,
      suggestedAlbum: metadata.album,
      suggestedGenre: metadata.genre
    };
  } finally {
    cleanup.forEach(p => { try { fs.unlinkSync(p); } catch (e) {} });
  }
}

module.exports = {
  processUploadedSong,
  probeAudio,
  assertSupportedExtension
};