/* ============================================================
   backend/src/controllers/postController.js
   ============================================================ */

const db = require("../config/db");
const { storage, ID } = require("../config/appwrite");
const UploadService = require("../services/UploadService");

/* ----------------------------------------------------------
   Normalizes media_urls into [{ url, type }].
   Handles BOTH old posts (plain string urls) and new posts
   ({url,type} objects), so no DB migration is needed.
---------------------------------------------------------- */
function safeParseMedia(data) {
  if (!data) return [];

  let arr = [];
  if (Array.isArray(data)) {
    arr = data;
  } else if (typeof data === "string") {
    try {
      arr = JSON.parse(data);
    } catch (e) {
      return [];
    }
  } else {
    return [];
  }

  return arr
    .map((item) => {
      if (typeof item === "string") {
        const isVideo = /\.(mp4|webm|mov|m4v)(\?|$)/i.test(item);
        return { url: item, type: isVideo ? "video" : "image" };
      }
      if (item && typeof item === "object" && item.url) {
        return { url: item.url, type: item.type === "video" ? "video" : "image" };
      }
      return null;
    })
    .filter(Boolean);
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

      const media = []; // [{ url, type }]

      for (const file of files) {
        const uploaded = await UploadService.uploadFile(file);
        const url = UploadService.getFileViewUrl(uploaded.$id);

        // ✅ FIX: determine type from the actual mimetype, not the URL.
        // Appwrite view URLs have no file extension, so guessing from the
        // URL (old code) always classified videos as images.
        const type = file.mimetype.startsWith("video") ? "video" : "image";

        media.push({ url, type });
      }

      const media_type = !media.length
        ? "text"
        : media.every((m) => m.type === "video")
        ? "video"
        : media.every((m) => m.type === "image")
        ? "image"
        : "mixed";

      // ✅ jsonb-safe string, now storing [{url,type}, ...]
      const safeMedia = JSON.stringify(media);

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
          safeMedia,
          media_type,
          safeTags
        ]
      );

      return res.status(201).json({
        success: true,
        data: { ...rows[0], media_urls: media }
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

      const cleaned = rows.map((p) => ({
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

      // ✅ FIX: this endpoint was returning raw (unparsed) media_urls before.
      const cleaned = rows.map((p) => ({
        ...p,
        media_urls: safeParseMedia(p.media_urls)
      }));

      return res.json({
        success: true,
        data: cleaned
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
        data: {
          ...post,
          media_urls: safeParseMedia(post.media_urls), // ✅ FIX: was returning raw JSON before
          comments
        }
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
     PUBLIC SHARE / OG PREVIEW PAGE
     GET /api/posts/share/:id
     No auth — this is what Facebook/WhatsApp/Twitter crawlers hit.
     Server-renders <meta> tags, then redirects real humans into
     the actual app (post.html).
  ---------------------------------------------------------- */
  async renderShare(req, res) {
    try {
      const { id } = req.params;

      const { rows: [post] } = await db.query(
        `
        SELECT p.*, u.username, u.display_name
        FROM posts p
        JOIN users u ON u.id = p.user_id
        WHERE p.id = $1 AND p.is_deleted = FALSE
        `,
        [id]
      );

      if (!post) {
        return res.status(404).send(
          `<!DOCTYPE html><html><head><title>Post not found</title></head><body><p>This post is no longer available.</p></body></html>`
        );
      }

      const media = safeParseMedia(post.media_urls);
      const firstImage = media.find((m) => m.type === "image");
      const firstVideo = media.find((m) => m.type === "video");

      const siteUrl = process.env.PUBLIC_SITE_URL || "https://your-frontend-domain.com";
      const postUrl = `${siteUrl}/post.html?id=${post.id}`;
      const shareUrl = `${req.protocol}://${req.get("host")}/api/posts/share/${post.id}`;

      const rawCaption = (post.caption || `${post.display_name} shared a post on Lovio`).trim();
      const description = rawCaption.length > 200 ? rawCaption.slice(0, 197) + "…" : rawCaption;
      const ogImage = firstImage?.url || `${siteUrl}/assets/og-default.jpg`;
      const title = `${escapeHtml(post.display_name)} on Lovio`;

      res.set("Content-Type", "text/html");
      return res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${title}</title>
<meta name="description" content="${escapeHtml(description)}">

<meta property="og:type" content="${firstVideo ? "video.other" : "article"}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:image" content="${ogImage}">
<meta property="og:url" content="${shareUrl}">
<meta property="og:site_name" content="Lovio">
${firstVideo ? `<meta property="og:video" content="${firstVideo.url}">
<meta property="og:video:type" content="video/mp4">` : ""}

<meta name="twitter:card" content="${firstVideo ? "player" : "summary_large_image"}">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<meta name="twitter:image" content="${ogImage}">

<link rel="canonical" href="${postUrl}">
<meta http-equiv="refresh" content="0; url=${postUrl}">
<script>window.location.replace(${JSON.stringify(postUrl)});</script>
</head>
<body>
  <p>Redirecting to <a href="${postUrl}">Lovio</a>…</p>
</body>
</html>`);

    } catch (err) {
      console.error("RENDER SHARE ERROR:", err);
      return res.status(500).send("Something went wrong");
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