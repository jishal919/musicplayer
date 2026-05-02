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
let seeking = false;
let fpSeeking = false;
let volumeDragging = false;
let fullOpen = false;
let queueOpen = false;

const audio = document.getElementById('audio-el');

// ===== INIT =====
async function init() {
  initVolumeSliders();
  loadState();
  try {
    musicData = await loadMusicData();
  } catch(e) {
    musicData = {};
  }
  applyMusicData(musicData);
  restoreLastPlayed();
  document.getElementById('loading').style.display = 'none';
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
      updatePlayerUI(song);
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
  const nav = document.getElementById('playlist-nav');
  nav.innerHTML = '';
  if (!playlists.length) {
    nav.innerHTML = '<div class="empty-state"><div class="empty-state-text">No playlists found</div></div>';
    return;
  }
  const filtered = playlists.filter(pl =>
    !searchQuery || pl.toLowerCase().includes(searchQuery.toLowerCase()) ||
    getPlaylistSongs(pl).some(songMatchesSearch)
  );
  if (!filtered.length) {
    nav.innerHTML = '<div class="empty-state"><div class="empty-state-text">No playlists found</div></div>';
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
    nav.appendChild(div);
  });
}

// ===== RENDER HOME =====
function renderHome() {
  const grid = document.getElementById('playlist-grid');
  grid.innerHTML = '';
  if (!playlists.length) {
    grid.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🎵</div><div class="empty-state-text">No playlists found</div></div>';
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
    grid.appendChild(card);
  });
}

// ===== OPEN PLAYLIST =====
function openPlaylist(pl) {
  currentPlaylist = pl;
  currentSongs = getPlaylistSongs(pl);
  const songs = getFilteredPlaylistSongs(pl);

  document.getElementById('sv-name').textContent = pl;
  document.getElementById('sv-count').textContent = `${songs.length} songs`;

  // Thumb
  const thumbWrap = document.getElementById('sv-thumb-wrap');
  const img = getPlaylistImage(pl, currentSongs);
  if (img) {
    thumbWrap.innerHTML = `<img class="song-view-thumb" src="${escapeHtml(img)}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><div class="song-view-thumb-placeholder" style="display:none">${getPlaylistInitial(pl)}</div>`;
  } else {
    thumbWrap.innerHTML = `<div class="song-view-thumb-placeholder">${getPlaylistInitial(pl)}</div>`;
  }

  renderSongList(songs);
  document.getElementById('home-view').style.display = 'none';
  const sv = document.getElementById('song-view');
  sv.style.display = 'block';
  sv.classList.add('active');

  document.querySelectorAll('.playlist-item').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.playlist-item').forEach(el => {
    if (el.querySelector('.pl-name')?.textContent === pl) el.classList.add('active');
  });

  // Mobile
  const m = document.getElementById('mobile-menu-btn2');
  if (m) m.style.display = window.innerWidth <= 768 ? 'block' : 'none';
}

function renderSongList(songs) {
  const list = document.getElementById('song-list');
  list.innerHTML = '';
  if (!songs.length) {
    list.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🎵</div><div class="empty-state-text">No songs found</div></div>';
    return;
  }
  songs.forEach((song, idx) => {
    const row = document.createElement('div');
    const isPlaying_ = queue[queueIndex] === song && isPlaying;
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
    list.appendChild(row);
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

function loadAndPlay(song) {
  if (!song) return;
  audio.src = song.music;
  audio.load();
  audio.play().catch(() => {});
  isPlaying = true;
  updatePlayerUI(song);
  updatePlayBtn();
  saveLastPlayed();
  addRecentlyPlayed(song);
  updateBgArt(song.img);
  document.querySelectorAll('.song-row').forEach(row => row.classList.remove('playing'));
  const rows = document.querySelectorAll('.song-row');
  if (rows[queueIndex]) rows[queueIndex].classList.add('playing');
  renderQueue();
}

function updatePlayerUI(song) {
  const name = cleanName(song.name);
  const artist = cleanArtist(song.artist);
  const addedBy = song.added_by || '';
  const img = song.img || '';
  document.getElementById('player-name').textContent = name;
  document.getElementById('player-artist').textContent = artist;
  document.getElementById('player-added-by').textContent = addedBy;
  document.getElementById('player-added-by').style.display = addedBy ? 'block' : 'none';
  document.getElementById('player-thumb').src = img;
  document.getElementById('fp-song-name').textContent = name;
  document.getElementById('fp-artist').textContent = artist;
  document.getElementById('fp-added-by').textContent = addedBy;
  document.getElementById('fp-added-by').style.display = addedBy ? 'block' : 'none';
  document.getElementById('fp-art').src = img;
  document.getElementById('fp-bg-blur').style.backgroundImage = img ? `url(${img})` : 'none';
  document.getElementById('fp-playlist-name').textContent = currentPlaylist || 'Now Playing';
  const key = song.music || song.name;
  const isLiked = liked[key];
  document.getElementById('player-heart').textContent = isLiked ? '♥' : '♡';
  document.getElementById('player-heart').classList.toggle('liked', !!isLiked);
  document.getElementById('fp-heart').textContent = isLiked ? '♥' : '♡';
  document.getElementById('fp-heart').classList.toggle('liked', !!isLiked);
  if (isPlaying) {
    document.getElementById('fp-art').classList.add('playing');
    document.getElementById('player-thumb').classList.add('playing');
  } else {
    document.getElementById('fp-art').classList.remove('playing');
    document.getElementById('player-thumb').classList.remove('playing');
  }
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
  else { audio.play().catch(() => {}); isPlaying = true; }
  updatePlayBtn();
  if (queue[queueIndex]) updatePlayerUI(queue[queueIndex]);
}

function updatePlayBtn() {
  const pauseIcon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
  const playIcon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M5 3l14 9-14 9V3z"/></svg>`;
  const fp_pauseIcon = `<svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
  const fp_playIcon = `<svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M5 3l14 9-14 9V3z"/></svg>`;
  document.getElementById('play-btn').innerHTML = isPlaying ? pauseIcon : playIcon;
  document.getElementById('fp-play').innerHTML = isPlaying ? fp_pauseIcon : fp_playIcon;
  document.getElementById('fp-art').classList.toggle('playing', isPlaying);
  document.getElementById('player-thumb').classList.toggle('playing', isPlaying);
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
  document.getElementById('shuffle-btn').classList.toggle('active', isShuffle);
  document.getElementById('fp-shuffle').classList.toggle('active', isShuffle);
}

function cycleRepeat() {
  repeatMode = (repeatMode + 1) % 3;
  updateRepeatBtn();
  saveState();
  const labels = ['Repeat Off', 'Repeat All', 'Repeat One'];
  showToast(labels[repeatMode]);
}

function updateRepeatBtn() {
  const r1 = document.getElementById('repeat-btn');
  const r2 = document.getElementById('fp-repeat');
  r1.classList.toggle('active', repeatMode > 0);
  r2.classList.toggle('active', repeatMode > 0);
  const label = repeatMode === 2 ? '¹' : '';
  // Could add visual indicator here
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
  document.getElementById('vol-icon').textContent = icon;
  document.getElementById('fp-vol-icon').textContent = icon;
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
  if (e && e.target && (e.target.closest('.ctrl-btn') || e.target.closest('#vol-wrap') || e.target.closest('#expand-btn') || e.target.closest('#player-heart'))) return;
  fullOpen = true;
  document.getElementById('full-player').classList.add('open');
}

function collapsePlayer() {
  fullOpen = false;
  document.getElementById('full-player').classList.remove('open');
  if (queueOpen) { queueOpen = false; document.getElementById('queue-panel').classList.remove('open'); }
}

// ===== QUEUE =====
function toggleQueue() {
  queueOpen = !queueOpen;
  document.getElementById('queue-panel').classList.toggle('open', queueOpen);
}

function renderQueue() {
  const list = document.getElementById('queue-list');
  list.innerHTML = '';
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
    list.appendChild(div);
  });
  if (list.children[queueIndex]) {
    list.children[queueIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

// ===== SEARCH =====
function onSearch(q) {
  searchQuery = q.trim();
  renderSidebar();
  if (currentPlaylist && document.getElementById('song-view').classList.contains('active')) {
    const songs = getFilteredPlaylistSongs(currentPlaylist);
    renderSongList(songs);
    document.getElementById('sv-count').textContent = `${songs.length} songs`;
  }
}

// ===== NAVIGATION =====
function showHome() {
  document.getElementById('home-view').style.display = 'block';
  document.getElementById('song-view').style.display = 'none';
  document.getElementById('song-view').classList.remove('active');
  document.querySelectorAll('.playlist-item').forEach(el => el.classList.remove('active'));
}

function openSidebar() {
  document.getElementById('sidebar').classList.add('mobile-open');
  document.getElementById('sidebar-overlay').style.display = 'block';
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('mobile-open');
  document.getElementById('sidebar-overlay').style.display = 'none';
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

// ===== AUDIO EVENTS =====
audio.addEventListener('timeupdate', () => {
  if (!audio.duration) return;
  const pct = (audio.currentTime / audio.duration) * 100;
  document.getElementById('progress-fill').style.width = pct + '%';
  document.getElementById('fp-progress-fill').style.width = pct + '%';
  document.getElementById('progress-time').textContent = formatTime(audio.currentTime);
  document.getElementById('fp-time').textContent = formatTime(audio.currentTime);
  if (Math.floor(audio.currentTime) % 5 === 0) saveLastPlayed();
});

audio.addEventListener('loadedmetadata', () => {
  document.getElementById('progress-dur').textContent = formatTime(audio.duration);
  document.getElementById('fp-dur').textContent = formatTime(audio.duration);
});

audio.addEventListener('ended', () => {
  nextTrack();
});

audio.addEventListener('play', () => { isPlaying = true; updatePlayBtn(); });
audio.addEventListener('pause', () => { isPlaying = false; updatePlayBtn(); });

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
  const m = document.getElementById('mobile-menu-btn2');
  if (m) m.style.display = window.innerWidth <= 768 ? 'block' : 'none';
  if (window.innerWidth > 768) closeSidebar();
});

// Start
init();
