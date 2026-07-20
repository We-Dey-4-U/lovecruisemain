require("dotenv").config();
const db = require("../src/config/db");

async function deleteAllStations() {
  try {
    console.log("======================================");
    console.log("Deleting all radio stations...");
    console.log("======================================");

    await db.query(`
      TRUNCATE TABLE
        radio_poll_votes,
        radio_polls,
        radio_cohosts,
        radio_listener_history,
        radio_listeners,
        radio_messages,
        radio_song_likes,
        radio_song_request_votes,
        radio_song_requests,
        radio_queue_items,
        radio_current_playback,
        radio_playlist_songs,
        radio_playlists,
        radio_broadcasts,
        radio_shows,
        radio_station_follows,
        radio_station_subscriptions,
        radio_stations
      RESTART IDENTITY CASCADE;
    `);

    console.log("======================================");
    console.log("✅ All radio stations deleted.");
    console.log("======================================");

    process.exit(0);

  } catch (err) {
    console.error("❌ Delete failed");
    console.error(err);
    process.exit(1);
  }
}

deleteAllStations();