/* ============================================================
   backend/src/controllers/postController.js
   ============================================================ */

const db = require("../config/db");
const { storage, ID } = require("../config/appwrite"); // ✅ FIXED IMPORT (TOP LEVEL)
const UploadService = require("../services/UploadService");

function safeParseMedia(data) {
  if (!data) return [];

  if (Array.isArray(data)) return data;

  if (typeof data === "string") {
    try {
      return JSON.parse(data);
    } catch (e) {
      return [];
    }
  }

  return [];
}

const PostController = {

  /* ----------------------------------------------------------
     POST /api/posts
     Create a new post (text, image, or video)
  ---------------------------------------------------------- */
async createPost(req, res) {
  try {
    const { caption, tags } = req.body;
    const userId = req.user.id;
    const files = req.files || [];

    console.log("FILES RECEIVED:", files.length);

    let media_urls = [];
    let media_type = "text";

    for (const file of files) {
      const uploaded = await UploadService.uploadFile(file);
      const url = UploadService.getFileViewUrl(uploaded.$id);

      media_urls.push(url);

      if (file.mimetype.startsWith("image")) media_type = "image";
      if (file.mimetype.startsWith("video")) media_type = "video";
    }

    // ✅ FIX: ensure valid JSONB input
    const safeMedia = JSON.stringify(media_urls);

    // ✅ FIX tags to array
    let safeTags = [];
    if (Array.isArray(tags)) safeTags = tags;
    else if (typeof tags === "string") safeTags = [tags];

    const { rows } = await db.query(
      `
      INSERT INTO posts (
        user_id,
        caption,
        media_urls,
        media_type,
        tags,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3::jsonb, $4, $5, NOW(), NOW())
      RETURNING *
      `,
      [
        userId,
        caption || null,
        safeMedia,     // ✅ jsonb-safe string
        media_type,
        safeTags       // ✅ text[]
      ]
    );

    return res.status(201).json({
      success: true,
      data: rows[0]
    });

  } catch (err) {
    console.error("CREATE POST ERROR:", err);
    return res.status(500).json({
      success: false,
      message: err.message
    });
  }
},
  /* ----------------------------------------------------------
     GET FEED
  ---------------------------------------------------------- */
 async getFeed(req, res) {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 50);
    const offset = Number(req.query.offset) || 0;
    const userId = req.user.id;

    const { rows } = await db.query(
      `
      SELECT
        p.*,
        u.username,
        u.display_name,
        u.avatar_url,
        u.is_verified,
        (SELECT COUNT(*)::int FROM post_likes WHERE post_id = p.id) AS likes_count,
        (SELECT COUNT(*)::int FROM post_comments WHERE post_id = p.id) AS comments_count,
        EXISTS(
          SELECT 1 FROM post_likes
          WHERE post_id = p.id AND user_id = $3
        ) AS is_liked
      FROM posts p
      JOIN users u ON u.id = p.user_id
      WHERE p.is_deleted = FALSE
      ORDER BY p.created_at DESC
      LIMIT $1 OFFSET $2
      `,
      [limit, offset, userId]
    );

    /* 🔥 CRITICAL FIX: parse media_urls */
    const cleaned = rows.map(p => ({
      ...p,
      media_urls: safeParseMedia(p.media_urls)
    }));

    return res.json({
      success: true,
      data: cleaned
    });

  } catch (err) {
    console.error("GET FEED ERROR:", err);
    return res.status(500).json({
      success: false,
      message: err.message
    });
  }
},

  /* ----------------------------------------------------------
     USER POSTS
  ---------------------------------------------------------- */
  async getUserPosts(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const { rows } = await db.query(
      `
      SELECT
        p.*,
        u.username,
        u.display_name,
        u.avatar_url,
        u.is_verified,
        (SELECT COUNT(*)::int FROM post_likes WHERE post_id = p.id) AS likes_count,
        (SELECT COUNT(*)::int FROM post_comments WHERE post_id = p.id) AS comments_count,
        EXISTS(
          SELECT 1 FROM post_likes
          WHERE post_id = p.id AND user_id = $2
        ) AS is_liked
      FROM posts p
      JOIN users u ON u.id = p.user_id
      WHERE p.user_id = $1 AND p.is_deleted = FALSE
      ORDER BY p.created_at DESC
      `,
      [id, userId]
    );

    return res.json({
      success: true,
      data: rows
    });

  } catch (err) {
    console.error("GET USER POSTS ERROR:", err);
    return res.status(500).json({
      success: false,
      message: err.message
    });
  }
},

  /* ----------------------------------------------------------
     SINGLE POST
  ---------------------------------------------------------- */
  async getPost(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      const { rows: [post] } = await db.query(
        `
        SELECT
          p.*,
          u.username,
          u.display_name,
          u.avatar_url,
          u.is_verified,
          (SELECT COUNT(*)::int FROM post_likes WHERE post_id = p.id) AS likes_count,
          (SELECT COUNT(*)::int FROM post_comments WHERE post_id = p.id) AS comments_count,
          EXISTS(
            SELECT 1 FROM post_likes
            WHERE post_id = p.id AND user_id = $2
          ) AS is_liked
        FROM posts p
        JOIN users u ON u.id = p.user_id
        WHERE p.id = $1 AND p.is_deleted = FALSE
        `,
        [id, userId]
      );

      if (!post) {
        return res.status(404).json({
          success: false,
          message: "Post not found"
        });
      }

      const { rows: comments } = await db.query(
        `
        SELECT c.*, u.username, u.display_name, u.avatar_url
        FROM post_comments c
        JOIN users u ON u.id = c.user_id
        WHERE c.post_id = $1
        ORDER BY c.created_at ASC
        LIMIT 50
        `,
        [id]
      );

      return res.json({
        success: true,
        data: { ...post, comments }
      });

    } catch (err) {
      console.error("GET POST ERROR:", err);
      return res.status(500).json({
        success: false,
        message: err.message
      });
    }
  },

  /* ----------------------------------------------------------
     DELETE POST
  ---------------------------------------------------------- */
  async deletePost(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      const { rows } = await db.query(
        `
        UPDATE posts
        SET is_deleted = TRUE, updated_at = NOW()
        WHERE id = $1 AND user_id = $2
        RETURNING id
        `,
        [id, userId]
      );

      if (!rows.length) {
        return res.status(404).json({
          success: false,
          message: "Post not found or not yours"
        });
      }

      return res.json({
        success: true,
        message: "Post deleted"
      });

    } catch (err) {
      console.error("DELETE POST ERROR:", err);
      return res.status(500).json({
        success: false,
        message: err.message
      });
    }
  },

  /* ----------------------------------------------------------
     LIKE / UNLIKE
  ---------------------------------------------------------- */
  async toggleLike(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      const { rows: [existing] } = await db.query(
        `SELECT 1 FROM post_likes WHERE post_id = $1 AND user_id = $2`,
        [id, userId]
      );

      let liked;

      if (existing) {
        await db.query(
          `DELETE FROM post_likes WHERE post_id = $1 AND user_id = $2`,
          [id, userId]
        );
        liked = false;
      } else {
        await db.query(
          `INSERT INTO post_likes (post_id, user_id) VALUES ($1, $2)`,
          [id, userId]
        );
        liked = true;
      }

      const { rows: [{ count }] } = await db.query(
        `SELECT COUNT(*)::int AS count FROM post_likes WHERE post_id = $1`,
        [id]
      );

      return res.json({
        success: true,
        data: { liked, likes_count: count }
      });

    } catch (err) {
      console.error("TOGGLE LIKE ERROR:", err);
      return res.status(500).json({
        success: false,
        message: err.message
      });
    }
  },

  /* ----------------------------------------------------------
     ADD COMMENT
  ---------------------------------------------------------- */
  async addComment(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const { body } = req.body;

      if (!body || !body.trim()) {
        return res.status(400).json({
          success: false,
          message: "Comment cannot be empty"
        });
      }

      const { rows: [comment] } = await db.query(
        `
        INSERT INTO post_comments (post_id, user_id, body, created_at)
        VALUES ($1, $2, $3, NOW())
        RETURNING *
        `,
        [id, userId, body.trim()]
      );

      const { rows: [author] } = await db.query(
        `
        SELECT id, username, display_name, avatar_url
        FROM users
        WHERE id = $1
        `,
        [userId]
      );

      return res.status(201).json({
        success: true,
        data: { ...comment, ...author }
      });

    } catch (err) {
      console.error("ADD COMMENT ERROR:", err);
      return res.status(500).json({
        success: false,
        message: err.message
      });
    }
  },

  /* ----------------------------------------------------------
     GET COMMENTS
  ---------------------------------------------------------- */
  async getComments(req, res) {
    try {
      const { id } = req.params;

      const { rows } = await db.query(
        `
        SELECT c.*, u.username, u.display_name, u.avatar_url
        FROM post_comments c
        JOIN users u ON u.id = c.user_id
        WHERE c.post_id = $1
        ORDER BY c.created_at ASC
        `,
        [id]
      );

      return res.json({
        success: true,
        data: rows
      });

    } catch (err) {
      console.error("GET COMMENTS ERROR:", err);
      return res.status(500).json({
        success: false,
        message: err.message
      });
    }
  }
};

module.exports = PostController;