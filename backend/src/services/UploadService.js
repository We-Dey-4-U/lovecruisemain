/* ============================================================
   backend/src/services/UploadService.js
   Appwrite Storage Service
   Compatible with node-appwrite v26.x
   ============================================================ */

const sdk = require("node-appwrite");
const { File } = require("node:buffer");

/* ============================================================
   DEBUG LOGS
   ============================================================ */

console.log("=================================");
console.log("APPWRITE CONFIG");
console.log("=================================");
console.log("APPWRITE_ENDPOINT =", process.env.APPWRITE_ENDPOINT);
console.log("APPWRITE_PROJECT_ID =", process.env.APPWRITE_PROJECT_ID);
console.log("APPWRITE_BUCKET_ID =", process.env.APPWRITE_BUCKET_ID);
console.log(
  "APPWRITE_API_KEY exists =",
  !!process.env.APPWRITE_API_KEY
);
console.log("File exists =", typeof File);
console.log("=================================");

/* ============================================================
   ENV VALIDATION
   ============================================================ */

if (!process.env.APPWRITE_ENDPOINT) {
  throw new Error("APPWRITE_ENDPOINT is missing");
}

if (!process.env.APPWRITE_PROJECT_ID) {
  throw new Error("APPWRITE_PROJECT_ID is missing");
}

if (!process.env.APPWRITE_API_KEY) {
  throw new Error("APPWRITE_API_KEY is missing");
}

if (!process.env.APPWRITE_BUCKET_ID) {
  throw new Error("APPWRITE_BUCKET_ID is missing");
}

/* ============================================================
   APPWRITE CLIENT
   ============================================================ */

const client = new sdk.Client()
  .setEndpoint(process.env.APPWRITE_ENDPOINT.trim())
  .setProject(process.env.APPWRITE_PROJECT_ID.trim())
  .setKey(process.env.APPWRITE_API_KEY.trim());

const storage = new sdk.Storage(client);

const BUCKET_ID = process.env.APPWRITE_BUCKET_ID.trim();

/* ============================================================
   SERVICE
   ============================================================ */

module.exports = {
  /**
   * Upload image to Appwrite
   * @param {Express.Multer.File} file
   */
  async uploadFile(file) {
    try {
      if (!file) {
        throw new Error("No file received");
      }

      if (!file.buffer) {
        throw new Error(
          "Uploaded file buffer missing. Ensure multer uses memoryStorage()."
        );
      }

      console.log("=================================");
      console.log("APPWRITE UPLOAD START");
      console.log("=================================");
      console.log({
        name: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
        hasBuffer: !!file.buffer,
      });

      const appwriteFile = new File(
        [file.buffer],
        file.originalname || "upload",
        {
          type:
            file.mimetype ||
            "application/octet-stream",
        }
      );

      const uploaded = await storage.createFile(
        BUCKET_ID,
        sdk.ID.unique(),
        appwriteFile
      );

      console.log("=================================");
      console.log("APPWRITE UPLOAD SUCCESS");
      console.log("FILE ID =", uploaded.$id);
      console.log("=================================");

      return uploaded;
    } catch (err) {
      console.error("=================================");
      console.error("APPWRITE STORAGE ERROR");
      console.error("=================================");
      console.error(err);
      console.error("MESSAGE:", err.message);
      console.error("CODE:", err.code);
      console.error("TYPE:", err.type);
      console.error("=================================");

      throw err;
    }
  },

  /**
   * Generate public image URL
   */
  getFileViewUrl(fileId) {
    return (
      `${process.env.APPWRITE_ENDPOINT}` +
      `/storage/buckets/${BUCKET_ID}` +
      `/files/${fileId}/view` +
      `?project=${process.env.APPWRITE_PROJECT_ID}`
    );
  },

  /**
   * Delete Appwrite file
   */
  async deleteFile(fileId) {
    try {
      await storage.deleteFile(
        BUCKET_ID,
        fileId
      );

      console.log(
        "Deleted Appwrite file:",
        fileId
      );
    } catch (err) {
      console.error(
        "Delete Appwrite file failed:",
        err.message
      );

      throw err;
    }
  },
};