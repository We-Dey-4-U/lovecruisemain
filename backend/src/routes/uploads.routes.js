/* ============================================================
   backend/src/routes/uploads.routes.js

   POST /api/uploads

   multipart/form-data
   field name: file

   Returns:
   {
      success: true,
      url,
      fileId
   }
   ============================================================ */

const express = require("express");
const multer = require("multer");

const router = express.Router();

const { requireAuth } = require("../middlewares/auth");
const UploadService = require("../services/UploadService");

/* ============================================================
   MULTER
   ============================================================ */

const upload = multer({
  storage: multer.memoryStorage(),

  limits: {
    fileSize: 10 * 1024 * 1024,
  },

  fileFilter(req, file, cb) {
    console.log(
      "Incoming upload:",
      file.originalname,
      file.mimetype
    );

    if (
      file.mimetype &&
      file.mimetype.startsWith("image/")
    ) {
      return cb(null, true);
    }

    cb(
      new Error(
        "Only image files are allowed"
      )
    );
  },
});

/* ============================================================
   POST /api/uploads
   ============================================================ */

router.post(
  "/",
  requireAuth,
  upload.single("file"),

  async (req, res) => {
    try {
      console.log("=================================");
      console.log("UPLOAD REQUEST RECEIVED");
      console.log("=================================");

      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "No file provided",
        });
      }

      console.log("REQ.FILE =", {
        exists: !!req.file,
        originalname:
          req.file.originalname,
        mimetype:
          req.file.mimetype,
        size:
          req.file.size,
        hasBuffer:
          !!req.file.buffer,
      });

      const uploaded =
        await UploadService.uploadFile(
          req.file
        );

      const url =
        UploadService.getFileViewUrl(
          uploaded.$id
        );

      console.log("=================================");
      console.log("UPLOAD COMPLETE");
      console.log("FILE ID =", uploaded.$id);
      console.log("URL =", url);
      console.log("=================================");

      return res.status(201).json({
        success: true,
        fileId: uploaded.$id,
        url,
      });
    } catch (err) {
      console.error("=================================");
      console.error("UPLOAD ROUTE ERROR");
      console.error("=================================");
      console.error(err);
      console.error(
        "MESSAGE:",
        err.message
      );
      console.error("STACK:");
      console.error(err.stack);
      console.error("=================================");

      return res.status(500).json({
        success: false,
        message: err.message,
      });
    }
  }
);

module.exports = router;