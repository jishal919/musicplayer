// ===== CONSTANTS =====
const API_BASE = 'https://terminal-music-api.vercel.app/api';

// ===== STATE =====
const DATA_URL = '/data.json';
const DATA_URL_FALLBACK = 'data.json';
let musicData = {};
let playlists = [];
let currentPlaylist = null;
let currentSongs = [];
let queue = [];
let queueIndex = -1;
let isPlaying = false;
let isShuffle = false;
let repeatMode = 0; // 0=off 1=all 2=one
let isMuted = false;
let prevVol = 80;
let liked = {};
let recentlyPlayed = [];
let searchQuery = '';
let apiResults = []; // New state for API search results
let seeking = false;
let fpSeeking = false;
let volumeDragging = false;
let fullOpen = false;
let queueOpen = false;

// ===== DOM CACHE =====
const dom = {
  audio: document.getElementById('audio-el'),
  loading: document.getElementById('loading'),
  sidebar: document.getElementById('sidebar'),
  sidebarOverlay: document.getElementById('sidebar-overlay'),
  playlistNav: document.getElementById('playlist-nav'),
  playlistGrid: document.getElementById('playlist-grid'),
  homeView: document.getElementById('home-view'),
  songView: document.getElementById('song-view'),
  svName: document.getElementById('sv-name'),
  svCount: document.getElementById('sv-count'),
  svThumbWrap: document.getElementById('sv-thumb-wrap'),
  songList: document.getElementById('song-list'),
  player: document.getElementById('player'),
  playerName: document.getElementById('player-name'),
  playerArtist: document.getElementById('player-artist'),
  playerAddedBy: document.getElementById('player-added-by'),
  playerThumb: document.getElementById('player-thumb'),
  playerHeart: document.getElementById('player-heart'),
  playBtn: document.getElementById('play-btn'),
  shuffleBtn: document.getElementById('shuffle-btn'),
  repeatBtn: document.getElementById('repeat-btn'),
  progressFill: document.getElementById('progress-fill'),
  progressTime: document.getElementById('progress-time'),
  progressDur: document.getElementById('progress-dur'),
  volIcon: document.getElementById('vol-icon'),
  volSlider: document.getElementById('vol-slider'),
  fullPlayer: document.getElementById('full-player'),
  fpSongName: document.getElementById('fp-song-name'),
  fpArtist: document.getElementById('fp-artist'),
  fpAddedBy: document.getElementById('fp-added-by'),
  fpArt: document.getElementById('fp-art'),
  fpBgBlur: document.getElementById('fp-bg-blur'),
  fpPlaylistName: document.getElementById('fp-playlist-name'),
  fpHeart: document.getElementById('fp-heart'),
  fpProgressFill: document.getElementById('fp-progress-fill'),
  fpTime: document.getElementById('fp-time'),
  fpDur: document.getElementById('fp-dur'),
  fpPlay: document.getElementById('fp-play'),
  fpShuffle: document.getElementById('fp-shuffle'),
  fpRepeat: document.getElementById('fp-repeat'),
  fpVolIcon: document.getElementById('fp-vol-icon'),
  fpVolSlider: document.getElementById('fp-vol-slider'),
  queuePanel: document.getElementById('queue-panel'),
  queueList: document.getElementById('queue-list'),
  toast: document.getElementById('toast'),
  bgArt: document.getElementById('bg-art'),
  mobileMenuBtn2: document.getElementById('mobile-menu-btn2')
};

const audio = dom.audio;

// ===== INIT =====
async function init() {
  initVolumeSliders();
  initMediaSession();
  initVisibilityHandler();
  loadState();
  try {
    musicData = await loadMusicData();
  } catch(e) {
    musicData = {};
  }
  applyMusicData(musicData);
  if (!handleDeepLink()) {
    restoreLastPlayed();
  }
  dom.loading.style.display = 'none';
}

function initVisibilityHandler() {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && isPlaying) {
      if (queueIndex >= 0 && queue[queueIndex]) updatePlayerUI(queue[queueIndex]);
    }
  });
}

// ===== MEDIA SESSION =====
function initMediaSession() {
  if (!('mediaSession' in navigator)) return;

  navigator.mediaSession.setActionHandler('play', () => { togglePlay(); });
  navigator.mediaSession.setActionHandler('pause', () => { togglePlay(); });
  navigator.mediaSession.setActionHandler('previoustrack', () => { prevTrack(); });
  navigator.mediaSession.setActionHandler('nexttrack', () => { nextTrack(); });
  
  try {
    navigator.mediaSession.setActionHandler('seekbackward', (details) => {
      const skipTime = details.seekOffset || 10;
      audio.currentTime = Math.max(audio.currentTime - skipTime, 0);
    });
    navigator.mediaSession.setActionHandler('seekforward', (details) => {
      const skipTime = details.seekOffset || 10;
      audio.currentTime = Math.min(audio.currentTime + skipTime, audio.duration);
    });
    navigator.mediaSession.setActionHandler('seekto', (details) => {
      if (details.fastSeek && 'fastSeek' in audio) {
        audio.fastSeek(details.seekTime);
        return;
      }
      audio.currentTime = details.seekTime;
    });
  } catch(e) {}
  
  // Optional but good for optimization/completeness
  try {
    navigator.mediaSession.setActionHandler('stop', () => {
      audio.pause();
      audio.currentTime = 0;
      isPlaying = false;
      updatePlayBtn();
    });
  } catch(e) {}
}

function updateMediaSession(song) {
  if (!('mediaSession' in navigator) || !song) return;

  const name = cleanName(song.name);
  const artist = cleanArtist(song.artist);
  const img = song.img || '';

  navigator.mediaSession.metadata = new MediaMetadata({
    title: name,
    artist: artist,
    album: currentPlaylist || 'Terminal Player',
    artwork: [
      { src: img, sizes: '96x96', type: 'image/png' },
      { src: img, sizes: '128x128', type: 'image/png' },
      { src: img, sizes: '192x192', type: 'image/png' },
      { src: img, sizes: '256x256', type: 'image/png' },
      { src: img, sizes: '384x384', type: 'image/png' },
      { src: img, sizes: '512x512', type: 'image/png' },
    ]
  });
}

function updateTabTitle(song) {
  if (song && isPlaying) {
    document.title = `▶ ${cleanName(song.name)} — ${cleanArtist(song.artist)}`;
  } else if (song) {
    document.title = `${cleanName(song.name)} — ${cleanArtist(song.artist)}`;
  } else {
    document.title = 'Terminal — Music Player';
  }
}

// ===== DATA LOADING =====
async function loadMusicData() {
  if (window.MUSIC_DATA) {
    return normalizeMusicData(window.MUSIC_DATA);
  }
  try {
    return normalizeMusicData(await fetchJson(DATA_URL));
  } catch(e) {
    return normalizeMusicData(await fetchJson(DATA_URL_FALLBACK));
  }
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}`);
  return res.json();
}

function applyMusicData(data) {
  musicData = normalizeMusicData(data);
  playlists = getPlaylistNames(musicData);
  renderSidebar();
  renderHome();
}

// ===== PLAYLIST PROCESSING =====
function normalizeMusicData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  return Object.fromEntries(
    Object.entries(data)
      .filter(([, songs]) => Array.isArray(songs))
      .map(([playlist, songs]) => [playlist, songs.map(normalizeSong)])
  );
}

function normalizeSong(song) {
  return {
    ...song,
    music: normalizeAudioUrl(song?.music)
  };
}

function normalizeAudioUrl(url) {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    if (parsed.hostname.endsWith('dropbox.com')) {
      parsed.searchParams.delete('dl');
      parsed.searchParams.set('raw', '1');
      return parsed.toString();
    }
  } catch(e) {}
  return url;
}

function getPlaylistNames(data) {
  return Object.keys(data || {});
}

function getPlaylistSongs(pl) {
  return Array.isArray(musicData[pl]) ? musicData[pl] : [];
}

function getPlaylistInitial(pl) {
  return (pl || '?').trim().charAt(0).toUpperCase() || '?';
}

function getPlaylistImage(pl, songs = getPlaylistSongs(pl)) {
  return songs.find(song => song?.img)?.img || '';
}

function getFilteredPlaylistSongs(pl) {
  const songs = getPlaylistSongs(pl);
  if (!searchQuery) return songs;
  return songs.filter(songMatchesSearch);
}

function songMatchesSearch(song) {
  const q = searchQuery.toLowerCase();
  return cleanName(song?.name).toLowerCase().includes(q) ||
    cleanArtist(song?.artist).toLowerCase().includes(q);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

// ===== PERSIST =====
function loadState() {
  try {
    liked = JSON.parse(localStorage.getItem('reson_liked') || '{}');
    isShuffle = localStorage.getItem('reson_shuffle') === '1';
    repeatMode = parseInt(localStorage.getItem('reson_repeat') || '0');
    prevVol = parseInt(localStorage.getItem('reson_vol') || '80');
    audio.volume = prevVol / 100;
    document.getElementById('vol-slider').value = prevVol;
    document.getElementById('fp-vol-slider').value = prevVol;
    syncVolumeUI(prevVol);
    updateShuffleBtn();
    updateRepeatBtn();
  } catch(e) {}
}

function saveState() {
  try {
    localStorage.setItem('reson_liked', JSON.stringify(liked));
    localStorage.setItem('reson_shuffle', isShuffle ? '1' : '0');
    localStorage.setItem('reson_repeat', repeatMode);
    localStorage.setItem('reson_vol', Math.round(audio.volume * 100));
  } catch(e) {}
}

function restoreLastPlayed() {
  try {
    const last = JSON.parse(localStorage.getItem('reson_last'));
    if (!last) return;
    const pl = last.playlist;
    if (!musicData[pl]) return;
    currentPlaylist = pl;
    currentSongs = getPlaylistSongs(pl);
    const idx = last.index || 0;
    queueIndex = idx;
    queue = [...currentSongs];
    const song = queue[idx];
    if (song) {
      audio.src = song.music;
      audio.currentTime = last.position || 0;
    }
  } catch(e) {}
}

function saveLastPlayed() {
  try {
    if (queueIndex < 0) return;
    localStorage.setItem('reson_last', JSON.stringify({
      playlist: currentPlaylist,
      index: queueIndex,
      position: audio.currentTime
    }));
  } catch(e) {}
}

// ===== RENDER SIDEBAR =====
function renderSidebar() {
  dom.playlistNav.innerHTML = '';
  if (!playlists.length) {
    dom.playlistNav.innerHTML = '<div class="empty-state"><div class="empty-state-text">No playlists found</div></div>';
    return;
  }
  const filtered = playlists.filter(pl =>
    !searchQuery || pl.toLowerCase().includes(searchQuery.toLowerCase()) ||
    getPlaylistSongs(pl).some(songMatchesSearch)
  );
  if (!filtered.length) {
    dom.playlistNav.innerHTML = '<div class="empty-state"><div class="empty-state-text">No playlists found</div></div>';
    return;
  }
  filtered.forEach(pl => {
    const songs = getPlaylistSongs(pl);
    const firstImg = getPlaylistImage(pl, songs);
    const safeName = escapeHtml(pl);
    const initial = getPlaylistInitial(pl);
    const div = document.createElement('div');
    div.className = 'playlist-item' + (currentPlaylist === pl ? ' active' : '');
    div.onclick = () => { openPlaylist(pl); closeSidebar(); };
    div.innerHTML = `
      ${firstImg ? `<img class="pl-thumb" src="${escapeHtml(firstImg)}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><div class="pl-thumb-placeholder" style="display:none">${initial}</div>` :
        `<div class="pl-thumb-placeholder">${initial}</div>`}
      <div class="pl-info">
        <div class="pl-name">${safeName}</div>
        <div class="pl-count">${songs.length} songs</div>
      </div>
    `;
    dom.playlistNav.appendChild(div);
  });
}

// ===== RENDER HOME =====
function renderHome() {
  dom.playlistGrid.innerHTML = '';
  if (!playlists.length) {
    dom.playlistGrid.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🎵</div><div class="empty-state-text">No playlists found</div></div>';
    return;
  }
  playlists.forEach(pl => {
    const songs = getPlaylistSongs(pl);
    const firstImg = getPlaylistImage(pl, songs);
    const safeName = escapeHtml(pl);
    const initial = getPlaylistInitial(pl);
    const card = document.createElement('div');
    card.className = 'pl-card';
    card.innerHTML = `
      ${firstImg ? `<img class="pl-card-img" src="${escapeHtml(firstImg)}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><div class="pl-card-img-placeholder" style="display:none">${initial}</div>` :
        `<div class="pl-card-img-placeholder">${initial}</div>`}
      <div class="pl-card-body">
        <div class="pl-card-name">${safeName}</div>
        <div class="pl-card-meta">${songs.length} songs</div>
      </div>
      <div class="pl-card-play">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="white"><path d="M5 3l14 9-14 9V3z"/></svg>
      </div>
    `;
    card.onclick = () => openPlaylist(pl);
    dom.playlistGrid.appendChild(card);
  });
}

// ===== OPEN PLAYLIST =====
function openPlaylist(pl) {
  currentPlaylist = pl;
  currentSongs = getPlaylistSongs(pl);
  const songs = getFilteredPlaylistSongs(pl);

  dom.svName.textContent = pl;
  dom.svCount.textContent = `${songs.length} songs`;

  // Thumb
  const img = getPlaylistImage(pl, currentSongs);
  if (img) {
    dom.svThumbWrap.innerHTML = `<img class="song-view-thumb" src="${escapeHtml(img)}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><div class="song-view-thumb-placeholder" style="display:none">${getPlaylistInitial(pl)}</div>`;
  } else {
    dom.svThumbWrap.innerHTML = `<div class="song-view-thumb-placeholder">${getPlaylistInitial(pl)}</div>`;
  }

  renderSongList(songs);
  dom.homeView.style.display = 'none';
  dom.songView.style.display = 'block';
  dom.songView.classList.add('active');

  document.querySelectorAll('.playlist-item').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.playlist-item').forEach(el => {
    if (el.querySelector('.pl-name')?.textContent === pl) el.classList.add('active');
  });

  // Mobile
  if (dom.mobileMenuBtn2) dom.mobileMenuBtn2.style.display = window.innerWidth <= 768 ? 'block' : 'none';
}

function renderSongList(songs) {
  dom.songList.innerHTML = '';
  if (!songs.length) {
    dom.songList.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🎵</div><div class="empty-state-text">No songs found</div></div>';
    return;
  }
  songs.forEach((song, idx) => {
    const row = document.createElement('div');
    row.className = 'song-row' + (queue[queueIndex] === song ? ' playing' : '');
    row.dataset.idx = idx;
    const name = cleanName(song.name);
    const artist = cleanArtist(song.artist);
    const isLiked = liked[song.music || song.name];
    const img = escapeHtml(song.img || '');
    const safeName = escapeHtml(name);
    const safeArtist = escapeHtml(artist);
    const safeAddedBy = song.added_by ? escapeHtml(song.added_by) : '';
    const likeKey = (song.music || song.name || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const likeName = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    row.innerHTML = `
      <div class="song-row-indicator">
        <div class="song-row-num">${idx + 1}</div>
        <div class="song-playing-icon">
          <div class="eq-bar"></div><div class="eq-bar"></div><div class="eq-bar"></div>
        </div>
        <div class="song-hover-play">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="var(--accent2)"><path d="M5 3l14 9-14 9V3z"/></svg>
        </div>
      </div>
      <div class="song-row-main">
        <img class="song-row-img" src="${img}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
        <div class="song-row-info">
          <div class="song-row-name">${safeName}</div>
          <div class="song-row-artist">${safeArtist}</div>
          ${safeAddedBy ? `<div class="song-row-added-by">${safeAddedBy}</div>` : ''}
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <button class="song-row-heart ${isLiked?'liked':''}" onclick="event.stopPropagation();toggleLikeSong('${likeKey}','${likeName}',this)">${isLiked?'♥':'♡'}</button>
      </div>
    `;
    row.onclick = () => playSong(songs, idx);
    dom.songList.appendChild(row);
  });
}

// ===== PLAY =====
function playSong(songs, idx) {
  queue = [...songs];
  queueIndex = idx;
  loadAndPlay(queue[idx]);
  renderSongList(songs);
  renderQueue();
}

function playAll() {
  if (!currentSongs.length) return;
  queue = [...currentSongs];
  queueIndex = 0;
  if (isShuffle) shuffleQueue();
  loadAndPlay(queue[queueIndex]);
  renderQueue();
}

function shuffleAll() {
  if (!currentSongs.length) return;
  queue = [...currentSongs];
  shuffleQueue();
  queueIndex = 0;
  loadAndPlay(queue[0]);
  renderQueue();
  showToast('Shuffle On');
}

function shuffleQueue() {
  for (let i = queue.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [queue[i], queue[j]] = [queue[j], queue[i]];
  }
}

function playApiSong(song) {
  // If we're playing an API song, we treat the current results as a temporary playlist
  queue = [...apiResults];
  queueIndex = queue.findIndex(s => s.id === song.id);
  currentPlaylist = 'Search Results';
  loadAndPlay(song);
}

async function loadAndPlay(song) {
  if (!song) return;
  showMiniPlayer();

  // If it's an API song, fetch the stream URL first
  if (song.source === 'api') {
    try {
      showToast('Fetching stream URL...');
      const response = await fetch(`${API_BASE}/stream?id=${song.id}`);
      const data = await response.json();
      if (data.success && data.streamUrl) {
        audio.src = data.streamUrl;
      } else {
        showToast('Failed to get stream URL');
        return;
      }
    } catch (err) {
      console.error('Stream Fetch Error:', err);
      showToast('Error connecting to music server');
      return;
    }
  } else {
    audio.src = song.music;
  }

  audio.load();
  
  const playPromise = audio.play();
  if (playPromise !== undefined) {
    playPromise.then(() => {
      isPlaying = true;
      updatePlayBtn();
      updatePlayerUI(song);
    }).catch(() => {
      isPlaying = false;
      updatePlayBtn();
      updatePlayerUI(song);
    });
  } else {
    isPlaying = true;
    updatePlayBtn();
    updatePlayerUI(song);
  }

  saveLastPlayed();
  addRecentlyPlayed(song);
  updateBgArt(song.img);
  document.querySelectorAll('.song-row').forEach(row => row.classList.remove('playing'));
  const rows = document.querySelectorAll('.song-row');
  if (rows[queueIndex]) rows[queueIndex].classList.add('playing');
  renderQueue();
}

function updatePlayerUI(song) {
  if (!song) return;
  const name = cleanName(song.name);
  const artist = cleanArtist(song.artist);
  const addedBy = song.added_by || '';
  const img = song.img || '';

  dom.playerName.textContent = name;
  dom.playerArtist.textContent = artist;
  dom.playerAddedBy.textContent = addedBy;
  dom.playerAddedBy.style.display = addedBy ? 'block' : 'none';
  dom.playerThumb.src = img;

  dom.fpSongName.textContent = name;
  dom.fpArtist.textContent = artist;
  dom.fpAddedBy.textContent = addedBy;
  dom.fpAddedBy.style.display = addedBy ? 'block' : 'none';
  dom.fpArt.src = img;
  dom.fpBgBlur.style.backgroundImage = img ? `url(${img})` : 'none';
  dom.fpPlaylistName.textContent = currentPlaylist || 'Now Playing';

  const key = song.music || song.name;
  const isLiked = liked[key];
  dom.playerHeart.textContent = isLiked ? '♥' : '♡';
  dom.playerHeart.classList.toggle('liked', !!isLiked);
  dom.fpHeart.textContent = isLiked ? '♥' : '♡';
  dom.fpHeart.classList.toggle('liked', !!isLiked);

  if (isPlaying) {
    dom.fpArt.classList.add('playing');
    dom.playerThumb.classList.add('playing');
  } else {
    dom.fpArt.classList.remove('playing');
    dom.playerThumb.classList.remove('playing');
  }

  updateMediaSession(song);
  updateTabTitle(song);
}

function showMiniPlayer() {
  document.body.classList.add('player-visible');
}

function updateBgArt(img) {
  if (!img) return;
  document.getElementById('bg-art').style.background =
    `radial-gradient(ellipse 60% 40% at 60% 20%,rgba(124,110,255,0.1) 0%,transparent 70%),
     radial-gradient(ellipse 40% 30% at 20% 60%,rgba(34,211,238,0.06) 0%,transparent 70%)`;
}

// ===== CONTROLS =====
function togglePlay() {
  if (!audio.src && !audio.currentSrc) return;
  if (isPlaying) { audio.pause(); isPlaying = false; }
  else { showMiniPlayer(); audio.play().catch(() => {}); isPlaying = true; }
  updatePlayBtn();
  if (queue[queueIndex]) updatePlayerUI(queue[queueIndex]);
}

function updatePlayBtn() {
  const pauseIcon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
  const playIcon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M5 3l14 9-14 9V3z"/></svg>`;
  const fp_pauseIcon = `<svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
  const fp_playIcon = `<svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M5 3l14 9-14 9V3z"/></svg>`;
  
  dom.playBtn.innerHTML = isPlaying ? pauseIcon : playIcon;
  dom.fpPlay.innerHTML = isPlaying ? fp_pauseIcon : fp_playIcon;
  dom.fpArt.classList.toggle('playing', isPlaying);
  dom.playerThumb.classList.toggle('playing', isPlaying);

  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
  }
  
  if (queueIndex >= 0 && queue[queueIndex]) {
    updateTabTitle(queue[queueIndex]);
  }
}

function nextTrack() {
  if (!queue.length) return;
  if (repeatMode === 2) { audio.currentTime = 0; audio.play(); return; }
  queueIndex++;
  if (queueIndex >= queue.length) {
    if (repeatMode === 1) queueIndex = 0;
    else { isPlaying = false; updatePlayBtn(); queueIndex = queue.length - 1; return; }
  }
  loadAndPlay(queue[queueIndex]);
}

function prevTrack() {
  if (!queue.length) return;
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  queueIndex = Math.max(0, queueIndex - 1);
  loadAndPlay(queue[queueIndex]);
}

function toggleShuffle() {
  isShuffle = !isShuffle;
  updateShuffleBtn();
  saveState();
  showToast(isShuffle ? 'Shuffle On' : 'Shuffle Off');
}

function updateShuffleBtn() {
  dom.shuffleBtn.classList.toggle('active', isShuffle);
  dom.fpShuffle.classList.toggle('active', isShuffle);
}

function cycleRepeat() {
  repeatMode = (repeatMode + 1) % 3;
  updateRepeatBtn();
  saveState();
  const labels = ['Repeat Off', 'Repeat All', 'Repeat One'];
  showToast(labels[repeatMode]);
}

function updateRepeatBtn() {
  dom.repeatBtn.classList.toggle('active', repeatMode > 0);
  dom.fpRepeat.classList.toggle('active', repeatMode > 0);
}

// ===== SEEK =====
function formatTime(s) {
  if (!isFinite(s)) return '0:00';
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function seek(e) {
  if (!audio.duration) return;
  const bar = e.currentTarget;
  const rect = bar.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  audio.currentTime = ratio * audio.duration;
}

function seekStart(e) {
  seeking = true;
  seek(e);
  const move = (ev) => { if (seeking) seek({currentTarget: e.currentTarget, clientX: ev.clientX}); };
  const up = () => { seeking = false; document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
}

function fpSeek(e) {
  if (!audio.duration) return;
  const bar = e.currentTarget;
  const rect = bar.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  audio.currentTime = ratio * audio.duration;
}

function fpSeekStart(e) {
  fpSeeking = true;
  fpSeek(e);
  const move = (ev) => { if (fpSeeking) fpSeek({currentTarget: e.currentTarget, clientX: ev.clientX}); };
  const up = () => { fpSeeking = false; document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
}

// ===== VOLUME =====
function setVolume(v) {
  const volume = clampVolume(v);
  audio.volume = volume / 100;
  isMuted = volume === 0;
  updateVolIcon(volume);
  syncVolumeUI(volume);
  saveState();
}

function toggleMute() {
  if (isMuted) {
    setVolume(prevVol);
  } else {
    prevVol = Math.round(audio.volume * 100);
    setVolume(0);
  }
}

function updateVolIcon(v) {
  const icon = v == 0 ? '🔇' : v < 50 ? '🔉' : '🔊';
  dom.volIcon.textContent = icon;
  dom.fpVolIcon.textContent = icon;
}

function clampVolume(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function syncVolumeUI(v) {
  const volume = clampVolume(v);
  document.querySelectorAll('.volume-slider').forEach(slider => {
    slider.value = volume;
    slider.style.setProperty('--volume-pct', `${volume}%`);
  });
}

function volumeFromPointer(slider, clientX) {
  const rect = slider.getBoundingClientRect();
  if (!rect.width) return clampVolume(slider.value);
  const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  return Math.round(ratio * 100);
}

function startVolumeDrag(e) {
  const slider = e.currentTarget;
  volumeDragging = true;
  slider.classList.add('dragging');
  window.addEventListener('pointermove', moveVolumeDrag);
  window.addEventListener('pointerup', stopVolumeDrag);
  window.addEventListener('pointercancel', stopVolumeDrag);
  e.preventDefault();
  setVolume(volumeFromPointer(slider, e.clientX));
}

function moveVolumeDrag(e) {
  if (!volumeDragging) return;
  const slider = document.querySelector('.volume-slider.dragging');
  if (!slider) return;
  setVolume(volumeFromPointer(slider, e.clientX));
}

function stopVolumeDrag() {
  volumeDragging = false;
  document.querySelectorAll('.volume-slider.dragging').forEach(slider => slider.classList.remove('dragging'));
  window.removeEventListener('pointermove', moveVolumeDrag);
  window.removeEventListener('pointerup', stopVolumeDrag);
  window.removeEventListener('pointercancel', stopVolumeDrag);
}

function initVolumeSliders() {
  document.querySelectorAll('.volume-slider').forEach(slider => {
    slider.addEventListener('pointerdown', startVolumeDrag);
    slider.addEventListener('keydown', e => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
        e.preventDefault();
        setVolume(clampVolume(audio.volume * 100 - 5));
      }
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
        e.preventDefault();
        setVolume(clampVolume(audio.volume * 100 + 5));
      }
    });
  });
  syncVolumeUI(Math.round(audio.volume * 100));
}

function setSpeed(v) {
  audio.playbackRate = parseFloat(v);
}

// ===== LIKE =====
function toggleLike() {
  if (queueIndex < 0 || !queue[queueIndex]) return;
  const song = queue[queueIndex];
  const key = song.music || song.name;
  liked[key] = !liked[key];
  saveState();
  updatePlayerUI(song);
  showToast(liked[key] ? '♥ Added to Liked' : '♡ Removed from Liked');
}

function toggleLikeSong(key, name, btn) {
  liked[key] = !liked[key];
  saveState();
  btn.textContent = liked[key] ? '♥' : '♡';
  btn.classList.toggle('liked', !!liked[key]);
  showToast(liked[key] ? `♥ Liked "${name}"` : `♡ Unliked "${name}"`);
  if (queue[queueIndex] && (queue[queueIndex].music || queue[queueIndex].name) === key) {
    updatePlayerUI(queue[queueIndex]);
  }
}

// ===== FULL PLAYER =====
function expandPlayer(e) {
  // Allow expansion if clicking the dedicated button OR any non-excluded area
  const isExcluded = e && e.target && (
    e.target.closest('.ctrl-btn') || 
    e.target.closest('.volume-slider') || 
    e.target.closest('#vol-icon') || 
    e.target.closest('#player-heart') ||
    e.target.closest('#progress-bar') ||
    e.target.closest('#fp-vol-icon') ||
    e.target.closest('#fp-speed')
  );

  // If it's an excluded element, and NOT the expand-btn itself, then return
  if (isExcluded && !(e && e.target && e.target.closest('#expand-btn'))) return;

  fullOpen = true;
  dom.fullPlayer.classList.add('open');
}

function collapsePlayer() {
  fullOpen = false;
  dom.fullPlayer.classList.remove('open');
  if (queueOpen) { queueOpen = false; dom.queuePanel.classList.remove('open'); }
}

// ===== QUEUE =====
function toggleQueue() {
  queueOpen = !queueOpen;
  dom.queuePanel.classList.toggle('open', queueOpen);
}

function renderQueue() {
  dom.queueList.innerHTML = '';
  queue.forEach((song, i) => {
    const div = document.createElement('div');
    div.className = 'queue-item' + (i === queueIndex ? ' now-playing' : '');
    div.innerHTML = `
      <img class="queue-item-img" src="${escapeHtml(song.img || '')}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
      <div class="queue-item-info">
        <div class="queue-item-name">${escapeHtml(cleanName(song.name))}</div>
        <div class="queue-item-artist">${escapeHtml(cleanArtist(song.artist))}</div>
      </div>
    `;
    div.onclick = () => { queueIndex = i; loadAndPlay(queue[i]); };
    dom.queueList.appendChild(div);
  });
  if (dom.queueList.children[queueIndex]) {
    dom.queueList.children[queueIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

// ===== SEARCH =====
let searchTimeout = null;

async function onSearch(q) {
  searchQuery = q.trim();
  
  if (searchTimeout) clearTimeout(searchTimeout);
  
  if (!searchQuery) {
    apiResults = [];
    renderSidebar();
    if (currentPlaylist && dom.songView.classList.contains('active')) {
      const songs = getFilteredPlaylistSongs(currentPlaylist);
      renderSongList(songs);
      dom.svCount.textContent = `${songs.length} songs`;
    }
    return;
  }

  // Local filtering happens immediately
  renderSidebar();

  // Debounced API search
  searchTimeout = setTimeout(async () => {
    try {
      const response = await fetch(`${API_BASE}/search?query=${encodeURIComponent(searchQuery)}&limit=15`);
      const data = await response.json();
      if (data.success) {
        // Map API results to our internal song format
        apiResults = data.tracks.map(track => ({
          id: track.id,
          name: track.title,
          artist: track.artist,
          img: track.thumbnail,
          source: 'api', // Mark as API source
          album: track.album
        }));
        renderSidebar();
      }
    } catch (err) {
      console.error('API Search Error:', err);
    }
  }, 400);

  if (currentPlaylist && dom.songView.classList.contains('active')) {
    const songs = getFilteredPlaylistSongs(currentPlaylist);
    renderSongList(songs);
    dom.svCount.textContent = `${songs.length} songs`;
  }
}

// ===== RENDER SIDEBAR =====
function renderSidebar() {
  dom.playlistNav.innerHTML = '';
  
  if (searchQuery) {
    // 1. Local Song Results
    const songResults = [];
    playlists.forEach(pl => {
      const songs = getPlaylistSongs(pl);
      songs.forEach((song, idx) => {
        if (songMatchesSearch(song)) {
          songResults.push({ song, pl, idx });
        }
      });
    });

    if (songResults.length) {
      const label = document.createElement('div');
      label.className = 'nav-label';
      label.textContent = 'Local Songs';
      dom.playlistNav.appendChild(label);

      songResults.slice(0, 10).forEach(res => {
        const { song, pl, idx } = res;
        const div = document.createElement('div');
        div.className = 'playlist-item';
        div.onclick = () => {
          openPlaylist(pl);
          playSong(musicData[pl], idx);
          closeSidebar();
        };
        div.innerHTML = `
          <img class="pl-thumb" src="${escapeHtml(song.img || '')}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
          <div class="pl-thumb-placeholder" style="display:none">${getPlaylistInitial(pl)}</div>
          <div class="pl-info">
            <div class="pl-name">${escapeHtml(cleanName(song.name))}</div>
            <div class="pl-count">${escapeHtml(cleanArtist(song.artist))}</div>
          </div>
        `;
        dom.playlistNav.appendChild(div);
      });
    }

    // 2. API Results (Online Search)
    if (apiResults.length) {
      const label = document.createElement('div');
      label.className = 'nav-label';
      label.textContent = 'Online Results';
      dom.playlistNav.appendChild(label);

      apiResults.forEach((song) => {
        const div = document.createElement('div');
        div.className = 'playlist-item';
        div.onclick = () => {
          playApiSong(song);
          closeSidebar();
        };
        div.innerHTML = `
          <img class="pl-thumb" src="${escapeHtml(song.img || '')}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
          <div class="pl-thumb-placeholder" style="display:none">S</div>
          <div class="pl-info">
            <div class="pl-name">${escapeHtml(cleanName(song.name))}</div>
            <div class="pl-artist">${escapeHtml(cleanArtist(song.artist))}</div>
          </div>
        `;
        dom.playlistNav.appendChild(div);
      });
    }
  }

  // Playlists section
  const filteredPl = playlists.filter(pl =>
    !searchQuery || pl.toLowerCase().includes(searchQuery.toLowerCase()) ||
    getPlaylistSongs(pl).some(songMatchesSearch)
  );

  if (filteredPl.length) {
    const label = document.createElement('div');
    label.className = 'nav-label';
    label.textContent = 'Playlists';
    dom.playlistNav.appendChild(label);

    filteredPl.forEach(pl => {
      const songs = getPlaylistSongs(pl);
      const firstImg = getPlaylistImage(pl, songs);
      const safeName = escapeHtml(pl);
      const initial = getPlaylistInitial(pl);
      const div = document.createElement('div');
      div.className = 'playlist-item' + (currentPlaylist === pl ? ' active' : '');
      div.onclick = () => { openPlaylist(pl); closeSidebar(); };
      div.innerHTML = `
        ${firstImg ? `<img class="pl-thumb" src="${escapeHtml(firstImg)}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><div class="pl-thumb-placeholder" style="display:none">${initial}</div>` :
          `<div class="pl-thumb-placeholder">${initial}</div>`}
        <div class="pl-info">
          <div class="pl-name">${safeName}</div>
          <div class="pl-count">${songs.length} songs</div>
        </div>
      `;
      dom.playlistNav.appendChild(div);
    });
  }

  if (!filteredPl.length && (!searchQuery || (searchQuery && dom.playlistNav.children.length === 0))) {
    dom.playlistNav.innerHTML = '<div class="empty-state"><div class="empty-state-text">No results found</div></div>';
  }
}

// ===== NAVIGATION =====
function showHome() {
  dom.homeView.style.display = 'block';
  dom.songView.style.display = 'none';
  dom.songView.classList.remove('active');
  document.querySelectorAll('.playlist-item').forEach(el => el.classList.remove('active'));
}

function openSidebar() {
  dom.sidebar.classList.add('mobile-open');
  dom.sidebarOverlay.classList.add('active');
}

function closeSidebar() {
  dom.sidebar.classList.remove('mobile-open');
  dom.sidebarOverlay.classList.remove('active');
}

// ===== RECENTLY PLAYED =====
function addRecentlyPlayed(song) {
  recentlyPlayed = [song, ...recentlyPlayed.filter(s => s !== song)].slice(0, 20);
}

// ===== UTILS =====
function cleanName(n) { return (n || '').replace(/-/g, ' ').replace(/\s+/g, ' ').trim(); }
function cleanArtist(a) { return (a || '').replace(/-/g, ' ').replace(/,\s*/g, ', ').trim(); }

// ===== TOAST =====
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

// ===== DEEP LINK & SHARE =====
function getQueryParams() {
  const params = {};
  try {
    const search = window.location.search.substring(1);
    if (!search) return params;
    search.split('&').forEach(pair => {
      const [key, value] = pair.split('=');
      if (key) params[key] = decodeURIComponent(value || '').replace(/\+/g, ' ');
    });
  } catch(e) {}
  return params;
}

function handleDeepLink() {
  let params = {};
  if (typeof URLSearchParams !== 'undefined') {
    new URLSearchParams(window.location.search).forEach((v, k) => params[k] = v);
  } else {
    params = getQueryParams();
  }
  
  const songParam = params.song;
  if (!songParam) return false;

  const decodedSongParam = decodeURIComponent(songParam);
  const match = decodedSongParam.match(/^(.+)\[(\d+)\]$/);
  if (!match) return false;

  const pl = match[1];
  const idx = parseInt(match[2]);

  if (musicData[pl] && idx >= 0 && idx < musicData[pl].length) {
    openPlaylist(pl);
    playSong(musicData[pl], idx);
    expandPlayer(); // Automatically open full player
    return true;
  }
  return false;
}

function shareCurrentSong() {
  if (queueIndex < 0 || !currentPlaylist) {
    showToast("No song playing to share");
    return;
  }

  const currentSong = queue[queueIndex];
  const originalSongs = musicData[currentPlaylist];
  const originalIdx = originalSongs.findIndex(s => s.music === currentSong.music);

  if (originalIdx === -1) {
    showToast("Error generating share link");
    return;
  }

  const origin = window.location.origin || (window.location.protocol + "//" + window.location.host);
  const url = new URL(origin + window.location.pathname);
  url.searchParams.set('song', `${currentPlaylist}[${originalIdx}]`);
  const shareUrl = url.toString();

  if (navigator.share) {
    navigator.share({
      title: `Terminal Player - ${currentSong.name}`,
      text: `Listen to "${currentSong.name}" by ${currentSong.artist}`,
      url: shareUrl
    }).catch(() => copyToClipboard(shareUrl));
  } else {
    copyToClipboard(shareUrl);
  }
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    showToast("Link copied to clipboard!");
  }).catch(() => {
    showToast("Failed to copy link");
  });
}

// ===== AUDIO EVENTS =====
audio.addEventListener('timeupdate', () => {
  if (!audio.duration) return;
  const pct = (audio.currentTime / audio.duration) * 100;
  dom.progressFill.style.width = pct + '%';
  dom.fpProgressFill.style.width = pct + '%';
  dom.progressTime.textContent = formatTime(audio.currentTime);
  dom.fpTime.textContent = formatTime(audio.currentTime);
  if (Math.floor(audio.currentTime) % 5 === 0) saveLastPlayed();
});

audio.addEventListener('loadedmetadata', () => {
  dom.progressDur.textContent = formatTime(audio.duration);
  dom.fpDur.textContent = formatTime(audio.duration);
});

audio.addEventListener('ended', () => {
  nextTrack();
});

audio.addEventListener('play', () => { 
  showMiniPlayer(); 
  isPlaying = true; 
  updatePlayBtn(); 
});

audio.addEventListener('pause', () => { 
  isPlaying = false; 
  updatePlayBtn(); 
});

audio.addEventListener('error', () => {
  showToast('Playback error — trying next track');
  setTimeout(nextTrack, 800);
});

// ===== KEYBOARD =====
document.addEventListener('keydown', e => {
  const tag = document.activeElement.tagName;
  if (tag === 'INPUT' || tag === 'SELECT') return;
  switch(e.code) {
    case 'Space': e.preventDefault(); togglePlay(); break;
    case 'ArrowRight': audio.currentTime = Math.min(audio.duration||0, audio.currentTime + 10); break;
    case 'ArrowLeft': audio.currentTime = Math.max(0, audio.currentTime - 10); break;
    case 'ArrowUp': setVolume(Math.min(100, Math.round(audio.volume*100) + 10)); break;
    case 'ArrowDown': setVolume(Math.max(0, Math.round(audio.volume*100) - 10)); break;
    case 'KeyN': nextTrack(); break;
    case 'KeyP': prevTrack(); break;
    case 'KeyS': toggleShuffle(); break;
    case 'KeyR': cycleRepeat(); break;
    case 'Escape': collapsePlayer(); break;
  }
});

// Mobile touch support
let touchStartY = 0;
document.getElementById('full-player').addEventListener('touchstart', e => {
  touchStartY = e.touches[0].clientY;
}, { passive: true });
document.getElementById('full-player').addEventListener('touchend', e => {
  const dy = e.changedTouches[0].clientY - touchStartY;
  if (dy > 80) collapsePlayer();
}, { passive: true });

// Sidebar mobile
window.addEventListener('resize', () => {
  if (dom.mobileMenuBtn2) dom.mobileMenuBtn2.style.display = window.innerWidth <= 768 ? 'block' : 'none';
  if (window.innerWidth > 768) closeSidebar();
});

// Start
init();
