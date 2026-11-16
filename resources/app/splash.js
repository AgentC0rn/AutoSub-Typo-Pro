'use strict';
const { ipcRenderer } = require('electron');

const verEl = document.getElementById('sp-ver');
const statusEl = document.getElementById('sp-status');
const subEl = document.getElementById('sp-sub');
const barEl = document.getElementById('sp-bar');
const btnSkip = document.getElementById('sp-skip');
const btnInstall = document.getElementById('sp-install');

ipcRenderer.on('splash-state', (_e, state) => {
  if (!state) return;
  if (state.version) verEl.textContent = 'v' + state.version;
  if (state.status !== undefined) statusEl.textContent = state.status;
  if (state.sub !== undefined) subEl.textContent = state.sub;

  if (state.indeterminate) {
    barEl.classList.add('indeterminate');
    barEl.style.width = '';
  } else if (typeof state.percent === 'number') {
    barEl.classList.remove('indeterminate');
    barEl.style.width = Math.round(Math.max(0, Math.min(1, state.percent)) * 100) + '%';
  }

  btnInstall.hidden = !state.showInstall;
  btnSkip.disabled = !!state.disableSkip;
});

btnSkip.addEventListener('click', () => {
  btnSkip.disabled = true;
  statusEl.textContent = 'Đang mở ứng dụng…';
  ipcRenderer.send('splash-skip');
});

btnInstall.addEventListener('click', () => {
  btnInstall.hidden = true;
  ipcRenderer.send('splash-confirm-installer');
});
