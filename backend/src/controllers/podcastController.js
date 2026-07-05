const PodcastService = require("../services/podcastService");
//const PodcastService = require("../services/podcast.service");

/* ============================================================
   HELPER — send notification (best-effort, never throws)
============================================================ */
async function notify(io, db, { userId, type, title, body, refId, refType }) {
  try {
    if (!userId) return;
    await db.query(
      `INSERT INTO notifications (user_id, type, title, body, ref_id, ref_type)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [userId, type, title, body, refId || null, refType || null]
    );
    if (io) io.to(`user:${userId}`).emit("notification:new", { type, title, body });
  } catch {}
}

/* ============================================================
   SHOWS
============================================================ */
const createShow = async (req, res, next) => {
  try {
    const { title, description, category, cover_url, language, explicit } = req.body;
    if (!title) return res.status(400).json({ success: false, message: "title is required" });

    const show = await PodcastService.createShow({
      hostId: req.user.id,
      title, description, category, coverUrl: cover_url, language, explicit
    });

    return res.status(201).json({ success: true, data: show });
  } catch (err) {
    next(err);
  }
};

const getShow = async (req, res, next) => {
  try {
    const show = await PodcastService.getShowById(req.params.id, req.user?.id);
    if (!show) return res.status(404).json({ success: false, message: "Show not found" });
    return res.json({ success: true, data: show });
  } catch (err) {
    next(err);
  }
};

const updateShow = async (req, res, next) => {
  try {
    const show = await PodcastService.updateShow(req.params.id, req.user.id, req.body);
    if (!show) return res.status(404).json({ success: false, message: "Show not found or not yours" });
    return res.json({ success: true, data: show });
  } catch (err) {
    next(err);
  }
};

const deleteShow = async (req, res, next) => {
  try {
    const ok = await PodcastService.deleteShow(req.params.id, req.user.id);
    if (!ok) return res.status(404).json({ success: false, message: "Show not found or not yours" });
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
};

const getMyShows = async (req, res, next) => {
  try {
    const shows = await PodcastService.getMyShows(req.user.id);
    return res.json({ success: true, data: shows });
  } catch (err) {
    next(err);
  }
};

const listShows = async (req, res, next) => {
  try {
    const pagination = PodcastService.paginationParams(req.query);
    const shows = await PodcastService.listShows(pagination, req.user?.id);
    return res.json({ success: true, data: shows });
  } catch (err) {
    next(err);
  }
};

const getTrendingShows = async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const shows = await PodcastService.getTrendingShows({ limit });
    return res.json({ success: true, data: shows });
  } catch (err) {
    next(err);
  }
};

/* ============================================================
   FOLLOWS
============================================================ */
const followShow = async (req, res, next) => {
  try {
    await PodcastService.followShow(req.params.id, req.user.id);

    // notify show host
    const db   = require("../config/db");
    const io   = req.app.get("io");
    const show = await PodcastService.getShowById(req.params.id);

    if (show && show.host_id !== req.user.id) {
      await notify(io, db, {
        userId:  show.host_id,
        type:    "podcast_follow",
        title:   "New follower",
        body:    `Someone started following your show "${show.title}"`,
        refId:   show.id,
        refType: "podcast_show"
      });
    }

    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
};

const unfollowShow = async (req, res, next) => {
  try {
    await PodcastService.unfollowShow(req.params.id, req.user.id);
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
};

/* ============================================================
   EPISODES
============================================================ */
const createEpisode = async (req, res, next) => {
  try {
    const {
      show_id, title, description, audio_url,
      cover_url, duration_seconds, season_number, episode_number
    } = req.body;

    if (!title)     return res.status(400).json({ success: false, message: "title is required" });
    if (!audio_url) return res.status(400).json({ success: false, message: "audio_url is required" });

    const episode = await PodcastService.createEpisode({
      showId:         show_id || null,
      hostId:         req.user.id,
      title,
      description,
      audioUrl:       audio_url,
      coverUrl:       cover_url,
      durationSeconds: duration_seconds,
      seasonNumber:   season_number,
      episodeNumber:  episode_number
    });

    // notify show followers
    if (show_id) {
      const db = require("../config/db");
      const io = req.app.get("io");
      const show = await PodcastService.getShowById(show_id);

      if (show) {
        const { rows: followers } = await db.query(
          `SELECT user_id FROM podcast_follows WHERE show_id = $1`,
          [show_id]
        );
        for (const { user_id } of followers) {
          if (user_id !== req.user.id) {
            await notify(io, db, {
              userId:  user_id,
              type:    "podcast_episode",
              title:   "New episode",
              body:    `"${show.title}" just posted: ${title}`,
              refId:   episode.id,
              refType: "podcast_episode"
            });
          }
        }
      }
    }

    return res.status(201).json({ success: true, data: episode });
  } catch (err) {
    next(err);
  }
};

const getEpisode = async (req, res, next) => {
  try {
    const episode = await PodcastService.getEpisodeById(req.params.id, req.user?.id);
    if (!episode) return res.status(404).json({ success: false, message: "Episode not found" });
    return res.json({ success: true, data: episode });
  } catch (err) {
    next(err);
  }
};

const updateEpisode = async (req, res, next) => {
  try {
    const episode = await PodcastService.updateEpisode(req.params.id, req.user.id, req.body);
    if (!episode) return res.status(404).json({ success: false, message: "Episode not found or not yours" });
    return res.json({ success: true, data: episode });
  } catch (err) {
    next(err);
  }
};

const deleteEpisode = async (req, res, next) => {
  try {
    const ok = await PodcastService.deleteEpisode(req.params.id, req.user.id);
    if (!ok) return res.status(404).json({ success: false, message: "Episode not found or not yours" });
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
};

const getShowEpisodes = async (req, res, next) => {
  try {
    const pagination = PodcastService.paginationParams(req.query);
    const episodes = await PodcastService.getShowEpisodes(req.params.id, pagination, req.user?.id);
    return res.json({ success: true, data: episodes });
  } catch (err) {
    next(err);
  }
};

const getMyEpisodes = async (req, res, next) => {
  try {
    const pagination = PodcastService.paginationParams(req.query);
    const episodes = await PodcastService.getMyEpisodes(req.user.id, pagination);
    return res.json({ success: true, data: episodes });
  } catch (err) {
    next(err);
  }
};

const getFeed = async (req, res, next) => {
  try {
    const pagination = PodcastService.paginationParams(req.query);
    const episodes = await PodcastService.getFeedEpisodes(pagination, req.user?.id);
    return res.json({ success: true, data: episodes });
  } catch (err) {
    next(err);
  }
};

const getFollowingFeed = async (req, res, next) => {
  try {
    const pagination = PodcastService.paginationParams(req.query);
    const episodes = await PodcastService.getFollowingFeed(pagination, req.user.id);
    return res.json({ success: true, data: episodes });
  } catch (err) {
    next(err);
  }
};

const getTrendingEpisodes = async (req, res, next) => {
  try {
    const pagination = PodcastService.paginationParams(req.query);
    const episodes = await PodcastService.getTrendingEpisodes(pagination, req.user?.id);
    return res.json({ success: true, data: episodes });
  } catch (err) {
    next(err);
  }
};

/* ============================================================
   LIKES
============================================================ */
const toggleLike = async (req, res, next) => {
  try {
    const liked = await PodcastService.toggleLike(req.params.id, req.user.id);

    if (liked) {
      // notify host
      const db = require("../config/db");
      const io = req.app.get("io");
      const ep = await PodcastService.getEpisodeById(req.params.id);

      if (ep && ep.host_id !== req.user.id) {
        await notify(io, db, {
          userId:  ep.host_id,
          type:    "podcast_like",
          title:   "Someone liked your episode",
          body:    `"${ep.title}" got a new like`,
          refId:   ep.id,
          refType: "podcast_episode"
        });
      }
    }

    return res.json({ success: true, liked });
  } catch (err) {
    next(err);
  }
};

/* ============================================================
   LISTENS
============================================================ */
const recordListen = async (req, res, next) => {
  try {
    const { seconds_listened, completed } = req.body;
    await PodcastService.recordListen(req.params.id, req.user?.id, {
      secondsListened: seconds_listened,
      completed
    });
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
};

/* ============================================================
   COMMENTS
============================================================ */
const getComments = async (req, res, next) => {
  try {
    const comments = await PodcastService.getComments(req.params.id);
    return res.json({ success: true, data: comments });
  } catch (err) {
    next(err);
  }
};

const addComment = async (req, res, next) => {
  try {
    const { body, parent_id } = req.body;
    if (!body?.trim()) return res.status(400).json({ success: false, message: "Comment body is required" });

    const comment = await PodcastService.addComment(
      req.params.id,
      req.user.id,
      body.trim(),
      parent_id
    );

    // notify host
    const db = require("../config/db");
    const io = req.app.get("io");
    const ep = await PodcastService.getEpisodeById(req.params.id);

    if (ep && ep.host_id !== req.user.id) {
      await notify(io, db, {
        userId:  ep.host_id,
        type:    "podcast_comment",
        title:   "New comment on your episode",
        body:    `"${ep.title}": ${body.trim().slice(0, 80)}`,
        refId:   ep.id,
        refType: "podcast_episode"
      });
    }

    // if replying, notify the parent commenter
    if (parent_id) {
      const { rows: parent } = await require("../config/db").query(
        `SELECT user_id FROM podcast_comments WHERE id = $1`,
        [parent_id]
      );
      if (parent[0] && parent[0].user_id !== req.user.id) {
        await notify(io, db, {
          userId:  parent[0].user_id,
          type:    "podcast_reply",
          title:   "Someone replied to your comment",
          body:    body.trim().slice(0, 80),
          refId:   ep?.id,
          refType: "podcast_episode"
        });
      }
    }

    return res.status(201).json({ success: true, data: comment });
  } catch (err) {
    next(err);
  }
};

const deleteComment = async (req, res, next) => {
  try {
    const ok = await PodcastService.deleteComment(req.params.commentId, req.user.id);
    if (!ok) return res.status(404).json({ success: false, message: "Comment not found or not yours" });
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
};

/* ============================================================
   CHAPTERS
============================================================ */
const upsertChapter = async (req, res, next) => {
  try {
    const { title, start_seconds } = req.body;
    if (!title || start_seconds === undefined) {
      return res.status(400).json({ success: false, message: "title and start_seconds are required" });
    }

    const chapter = await PodcastService.upsertChapter(
      req.params.id,
      req.user.id,
      { title, startSeconds: start_seconds }
    );
    if (!chapter) return res.status(404).json({ success: false, message: "Episode not found or not yours" });

    return res.status(201).json({ success: true, data: chapter });
  } catch (err) {
    next(err);
  }
};

const deleteChapter = async (req, res, next) => {
  try {
    const ok = await PodcastService.deleteChapter(req.params.chapterId, req.user.id);
    if (!ok) return res.status(404).json({ success: false, message: "Chapter not found or not yours" });
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
};

/* ============================================================
   ANALYTICS
============================================================ */
const getAnalytics = async (req, res, next) => {
  try {
    const stats = await PodcastService.getCreatorStats(req.user.id);
    return res.json({ success: true, data: stats });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  // shows
  createShow, getShow, updateShow, deleteShow,
  getMyShows, listShows, getTrendingShows,
  // follows
  followShow, unfollowShow,
  // episodes
  createEpisode, getEpisode, updateEpisode, deleteEpisode,
  getShowEpisodes, getMyEpisodes,
  getFeed, getFollowingFeed, getTrendingEpisodes,
  // interactions
  toggleLike, recordListen,
  // comments
  getComments, addComment, deleteComment,
  // chapters
  upsertChapter, deleteChapter,
  // analytics
  getAnalytics,
};