const express = require("express");
const router = express.Router();

const MusicLibraryController = require("../controllers/musicLibraryController");
const { requireAuth } = require("../middlewares/auth");
const audioUpload = require("../middlewares/audioUpload");

/* SONGS */
router.post("/songs/upload", requireAuth, audioUpload, MusicLibraryController.uploadSong);
router.get("/songs/:id", requireAuth, MusicLibraryController.getSong);
router.patch("/songs/:id", requireAuth, MusicLibraryController.updateSong);
router.delete("/songs/:id", requireAuth, MusicLibraryController.deleteSong);
router.post("/songs/:id/like", requireAuth, MusicLibraryController.likeSong);
router.delete("/songs/:id/like", requireAuth, MusicLibraryController.unlikeSong);

/* SEARCH / METADATA (across local + external providers) */
router.get("/search", requireAuth, MusicLibraryController.searchSongs);
router.get("/genres", requireAuth, MusicLibraryController.listGenres);
router.get("/providers", requireAuth, MusicLibraryController.listAvailableProviders);

/* PLAYLISTS */
router.post("/playlists", requireAuth, MusicLibraryController.createPlaylist);
router.get("/playlists", requireAuth, MusicLibraryController.listPlaylists);
router.get("/playlists/:id", requireAuth, MusicLibraryController.getPlaylist);
router.post("/playlists/:id/songs", requireAuth, MusicLibraryController.addSongToPlaylist);
router.delete("/playlists/:id/songs/:songId", requireAuth, MusicLibraryController.removeSongFromPlaylist);

module.exports = router;