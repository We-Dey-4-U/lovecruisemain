const multer = require("multer");

const upload = multer({
  storage: multer.memoryStorage(),

  limits: {
    fileSize: 100 * 1024 * 1024
  },

  fileFilter(req, file, cb) {
    const allowed = [
      "image/jpeg",
      "image/png",
      "image/jpg",
      "image/webp",
      "video/mp4",
      "video/webm",
      "video/quicktime"
    ];

    if (!allowed.includes(file.mimetype)) {
      return cb(new Error("Unsupported file type"), false);
    }

    cb(null, true);
  }
});

module.exports = upload.array("media", 10);