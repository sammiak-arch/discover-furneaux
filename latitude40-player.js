/* Discover Furneaux — Latitude 40 native audio player.
   Add <script src="/latitude40-player.js"></script> immediately before </body>,
   after the existing inline application script. */
(() => {
  'use strict';
  let episodes = [];
  let player = null;
  let currentEpisode = null;
  let autoAdvance = false;

  async function refreshEpisodes() {
    try {
      const response = await fetch('/api/latitude40', { cache: 'no-store' });
      if (!response.ok) return;
      const data = await response.json();
      if (Array.isArray(data.episodes)) episodes = data.episodes;
    } catch (_) { /* Existing featured-episode fallback remains available. */ }
  }

  function findEpisode(button) {
    const title = button.getAttribute('data-latitude-title') || '';
    const link = button.getAttribute('data-latitude-play') || '';
    return episodes.find(e => e.title === title) ||
      episodes.find(e => e.url && e.url === link) || null;
  }

  function playEpisode(episode) {
    const dock = document.getElementById('latitude-player-dock');
    const frame = document.getElementById('latitude-player-frame');
    const heading = document.getElementById('latitude-now-playing');
    if (!dock || !frame || !heading) return;
    let audioURL;
    try { audioURL = new URL(episode.audio); } catch (_) { return; }
    if (audioURL.protocol !== 'https:' || !/\.mp3(?:$|\?)/i.test(audioURL.pathname + audioURL.search)) return;

    if (!player) {
      player = document.createElement('audio');
      player.controls = true;
      player.preload = 'none';
      player.style.cssText = 'display:block;width:100%;height:44px;';
      player.setAttribute('aria-label', 'Latitude 40 episode audio');
      player.addEventListener('ended', () => {
        if (!autoAdvance || !currentEpisode) return;
        const index = episodes.findIndex(e =>
          (e.audio && e.audio === currentEpisode.audio) ||
          (e.title && e.title === currentEpisode.title));
        // The feed is newest first; move to the next older episode.
        if (index < 0 || index + 1 >= episodes.length) return;
        playEpisode(episodes[index + 1]);
      });
      frame.insertAdjacentElement('afterend', player);
      frame.style.display = 'none';
    }
    if (player.src !== audioURL.href) {
      player.pause();
      player.src = audioURL.href;
    }
    currentEpisode = episode;
    autoAdvance = true;
    heading.textContent = episode.title || 'Latitude 40';
    dock.classList.add('open');
    document.body.classList.add('latitude-playing');
    player.play().catch(() => { /* Browser may require a second tap on Play. */ });
  }

  // Capture before the legacy Buzzsprout iframe click handler.
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-latitude-play]');
    if (button) {
      const episode = findEpisode(button);
      if (episode && episode.audio) {
        event.stopImmediatePropagation();
        playEpisode(episode);
      }
      return;
    }
    if (event.target.closest('#latitude-player-close') && player) {
      autoAdvance = false;
      currentEpisode = null;
      player.pause();
      player.removeAttribute('src');
      player.load();
    }
  }, true);

  // A small retry accommodates asynchronous loading of the existing episode cards.
  refreshEpisodes();
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !episodes.length) refreshEpisodes();
  });
})();
