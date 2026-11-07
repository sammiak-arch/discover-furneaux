
/* Discover Furneaux — Latitude 40 audio player */
(() => {
  'use strict';

  let episodes = [];
  let player = null;

  async function refreshEpisodes() {
    try {
      const response = await fetch('/api/latitude40', {
        cache: 'no-store'
      });

      if (!response.ok) return;

      const data = await response.json();

      if (Array.isArray(data.episodes)) {
        episodes = data.episodes;
      }
    } catch (error) {
      console.warn('Latitude 40 feed unavailable', error);
    }
  }

  function findEpisode(button) {
    const title = button.getAttribute('data-latitude-title') || '';
    const link = button.getAttribute('data-latitude-play') || '';

    return episodes.find(e => e.title === title) ||
      episodes.find(e => e.url && e.url === link) ||
      null;
  }

  function playEpisode(episode) {
    const dock = document.getElementById('latitude-player-dock');
    const frame = document.getElementById('latitude-player-frame');
    const heading = document.getElementById('latitude-now-playing');

    if (!dock || !frame || !heading || !episode.audio) return;

    let audioURL;

    try {
      audioURL = new URL(episode.audio);
    } catch {
      return;
    }

    if (audioURL.protocol !== 'https:') return;

    if (!player) {
      player = document.createElement('audio');
      player.controls = true;
      player.preload = 'none';
      player.style.cssText = 'display:block;width:100%;height:44px;';
      player.setAttribute('aria-label', 'Latitude 40 episode audio');

      frame.insertAdjacentElement('afterend', player);
      frame.style.display = 'none';
    }

    if (player.src !== audioURL.href) {
      player.pause();
      player.src = audioURL.href;
    }

    heading.textContent = episode.title || 'Latitude 40';
    dock.classList.add('open');
    document.body.classList.add('latitude-playing');

    player.play().catch(() => {});
  }

  document.addEventListener('click', event => {
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
      player.pause();
      player.removeAttribute('src');
      player.load();
    }
  }, true);

  refreshEpisodes();

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !episodes.length) {
      refreshEpisodes();
    }
  });
})();
