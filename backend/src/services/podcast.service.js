const db = require("../config/db");

/* ============================================================
   HELPERS
============================================================ */
function paginationParams(query) {
  const limit  = Math.min(Math.max(parseInt(query.limit)  || 20, 1), 100);
  const offset = Math.max(parseInt(query.offset) || 0, 0);
  return { limit, offset };
}

/* ============================================================
   SHOWS
============================================================ */
async function createShow({ hostId, title, description, category, coverUrl, language, explicit }) {
  const { rows } = await db.query(
    `INSERT INTO podcast_shows
       (host_id, title, description, category, cover_url, language, explicit)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
    [hostId, title, description || "", category || null, coverUrl || null, language || "English", explicit || false]
  );
  return rows[0];
}

async function getShowById(showId, currentUserId = null) {
  const { rows } = await db.query(
    `SELECT
       s.*,
       u.display_name AS host_name,
       u.avatar_url   AS host_avatar,
       ${currentUserId
         ? `EXISTS(SELECT 1 FROM podcast_follows f WHERE f.show_id = s.id AND f.user_id = $2) AS is_following`
         : `FALSE AS is_following`}
     FROM podcast_shows s
     JOIN users u ON u.id = s.host_id
     WHERE s.id = $1`,
    currentUserId ? [showId, currentUserId] : [showId]
  );
  return rows[0] || null;
}

async function updateShow(showId, hostId, fields) {
  const allowed = ["title", "description", "category", "cover_url", "language", "explicit"];
  const sets    = [];
  const vals    = [];
  let   idx     = 1;

  for (const key of allowed) {
    if (fields[key] !== undefined) {
      sets.push(`${key} = $${idx++}`);
      vals.push(fields[key]);
    }
  }
  if (!sets.length) return null;

  sets.push(`updated_at = NOW()`);
  vals.push(showId, hostId);

  const { rows } = await db.query(
    `UPDATE podcast_shows SET ${sets.join(", ")}
     WHERE id = $${idx++} AND host_id = $${idx}
     RETURNING *`,
    vals
  );
  return rows[0] || null;
}

async function deleteShow(showId, hostId) {
  const { rowCount } = await db.query(
    `DELETE FROM podcast_shows WHERE id = $1 AND host_id = $2`,
    [showId, hostId]
  );
  return rowCount > 0;
}

async function getMyShows(hostId) {
  const { rows } = await db.query(
    `SELECT s.*, u.display_name AS host_name
     FROM podcast_shows s
     JOIN users u ON u.id = s.host_id
     WHERE s.host_id = $1
     ORDER BY s.created_at DESC`,
    [hostId]
  );
  return rows;
}

async function listShows({ limit, offset }, currentUserId = null) {
  const { rows } = await db.query(
    `SELECT
       s.*,
       u.display_name AS host_name,
       u.avatar_url   AS host_avatar,
       ${currentUserId
         ? `EXISTS(SELECT 1 FROM podcast_follows f WHERE f.show_id = s.id AND f.user_id = $3) AS is_following`
         : `FALSE AS is_following`}
     FROM podcast_shows s
     JOIN users u ON u.id = s.host_id
     ORDER BY s.follower_count DESC, s.created_at DESC
     LIMIT $1 OFFSET $2`,
    currentUserId ? [limit, offset, currentUserId] : [limit, offset]
  );
  return rows;
}

async function getTrendingShows({ limit }) {
  const { rows } = await db.query(
    `SELECT
       s.*,
       u.display_name AS host_name,
       u.avatar_url   AS host_avatar
     FROM podcast_shows s
     JOIN users u ON u.id = s.host_id
     ORDER BY s.follower_count DESC, s.episode_count DESC, s.created_at DESC
     LIMIT $1`,
    [limit]
  );
  return rows;
}

/* ============================================================
   FOLLOWS
============================================================ */
async function followShow(showId, userId) {
  await db.query(
    `INSERT INTO podcast_follows (show_id, user_id)
     VALUES ($1, $2)
     ON CONFLICT (show_id, user_id) DO NOTHING`,
    [showId, userId]
  );
}

async function unfollowShow(showId, userId) {
  await db.query(
    `DELETE FROM podcast_follows WHERE show_id = $1 AND user_id = $2`,
    [showId, userId]
  );
}

/* ============================================================
   EPISODES
============================================================ */
async function createEpisode({
  showId, hostId, title, description, audioUrl,
  coverUrl, durationSeconds, seasonNumber, episodeNumber
}) {
  // auto-assign episode number within show/season if not provided
  if (!episodeNumber && showId) {
    const { rows } = await db.query(
      `SELECT COALESCE(MAX(episode_number), 0) + 1 AS next_num
       FROM podcast_episodes
       WHERE show_id = $1 AND season_number = $2`,
      [showId, seasonNumber || 1]
    );
    episodeNumber = rows[0].next_num;
  } else if (!episodeNumber) {
    episodeNumber = 1;
  }

  const { rows } = await db.query(
    `INSERT INTO podcast_episodes
       (show_id, host_id, title, description, audio_url, cover_url,
        duration_seconds, season_number, episode_number)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING *`,
    [
      showId || null, hostId, title, description || "", audioUrl,
      coverUrl || null, durationSeconds || 0, seasonNumber || 1, episodeNumber
    ]
  );
  return rows[0];
}

async function getEpisodeById(episodeId, currentUserId = null) {
  const { rows } = await db.query(
    `SELECT
       e.*,
       u.display_name  AS host_name,
       u.avatar_url    AS host_avatar,
       s.title         AS show_title,
       s.cover_url     AS show_cover_url,
       ${currentUserId
         ? `EXISTS(SELECT 1 FROM podcast_likes l WHERE l.episode_id = e.id AND l.user_id = $2) AS is_liked`
         : `FALSE AS is_liked`}
     FROM podcast_episodes e
     JOIN users u ON u.id = e.host_id
     LEFT JOIN podcast_shows s ON s.id = e.show_id
     WHERE e.id = $1`,
    currentUserId ? [episodeId, currentUserId] : [episodeId]
  );

  if (!rows[0]) return null;

  // attach chapters
  const { rows: chapters } = await db.query(
    `SELECT * FROM podcast_chapters WHERE episode_id = $1 ORDER BY start_seconds ASC`,
    [episodeId]
  );
  return { ...rows[0], chapters };
}

async function updateEpisode(episodeId, hostId, fields) {
  const allowed = ["title", "description", "cover_url", "duration_seconds", "season_number", "episode_number", "published_at"];
  const sets    = [];
  const vals    = [];
  let   idx     = 1;

  for (const key of allowed) {
    if (fields[key] !== undefined) {
      sets.push(`${key} = $${idx++}`);
      vals.push(fields[key]);
    }
  }
  if (!sets.length) return null;

  sets.push(`updated_at = NOW()`);
  vals.push(episodeId, hostId);

  const { rows } = await db.query(
    `UPDATE podcast_episodes SET ${sets.join(", ")}
     WHERE id = $${idx++} AND host_id = $${idx}
     RETURNING *`,
    vals
  );
  return rows[0] || null;
}

async function deleteEpisode(episodeId, hostId) {
  const { rowCount } = await db.query(
    `DELETE FROM podcast_episodes WHERE id = $1 AND host_id = $2`,
    [episodeId, hostId]
  );
  return rowCount > 0;
}

async function getShowEpisodes(showId, { limit, offset }, currentUserId = null) {
  const { rows } = await db.query(
    `SELECT
       e.*,
       u.display_name AS host_name,
       s.title        AS show_title,
       s.cover_url    AS show_cover_url,
       ${currentUserId
         ? `EXISTS(SELECT 1 FROM podcast_likes l WHERE l.episode_id = e.id AND l.user_id = $4) AS is_liked`
         : `FALSE AS is_liked`}
     FROM podcast_episodes e
     JOIN users u ON u.id = e.host_id
     LEFT JOIN podcast_shows s ON s.id = e.show_id
     WHERE e.show_id = $1
     ORDER BY e.season_number ASC, e.episode_number ASC
     LIMIT $2 OFFSET $3`,
    currentUserId ? [showId, limit, offset, currentUserId] : [showId, limit, offset]
  );
  return rows;
}

async function getMyEpisodes(hostId, { limit, offset }) {
  const { rows } = await db.query(
    `SELECT
       e.*,
       s.title     AS show_title,
       s.cover_url AS show_cover_url
     FROM podcast_episodes e
     LEFT JOIN podcast_shows s ON s.id = e.show_id
     WHERE e.host_id = $1
     ORDER BY e.created_at DESC
     LIMIT $2 OFFSET $3`,
    [hostId, limit, offset]
  );
  return rows;
}

async function getFeedEpisodes({ limit, offset }, currentUserId = null) {
  const { rows } = await db.query(
    `SELECT
       e.*,
       u.display_name AS host_name,
       u.avatar_url   AS host_avatar,
       s.title        AS show_title,
       s.cover_url    AS show_cover_url,
       ${currentUserId
         ? `EXISTS(SELECT 1 FROM podcast_likes l WHERE l.episode_id = e.id AND l.user_id = $3) AS is_liked`
         : `FALSE AS is_liked`}
     FROM podcast_episodes e
     JOIN users u ON u.id = e.host_id
     LEFT JOIN podcast_shows s ON s.id = e.show_id
     ORDER BY e.published_at DESC
     LIMIT $1 OFFSET $2`,
    currentUserId ? [limit, offset, currentUserId] : [limit, offset]
  );
  return rows;
}

async function getFollowingFeed({ limit, offset }, userId) {
  const { rows } = await db.query(
    `SELECT
       e.*,
       u.display_name AS host_name,
       u.avatar_url   AS host_avatar,
       s.title        AS show_title,
       s.cover_url    AS show_cover_url,
       EXISTS(SELECT 1 FROM podcast_likes l WHERE l.episode_id = e.id AND l.user_id = $3) AS is_liked
     FROM podcast_episodes e
     JOIN users u ON u.id = e.host_id
     LEFT JOIN podcast_shows s ON s.id = e.show_id
     WHERE e.show_id IN (
       SELECT show_id FROM podcast_follows WHERE user_id = $3
     )
     ORDER BY e.published_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset, userId]
  );
  return rows;
}

async function getTrendingEpisodes({ limit, offset }, currentUserId = null) {
  const { rows } = await db.query(
    `SELECT
       e.*,
       u.display_name AS host_name,
       u.avatar_url   AS host_avatar,
       s.title        AS show_title,
       s.cover_url    AS show_cover_url,
       ${currentUserId
         ? `EXISTS(SELECT 1 FROM podcast_likes l WHERE l.episode_id = e.id AND l.user_id = $3) AS is_liked`
         : `FALSE AS is_liked`}
     FROM podcast_episodes e
     JOIN users u ON u.id = e.host_id
     LEFT JOIN podcast_shows s ON s.id = e.show_id
     ORDER BY (e.listen_count * 2 + e.like_count * 3 + e.comment_count) DESC, e.published_at DESC
     LIMIT $1 OFFSET $2`,
    currentUserId ? [limit, offset, currentUserId] : [limit, offset]
  );
  return rows;
}

/* ============================================================
   LIKES
============================================================ */
async function toggleLike(episodeId, userId) {
  // returns true = liked, false = unliked
  const { rows: existing } = await db.query(
    `SELECT id FROM podcast_likes WHERE episode_id = $1 AND user_id = $2`,
    [episodeId, userId]
  );

  if (existing[0]) {
    await db.query(
      `DELETE FROM podcast_likes WHERE episode_id = $1 AND user_id = $2`,
      [episodeId, userId]
    );
    return false;
  } else {
    await db.query(
      `INSERT INTO podcast_likes (episode_id, user_id) VALUES ($1, $2)
       ON CONFLICT (episode_id, user_id) DO NOTHING`,
      [episodeId, userId]
    );
    return true;
  }
}

/* ============================================================
   LISTENS
============================================================ */
async function recordListen(episodeId, userId, { secondsListened, completed } = {}) {
  await db.query(
    `INSERT INTO podcast_listens (episode_id, user_id, seconds_listened, completed)
     VALUES ($1, $2, $3, $4)`,
    [episodeId, userId || null, secondsListened || 0, completed || false]
  );
}

/* ============================================================
   COMMENTS
============================================================ */
async function getComments(episodeId) {
  const { rows } = await db.query(
    `SELECT
       c.*,
       u.display_name AS display_name,
       u.avatar_url   AS avatar_url
     FROM podcast_comments c
     JOIN users u ON u.id = c.user_id
     WHERE c.episode_id = $1
     ORDER BY c.created_at ASC`,
    [episodeId]
  );
  return rows;
}

async function addComment(episodeId, userId, body, parentId = null) {
  const { rows } = await db.query(
    `INSERT INTO podcast_comments (episode_id, user_id, body, parent_id)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [episodeId, userId, body, parentId || null]
  );

  // fetch with user info
  const { rows: full } = await db.query(
    `SELECT c.*, u.display_name, u.avatar_url
     FROM podcast_comments c
     JOIN users u ON u.id = c.user_id
     WHERE c.id = $1`,
    [rows[0].id]
  );
  return full[0];
}

async function deleteComment(commentId, userId) {
  const { rowCount } = await db.query(
    `DELETE FROM podcast_comments WHERE id = $1 AND user_id = $2`,
    [commentId, userId]
  );
  return rowCount > 0;
}

/* ============================================================
   CHAPTERS
============================================================ */
async function upsertChapter(episodeId, hostId, { title, startSeconds }) {
  // verify ownership
  const { rows: ep } = await db.query(
    `SELECT id FROM podcast_episodes WHERE id = $1 AND host_id = $2`,
    [episodeId, hostId]
  );
  if (!ep[0]) return null;

  const { rows } = await db.query(
    `INSERT INTO podcast_chapters (episode_id, title, start_seconds)
     VALUES ($1, $2, $3)
     ON CONFLICT (episode_id, start_seconds)
     DO UPDATE SET title = EXCLUDED.title
     RETURNING *`,
    [episodeId, title, startSeconds]
  );
  return rows[0];
}

async function deleteChapter(chapterId, hostId) {
  const { rowCount } = await db.query(
    `DELETE FROM podcast_chapters ch
     USING podcast_episodes ep
     WHERE ch.id = $1
       AND ch.episode_id = ep.id
       AND ep.host_id = $2`,
    [chapterId, hostId]
  );
  return rowCount > 0;
}

/* ============================================================
   ANALYTICS (creator dashboard)
============================================================ */
async function getCreatorStats(hostId) {
  const { rows: shows } = await db.query(
    `SELECT
       COUNT(*)                       AS total_shows,
       COALESCE(SUM(follower_count),0) AS total_followers,
       COALESCE(SUM(episode_count),0)  AS total_episodes
     FROM podcast_shows
     WHERE host_id = $1`,
    [hostId]
  );

  const { rows: episodes } = await db.query(
    `SELECT
       COUNT(*)                         AS episode_count,
       COALESCE(SUM(listen_count),0)    AS total_listens,
       COALESCE(SUM(like_count),0)      AS total_likes,
       COALESCE(SUM(comment_count),0)   AS total_comments
     FROM podcast_episodes
     WHERE host_id = $1`,
    [hostId]
  );

  const { rows: topEp } = await db.query(
    `SELECT id, title, listen_count, like_count, cover_url
     FROM podcast_episodes
     WHERE host_id = $1
     ORDER BY listen_count DESC
     LIMIT 1`,
    [hostId]
  );

  const { rows: recentComments } = await db.query(
    `SELECT c.*, u.display_name, u.avatar_url, e.title AS episode_title
     FROM podcast_comments c
     JOIN users u ON u.id = c.user_id
     JOIN podcast_episodes e ON e.id = c.episode_id
     WHERE e.host_id = $1
     ORDER BY c.created_at DESC
     LIMIT 5`,
    [hostId]
  );

  return {
    shows:          shows[0],
    episodes:       episodes[0],
    top_episode:    topEp[0] || null,
    recent_comments: recentComments
  };
}

module.exports = {
  // shows
  createShow, getShowById, updateShow, deleteShow,
  getMyShows, listShows, getTrendingShows,
  // follows
  followShow, unfollowShow,
  // episodes
  createEpisode, getEpisodeById, updateEpisode, deleteEpisode,
  getShowEpisodes, getMyEpisodes, getFeedEpisodes,
  getFollowingFeed, getTrendingEpisodes,
  // interactions
  toggleLike, recordListen,
  // comments
  getComments, addComment, deleteComment,
  // chapters
  upsertChapter, deleteChapter,
  // analytics
  getCreatorStats,
  // helpers
  paginationParams,
};