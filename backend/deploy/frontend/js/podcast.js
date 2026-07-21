/**
 * podcast.js — Lovio Podcast Module
 * ES module, mirrors the pattern of live.js.
 * Handles: episode playback, comments, gifts, follows,
 *          MediaRecorder recording, upload to API.
 */

import "./api.js";
import "./app.js";

/* ============================================================
   CONSTANTS
============================================================ */
const PLAYBACK_SPEED_STEPS = [0.75, 1, 1.25, 1.5, 2];

/* ============================================================
   STATE
============================================================ */
let currentEpisode   = null;
let currentShow      = null;
let isFollowing      = false;
let coinBalance      = 0;
let GIFT_CATALOG     = [];
let selectedGift     = null;
let activeCommentId  = null;  // episode id for comment modal
let replyToId        = null;
let speedIndex       = 1;     // default 1x

// Recording state (studio page only)
let mediaRecorder    = null;
let recordedChunks   = [];
let recordingStream  = null;
let recordingSeconds = 0;
let recordingTimer   = null;
let isRecording      = false;

/* ============================================================
   HELPERS
============================================================ */
function $(id) { return document.getElementById(id); }

function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

/* ============================================================
   TOAST (re-uses app.js showToast)
============================================================ */
function toast(msg) { window.showToast?.(msg); }

/* ============================================================
   AUDIO PLAYER
   Attaches to a <audio id="podcast-audio"> element.
   Reads episode data from currentEpisode.
============================================================ */
export function initPlayer(episode) {
  currentEpisode = episode;

  const audio = $("podcast-audio");
  if (!audio || !episode?.audio_url) return;

  audio.src = episode.audio_url;
  audio.load();

  // Update UI
  _setEl("player-title",    episode.title        || "Untitled Episode");
  _setEl("player-show",     episode.show_title   || "");
  _setEl("player-duration", formatDuration(episode.duration_seconds));
  _setSrc("player-cover",   episode.cover_url    || episode.show_cover_url || "");

  // Wire events
  audio.addEventListener("timeupdate",  _onTimeUpdate);
  audio.addEventListener("ended",       _onEnded);
  audio.addEventListener("loadedmetadata", () => {
    _setEl("player-duration", formatDuration(audio.duration));
  });

  // Progress bar
  const progress = $("player-progress");
  if (progress) {
    progress.addEventListener("input", () => {
      audio.currentTime = (progress.value / 100) * audio.duration;
    });
  }

  _wirePlayerButtons(audio);
  _loadChapters(episode.chapters || []);
  loadEpisodeComments(episode.id);
}

function _onTimeUpdate() {
  const audio    = $("podcast-audio");
  const progress = $("player-progress");
  const elapsed  = $("player-elapsed");
  if (!audio) return;
  if (progress) progress.value = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
  if (elapsed)  elapsed.textContent = formatDuration(audio.currentTime);
  _updateChapterHighlight(audio.currentTime);
}

function _onEnded() {
  const btn = $("play-pause-btn");
  if (btn) btn.textContent = "▶";
  _markEpisodeListened(currentEpisode?.id);
}

function _wirePlayerButtons(audio) {
  $("play-pause-btn")?.addEventListener("click", () => {
    if (audio.paused) {
      audio.play();
      $("play-pause-btn").textContent = "⏸";
    } else {
      audio.pause();
      $("play-pause-btn").textContent = "▶";
    }
  });

  $("skip-back-btn")?.addEventListener("click",    () => { audio.currentTime = Math.max(0, audio.currentTime - 15); });
  $("skip-forward-btn")?.addEventListener("click", () => { audio.currentTime = Math.min(audio.duration, audio.currentTime + 30); });

  $("speed-btn")?.addEventListener("click", () => {
    speedIndex = (speedIndex + 1) % PLAYBACK_SPEED_STEPS.length;
    audio.playbackRate = PLAYBACK_SPEED_STEPS[speedIndex];
    const btn = $("speed-btn");
    if (btn) btn.textContent = PLAYBACK_SPEED_STEPS[speedIndex] + "×";
  });

  $("mute-btn")?.addEventListener("click", () => {
    audio.muted = !audio.muted;
    const btn = $("mute-btn");
    if (btn) btn.textContent = audio.muted ? "🔇" : "🔊";
  });
}

async function _markEpisodeListened(episodeId) {
  if (!episodeId) return;
  try { await window.api.request(`/podcasts/episodes/${episodeId}/listen`, { method: "POST" }); } catch {}
}

/* ============================================================
   CHAPTERS
============================================================ */
function _loadChapters(chapters) {
  const list = $("chapters-list");
  if (!list || !chapters.length) return;
  list.innerHTML = chapters.map((ch, i) => `
    <div class="chapter-item" data-start="${ch.start_seconds}" data-index="${i}">
      <span class="chapter-time">${formatDuration(ch.start_seconds)}</span>
      <span class="chapter-title">${window.escapeHtml(ch.title)}</span>
    </div>`).join("");
  list.querySelectorAll(".chapter-item").forEach(el => {
    el.addEventListener("click", () => {
      const audio = $("podcast-audio");
      if (audio) { audio.currentTime = +el.dataset.start; audio.play(); }
    });
  });
}

function _updateChapterHighlight(currentTime) {
  const items = document.querySelectorAll(".chapter-item");
  let active = null;
  items.forEach(el => {
    el.classList.remove("active");
    if (+el.dataset.start <= currentTime) active = el;
  });
  if (active) active.classList.add("active");
}

/* ============================================================
   EPISODE FEED
   Renders a list of episode cards into a container.
============================================================ */
export function renderEpisodeList(episodes, containerId = "episodes-list") {
  const container = $(containerId);
  if (!container) return;
  if (!episodes.length) {
    container.innerHTML = `<div class="empty-state"><span>🎙️</span><p>No episodes yet</p></div>`;
    return;
  }
  container.innerHTML = "";
  episodes.forEach(ep => container.appendChild(_buildEpisodeCard(ep)));
}

function _buildEpisodeCard(ep) {
  const el = document.createElement("div");
  el.className = "episode-card";
  el.dataset.id = ep.id;
  el.innerHTML = `
    <div class="ep-cover-wrap">
      <img class="ep-cover" src="${window.escapeHtml(ep.cover_url || ep.show_cover_url || "")}" alt="" onerror="this.style.display='none'">
      <button class="ep-play-btn" data-id="${ep.id}" aria-label="Play episode">▶</button>
    </div>
    <div class="ep-body">
      <div class="ep-show">${window.escapeHtml(ep.show_title || "")}</div>
      <div class="ep-title">${window.escapeHtml(ep.title || "Untitled")}</div>
      <div class="ep-meta">
        <span>${formatDuration(ep.duration_seconds)}</span>
        <span>${window.timeAgo(ep.published_at)}</span>
        <span>👂 ${window.formatCoins(ep.listen_count || 0)}</span>
      </div>
      <div class="ep-desc">${window.escapeHtml((ep.description || "").slice(0, 120))}${(ep.description||"").length > 120 ? "…" : ""}</div>
      <div class="ep-actions">
        <button class="ep-action-btn ep-comment-btn" data-id="${ep.id}" data-count="${ep.comment_count||0}">💬 ${window.formatCoins(ep.comment_count||0)}</button>
        <button class="ep-action-btn ep-like-btn ${ep.is_liked?"liked":""}" data-id="${ep.id}">❤️ ${window.formatCoins(ep.like_count||0)}</button>
        <button class="ep-action-btn ep-share-btn" data-id="${ep.id}">↗ Share</button>
        <button class="ep-action-btn ep-gift-btn" data-id="${ep.id}" data-host="${ep.host_id}">🎁 Gift</button>
        <button class="ep-action-btn ep-download-btn" data-url="${window.escapeHtml(ep.audio_url||"")}">⬇ Save</button>
      </div>
    </div>`;

  el.querySelector(".ep-play-btn").addEventListener("click", () => _playEpisode(ep));
  el.querySelector(".ep-comment-btn").addEventListener("click", () => openCommentModal(ep.id, ep.comment_count||0));
  el.querySelector(".ep-like-btn").addEventListener("click", e => _toggleLike(ep, e.currentTarget));
  el.querySelector(".ep-share-btn").addEventListener("click", () => _shareEpisode(ep.id));
  el.querySelector(".ep-gift-btn").addEventListener("click", () => openGiftSheet(ep.host_id, ep.host_name));
  el.querySelector(".ep-download-btn").addEventListener("click", e => _downloadEpisode(e.currentTarget.dataset.url, ep.title));
  return el;
}

async function _playEpisode(ep) {
  // If a full episode page, navigate. If player exists on page, load inline.
  if ($("podcast-audio")) {
    initPlayer(ep);
    $("podcast-audio").play();
    $("play-pause-btn").textContent = "⏸";
    _scrollToPlayer();
  } else {
    window.location.href = `podcast-listen.html?episode=${ep.id}`;
  }
}

function _scrollToPlayer() {
  const player = document.querySelector(".podcast-player");
  if (player) player.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ============================================================
   SHOW PAGE
============================================================ */
export function renderShowHeader(show) {
  currentShow = show;
  _setSrc("show-cover",   show.cover_url  || "");
  _setEl("show-title",    show.title      || "");
  _setEl("show-host",     show.host_name  || "");
  _setEl("show-desc",     show.description|| "");
  _setEl("show-category", show.category   || "");
  _setEl("show-ep-count", `${show.episode_count || 0} episodes`);
  _setEl("show-followers",window.formatCoins(show.follower_count || 0));

  const followBtn = $("show-follow-btn");
  if (followBtn) {
    isFollowing = show.is_following || false;
    _syncFollowBtn(followBtn);
    followBtn.addEventListener("click", () => _toggleShowFollow(show.id, followBtn));
  }
}

async function _toggleShowFollow(showId, btn) {
  try {
    const method = isFollowing ? "DELETE" : "POST";
    await window.api.request(`/podcasts/shows/${showId}/follow`, { method });
    isFollowing = !isFollowing;
    _syncFollowBtn(btn);
    toast(isFollowing ? "Following show" : "Unfollowed");
  } catch (err) { toast(err.message || "Action failed"); }
}

function _syncFollowBtn(btn) {
  btn.textContent = isFollowing ? "Following" : "Follow";
  btn.classList.toggle("following", isFollowing);
}

/* ============================================================
   LIKE
============================================================ */
async function _toggleLike(ep, btn) {
  const liked = btn.classList.contains("liked");
  btn.classList.toggle("liked", !liked);
  const count = (ep.like_count || 0) + (liked ? -1 : 1);
  ep.like_count = count;
  btn.textContent = `❤️ ${window.formatCoins(count)}`;
  try { await window.api.request(`/podcasts/episodes/${ep.id}/like`, { method: "POST" }); } catch {}
}

/* ============================================================
   SHARE
============================================================ */
function _shareEpisode(episodeId) {
  const url = `${location.origin}/podcast-listen.html?episode=${episodeId}`;
  if (navigator.share) { navigator.share({ url, title: "Listen on Lovio" }).catch(() => {}); }
  else { navigator.clipboard?.writeText(url).then(() => toast("Link copied!")); }
}

/* ============================================================
   DOWNLOAD
============================================================ */
function _downloadEpisode(url, title) {
  if (!url) { toast("No audio file"); return; }
  const a = document.createElement("a");
  a.href     = url;
  a.download = (title || "episode") + ".mp3";
  a.click();
}

/* ============================================================
   COMMENTS
============================================================ */
export function openCommentModal(episodeId, count = 0) {
  activeCommentId = episodeId;
  replyToId       = null;
  _setEl("comment-count-label", count ? `(${window.formatCoins(count)})` : "");
  _show("comment-modal-backdrop");
  document.body.style.overflow = "hidden";
  _loadComments(episodeId);
}

export function closeCommentModal() {
  _hide("comment-modal-backdrop");
  document.body.style.overflow = "";
  activeCommentId = null;
  replyToId       = null;
}

async function _loadComments(episodeId) {
  const list = $("comment-list");
  if (list) list.innerHTML = `<div class="loading-msg">Loading…</div>`;
  try {
    const res = await window.api.request(`/podcasts/episodes/${episodeId}/comments`);
    _renderComments(res.data || []);
  } catch { _renderComments([]); }
}

function _renderComments(comments) {
  const list = $("comment-list");
  if (!list) return;
  if (!comments.length) { list.innerHTML = `<div class="empty-state-sm">No comments yet — be first!</div>`; return; }
  list.innerHTML = comments.map(c => {
    const av = c.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(c.display_name||"U")}&size=40`;
    return `<div class="comment-item">
      <img src="${window.escapeHtml(av)}" class="comment-avatar" data-uid="${c.user_id||""}">
      <div class="comment-body">
        <div class="comment-name">${window.escapeHtml(c.display_name||"User")}</div>
        <div class="comment-text">${window.escapeHtml(c.body||"")}</div>
        <div class="comment-meta">
          <span>${window.timeAgo(c.created_at)}</span>
          <button class="reply-btn" data-id="${c.id}" data-name="${window.escapeHtml(c.display_name||"User")}">Reply</button>
        </div>
      </div>
    </div>`;
  }).join("");
  list.querySelectorAll(".reply-btn").forEach(btn => {
    btn.addEventListener("click", () => _setReply(btn.dataset.id, btn.dataset.name));
  });
  list.querySelectorAll("img[data-uid]").forEach(el => {
    el.addEventListener("click", () => { if (el.dataset.uid) window.location.href = `profile.html?id=${el.dataset.uid}`; });
  });
}

function _setReply(id, name) {
  replyToId = id;
  _setEl("reply-banner-text", `Replying to ${name}`);
  _show("reply-banner");
  $("comment-textarea")?.focus();
}

async function submitComment() {
  const ta   = $("comment-textarea");
  const body = ta?.value.trim();
  if (!body || !activeCommentId) return;
  ta.value = "";
  const rep = replyToId;
  replyToId = null;
  _hide("reply-banner");
  try {
    await window.api.request(`/podcasts/episodes/${activeCommentId}/comments`, {
      method: "POST",
      body:   JSON.stringify({ body, parent_id: rep })
    });
  } catch {}
  _loadComments(activeCommentId);
}

/* Wire comment modal buttons — call from page init */
export function wireCommentModal() {
  $("comment-close-btn")?.addEventListener("click",  closeCommentModal);
  $("clear-reply-btn")?.addEventListener("click",    () => { replyToId = null; _hide("reply-banner"); });
  $("comment-send-btn")?.addEventListener("click",   submitComment);
  $("comment-modal-backdrop")?.addEventListener("click", e => {
    if (e.target === $("comment-modal-backdrop")) closeCommentModal();
  });
  const ta = $("comment-textarea");
  if (ta) {
    ta.addEventListener("input", function() { this.style.height = ""; this.style.height = Math.min(this.scrollHeight, 100) + "px"; });
    ta.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitComment(); } });
  }
}

/* ============================================================
   GIFTS
============================================================ */
export async function openGiftSheet(hostId, hostName = "Creator") {
  if (!GIFT_CATALOG.length) {
    try {
      const r = await window.api.request("/gifts");
      GIFT_CATALOG = (r.data || []).filter(g => g.is_active !== false);
    } catch {
      GIFT_CATALOG = [
        { id:"g1", name:"Rose",     emoji:"🌹", price_coins:5   },
        { id:"g2", name:"Heart",    emoji:"❤️", price_coins:10  },
        { id:"g3", name:"Crown",    emoji:"👑", price_coins:500 },
        { id:"g4", name:"Diamond",  emoji:"💎", price_coins:200 },
        { id:"g5", name:"Ring",     emoji:"💍", price_coins:150 },
        { id:"g6", name:"Fireworks",emoji:"🎆", price_coins:300 }
      ];
    }
  }
  _setEl("gift-target-name",    hostName);
  _setEl("gift-coin-balance",   window.formatCoins(coinBalance));
  const grid = $("gift-grid");
  if (grid) {
    grid.innerHTML = GIFT_CATALOG.map(g => `
      <div class="gift-tile" data-id="${g.id}">
        <span class="gift-emoji">${g.emoji}</span>
        <span class="gift-name">${window.escapeHtml(g.name)}</span>
        <span class="gift-price">${g.price_coins}🪙</span>
      </div>`).join("");
    grid.querySelectorAll(".gift-tile").forEach(t => t.addEventListener("click", () => _selectGift(t.dataset.id)));
  }
  selectedGift = null;
  _disableGiftBtn();
  $("gift-sheet-host-id")?.setAttribute("data-id", hostId || "");
  _show("gift-backdrop");
  _show("gift-sheet");
}

export function closeGiftSheet() {
  _hide("gift-backdrop");
  _hide("gift-sheet");
}

function _selectGift(giftId) {
  selectedGift = GIFT_CATALOG.find(g => String(g.id) === String(giftId));
  document.querySelectorAll(".gift-tile").forEach(t => t.classList.remove("selected"));
  document.querySelector(`.gift-tile[data-id="${giftId}"]`)?.classList.add("selected");
  const btn = $("gift-send-btn");
  if (btn && selectedGift) {
    btn.disabled    = false;
    btn.textContent = `Send ${selectedGift.emoji} ${selectedGift.name} (${selectedGift.price_coins} coins)`;
  }
}

function _disableGiftBtn() {
  const btn = $("gift-send-btn");
  if (btn) { btn.disabled = true; btn.textContent = "Select a gift to send"; }
}

export async function sendGift() {
  if (!selectedGift) return;
  const hostId = $("gift-sheet-host-id")?.dataset.id;
  if (!hostId) { toast("Cannot send gift"); return; }
  if (coinBalance < selectedGift.price_coins) {
    toast("Not enough coins");
    setTimeout(() => { window.location.href = "coins.html"; }, 700);
    return;
  }
  try {
    await window.api.request("/gifts/send", {
      method: "POST",
      body:   JSON.stringify({
        receiverId:  hostId,
        giftId:      selectedGift.id,
        quantity:    1,
        contextType: "podcast"
      })
    });
    coinBalance -= selectedGift.price_coins;
    window.CURRENT_USER.coinBalance = coinBalance;
    localStorage.setItem("currentUser", JSON.stringify(window.CURRENT_USER));
    _setEl("gift-coin-balance", window.formatCoins(coinBalance));
    toast(`${selectedGift.emoji} Gift sent!`);
    closeGiftSheet();
  } catch (err) { toast(err.message || "Gift failed"); }
}

/* Wire gift sheet buttons — call from page init */
export function wireGiftSheet() {
  $("gift-backdrop")?.addEventListener("click", closeGiftSheet);
  $("gift-send-btn")?.addEventListener("click",  sendGift);
}

/* ============================================================
   STUDIO — RECORDING
============================================================ */
export async function startRecording() {
  if (isRecording) return;
  try {
    recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordedChunks  = [];

    // Prefer high-quality audio; fall back gracefully
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";

    mediaRecorder = new MediaRecorder(recordingStream, { mimeType });

    mediaRecorder.addEventListener("dataavailable", e => {
      if (e.data.size > 0) recordedChunks.push(e.data);
    });

    mediaRecorder.addEventListener("stop", _onRecordingStop);

    mediaRecorder.start(1000); // collect chunks every second
    isRecording      = true;
    recordingSeconds = 0;

    recordingTimer = setInterval(() => {
      recordingSeconds++;
      _setEl("recording-timer", formatDuration(recordingSeconds));
      _setEl("recording-size",  formatBytes(recordedChunks.reduce((s, c) => s + c.size, 0)));
    }, 1000);

    _setEl("rec-btn-label", "Stop");
    $("rec-btn")?.classList.add("recording");
    _setEl("recording-status", "● Recording");
    toast("Recording started");
  } catch (err) {
    toast("Microphone access denied");
    console.error("[podcast] startRecording:", err);
  }
}

export function stopRecording() {
  if (!isRecording || !mediaRecorder) return;
  mediaRecorder.stop();
  clearInterval(recordingTimer);
  isRecording = false;
  _setEl("rec-btn-label", "Record");
  $("rec-btn")?.classList.remove("recording");
  _setEl("recording-status", "Stopped");
  recordingStream?.getTracks().forEach(t => t.stop());
}

function _onRecordingStop() {
  if (!recordedChunks.length) return;
  const blob = new Blob(recordedChunks, { type: "audio/webm" });
  const url  = URL.createObjectURL(blob);

  // Show preview
  const preview = $("recording-preview");
  if (preview) { preview.src = url; preview.style.display = "block"; }
  _show("recording-actions");

  // Expose blob for upload
  window._podcastBlob = blob;
  toast(`Recording ready — ${formatDuration(recordingSeconds)}`);
}

export function discardRecording() {
  window._podcastBlob = null;
  recordedChunks = [];
  const preview = $("recording-preview");
  if (preview) { preview.src = ""; preview.style.display = "none"; }
  _hide("recording-actions");
  _setEl("recording-timer", "0:00");
  _setEl("recording-status", "Ready");
  toast("Recording discarded");
}

/* ============================================================
   STUDIO — UPLOAD EPISODE
============================================================ */
export async function uploadEpisode(formData) {
  const btn = $("publish-btn");
  if (btn) { btn.disabled = true; btn.textContent = "Publishing…"; }

  const title       = $("ep-title")?.value.trim();
  const description = $("ep-description")?.value.trim();
  const showId      = $("ep-show-select")?.value;
  const season      = $("ep-season")?.value  || 1;
  const number      = $("ep-number")?.value  || null;

  if (!title) { toast("Episode title required"); _resetPublishBtn(btn); return; }

  try {
    let audioFile = null;

    // Prefer recorded blob; fall back to file input
    if (window._podcastBlob) {
      audioFile = new File([window._podcastBlob], "recording.webm", { type: "audio/webm" });
    } else {
      const fileInput = $("ep-audio-file");
      audioFile = fileInput?.files?.[0] || null;
    }

    if (!audioFile) { toast("No audio file selected"); _resetPublishBtn(btn); return; }

    // Step 1: upload audio
    const uploadRes  = await window.api.uploadFile(audioFile);
    const audioUrl   = uploadRes.data?.url || uploadRes.url;

    // Step 2: upload cover if provided
    let coverUrl = null;
    const coverInput = $("ep-cover-file");
    if (coverInput?.files?.[0]) {
      const cRes = await window.api.uploadFile(coverInput.files[0]);
      coverUrl   = cRes.data?.url || cRes.url;
    }

    // Step 3: create episode record
    await window.api.request("/podcasts/episodes", {
      method: "POST",
      body:   JSON.stringify({
        show_id:      showId   || null,
        title,
        description:  description || "",
        audio_url:    audioUrl,
        cover_url:    coverUrl,
        season_number: +season,
        episode_number: number ? +number : null
      })
    });

    toast("Episode published! 🎙️");
    discardRecording();
    window._podcastBlob = null;
    setTimeout(() => { window.location.href = "podcast-studio.html"; }, 1200);
  } catch (err) {
    toast(err.message || "Publish failed");
    _resetPublishBtn(btn);
  }
}

function _resetPublishBtn(btn) {
  if (btn) { btn.disabled = false; btn.textContent = "Publish Episode"; }
}

/* ============================================================
   STUDIO — SHOWS
============================================================ */
export async function loadMyShows() {
  try {
    const res = await window.api.request("/podcasts/shows/mine");
    return res.data || [];
  } catch { return []; }
}

export async function createShow(payload) {
  const btn = $("create-show-btn");
  if (btn) { btn.disabled = true; btn.textContent = "Creating…"; }
  try {
    const res = await window.api.request("/podcasts/shows", {
      method: "POST",
      body:   JSON.stringify(payload)
    });
    toast("Show created!");
    return res.data;
  } catch (err) {
    toast(err.message || "Failed to create show");
    return null;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Create Show"; }
  }
}

/* ============================================================
   API LOADERS (used by pages)
============================================================ */
export async function fetchFeedEpisodes({ limit = 20, offset = 0 } = {}) {
  const res = await window.api.request(`/podcasts/feed?limit=${limit}&offset=${offset}`);
  return res.data || [];
}

export async function fetchShowEpisodes(showId, { limit = 20, offset = 0 } = {}) {
  const res = await window.api.request(`/podcasts/shows/${showId}/episodes?limit=${limit}&offset=${offset}`);
  return res.data || [];
}

export async function fetchEpisode(episodeId) {
  const res = await window.api.request(`/podcasts/episodes/${episodeId}`);
  return res.data;
}

export async function fetchShow(showId) {
  const res = await window.api.request(`/podcasts/shows/${showId}`);
  return res.data;
}

export async function fetchTrendingShows({ limit = 10 } = {}) {
  const res = await window.api.request(`/podcasts/shows/trending?limit=${limit}`);
  return res.data || [];
}

/* ============================================================
   INIT COIN BALANCE
============================================================ */
export function initCoinBalance() {
  coinBalance = Number(
    window.CURRENT_USER?.coinBalance ??
    window.CURRENT_USER?.coin_balance ?? 0
  );
}

/* ============================================================
   DOM UTILS
============================================================ */
function _setEl(id, text) { const el = $(id); if (el) el.textContent = text; }
function _setSrc(id, src) { const el = $(id); if (el) el.src = src; }
function _show(id)        { const el = $(id); if (el) el.style.display = ""; }
function _hide(id)        { const el = $(id); if (el) el.style.display = "none"; }

/* ============================================================
   WINDOW EXPORTS (for inline scripts on pages)
============================================================ */
window.podcast = {
  initPlayer, renderEpisodeList, renderShowHeader,
  openCommentModal, closeCommentModal, wireCommentModal, submitComment,
  openGiftSheet, closeGiftSheet, sendGift, wireGiftSheet,
  startRecording, stopRecording, discardRecording, uploadEpisode,
  loadMyShows, createShow,
  fetchFeedEpisodes, fetchShowEpisodes, fetchEpisode, fetchShow, fetchTrendingShows,
  initCoinBalance
};