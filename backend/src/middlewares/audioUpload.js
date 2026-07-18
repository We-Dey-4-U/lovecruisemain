// backend/src/middlewares/audioUpload.js
//
// Deliberately diskStorage, NOT memoryStorage like uploads.routes.js
// image middleware. Two reasons:
//   1. fluent-ffmpeg's probe/transcode/extract-art calls all take a
//      file PATH, not a buffer — musicLibraryController.uploadSong
//      already assumes req.file.path exists.
//   2. Audio files run up to 100MB; buffering every concurrent
//      upload fully into RAM (as memoryStorage does) is a real
//      memory-pressure risk at any real traffic volume. A temp file
//      on disk, streamed and deleted right after processing, is the
//      safer default for this file size.

const multer = require("multer");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const ALLOWED_MIMETYPES = [
  "audio/mpeg",       // .mp3
  "audio/mp4",        // .m4a
  "audio/aac",
  "audio/x-aac",
  "audio/wav",
  "audio/x-wav",
  "audio/flac",
  "audio/x-flac"
];

const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, os.tmpdir());
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname || "") || "";
    cb(null, `radio-upload-${crypto.randomBytes(8).toString("hex")}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
  fileFilter(req, file, cb) {
    if (!ALLOWED_MIMETYPES.includes(file.mimetype)) {
      return cb(new Error("Unsupported file type — audio only (mp3/aac/m4a/wav/flac)"), false);
    }
    cb(null, true);
  }
});

module.exports = upload.single("audio");