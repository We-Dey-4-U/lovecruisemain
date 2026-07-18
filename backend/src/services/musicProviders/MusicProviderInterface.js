// backend/src/services/musicProviders/MusicProviderInterface.js
//
// Every music source in the radio module — the host's own upload
// library, or an external licensed/royalty-free catalog (Jamendo,
// 7digital, Free Music Archive, ccMixter, ...) — implements this
// same interface. Controllers and the queue/request system only
// ever talk to a MusicProviderInterface; they never know or care
// whether a track is a local S3 file or a remote licensed stream.
//
// To add a new provider: create a class extending this one in
// this folder, implement every method below, then register it in
// ./index.js. Nothing else in the codebase needs to change.
//
// Every method returns a common "song shape":
//   {
//     id,                 // provider-local id: radio_songs.id for
//                          // 'local', or the provider's own track
//                          // id (string) for external providers
//     source,              // 'upload' | 'external'
//     provider,             // provider key, e.g. 'local' | 'jamendo'
//     title, artist, album, genre,
//     durationSeconds,
//     coverUrl,
//     streamUrl,            // playable URL — S3 file for uploads,
//                            // provider CDN URL for external
//     previewUrl,           // short preview clip if available (external only)
//     isLicensedExternal    // true for anything NOT owned/uploaded by the host
//   }

class MusicProviderInterface {
  /**
   * @param {string} query - free text search (title/artist/album)
   * @param {object} opts  - { genre, page, pageSize, requesterId, stationId }
   * @returns {Promise<Array<object>>} array of song-shape objects
   */
  async searchSongs(query, opts = {}) {
    throw new Error("searchSongs() not implemented");
  }

  /**
   * @param {string} id
   * @returns {Promise<object|null>} single song-shape object
   */
  async getSong(id) {
    throw new Error("getSong() not implemented");
  }

  /**
   * Resolves a playable stream URL for a track. For uploads this is
   * just the stored S3 URL. For external providers this may need to
   * call the provider's API to sign/refresh a stream URL, since many
   * licensed providers expire stream links after a short TTL.
   * @param {string} id
   * @returns {Promise<{streamUrl: string, expiresAt: Date|null}>}
   */
  async streamSong(id) {
    throw new Error("streamSong() not implemented");
  }

  /**
   * @param {string} playlistId
   * @returns {Promise<{id: string, name: string, songs: Array<object>}>}
   */
  async getPlaylist(playlistId) {
    throw new Error("getPlaylist() not implemented");
  }

  /**
   * @returns {Promise<Array<{key: string, label: string}>>}
   */
  async getGenres() {
    throw new Error("getGenres() not implemented");
  }
}

module.exports = MusicProviderInterface;