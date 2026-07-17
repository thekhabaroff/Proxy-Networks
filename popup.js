import {
  getContentBlockingSettings,
  getProfileSummaries,
  setContentBlockingSettings,
} from './storage.js';
import {
  errorMessage,
  sendRuntimeCommand,
  sendRuntimeMessage,
} from './utils.js';
import { getConfiguredProtocols } from './config.js';

const enabledToggle = document.getElementById('enabledToggle');
const profileSelect = document.getElementById('profileSelect');
const protocolSelect = document.getElementById('protocolSelect');
const protocolField = document.getElementById('protocolField');
const statusLine = document.getElementById('statusLine');
const ipLine = document.getElementById('ipLine');
const pingLine = document.getElementById('pingLine');
const errorBanner = document.getElementById('errorBanner');
const toggleLabel = document.getElementById('toggleLabel');
const refreshIpButton = document.getElementById('refreshIpButton');
const settingsButton = document.getElementById('settingsButton');
const tipsList = document.getElementById('tipsList');
const blockTrackingInput = document.getElementById('blockTracking');

let profilesCache = [];
let currentEnabled = false;
let currentActiveProfileId = null;
let currentProtocol = 'auto';
let refreshInProgress = false;
let refreshTimerId = null;

async function loadStatus() {
  const blockingSettings = await getContentBlockingSettings();
  blockTrackingInput.checked = blockingSettings.tracking;
  const response = await sendRuntimeCommand({ action: 'getStatus' });
  currentEnabled = Boolean(response?.enabled);
  currentActiveProfileId = response?.activeProfileId ?? null;
  currentProtocol = response?.selectedProtocol ?? 'auto';
  renderProfiles();
  enabledToggle.checked = currentEnabled;
  pingLine.classList.toggle('hidden', !currentEnabled);
  protocolField.classList.toggle('hidden', !currentActiveProfileId);
  toggleLabel.textContent = currentEnabled ? 'Прокси включён' : 'Прокси выключен';
  statusLine.textContent = currentEnabled ? `Активен: ${response?.activeProfileName ?? 'без названия'}` : '';
  statusLine.classList.toggle('hidden', !currentEnabled);

  protocolSelect.value = currentProtocol;
  if (updateProtocolOptions()) {
    currentProtocol = 'auto';
    await sendRuntimeCommand({
      action: 'applyProfile',
      profileId: currentActiveProfileId,
      protocol: 'auto',
    });
  }

  const lastError = currentEnabled ? response?.lastError : null;
  if (lastError) {
    errorBanner.textContent = `Предупреждение: ${lastError}`;
    errorBanner.classList.remove('hidden');
  } else {
    errorBanner.textContent = '';
    errorBanner.classList.add('hidden');
  }
}

async function saveContentBlockingSettings() {
  blockTrackingInput.disabled = true;
  let previousSettings = { tracking: !blockTrackingInput.checked };
  try {
    previousSettings = await getContentBlockingSettings();
    await setContentBlockingSettings({
      tracking: blockTrackingInput.checked,
    });
    await sendRuntimeCommand({ action: 'syncBlockRules' });
    showPopupError('');
  } catch (error) {
    blockTrackingInput.checked = previousSettings.tracking;
    try {
      await setContentBlockingSettings(previousSettings);
      await sendRuntimeCommand({ action: 'syncBlockRules' });
    } catch (rollbackError) {
      console.error('Unable to roll back content blocking settings:', rollbackError);
    }
    showPopupError(errorMessage(error));
  } finally {
    blockTrackingInput.disabled = false;
  }
}

function renderProfiles() {
  profileSelect.replaceChildren();

  const emptyOption = document.createElement('option');
  emptyOption.value = '';
  emptyOption.textContent = 'Без прокси';
  profileSelect.append(emptyOption);

  for (const profile of profilesCache) {
    const option = document.createElement('option');
    option.value = profile.id;
    option.textContent = profile.name || profile.id;
    profileSelect.append(option);
  }

  profileSelect.value = currentActiveProfileId ?? '';
}

function updateProtocolOptions() {
  const activeProfile = profilesCache.find((profile) => profile.id === currentActiveProfileId);
  const availableProtocols = getConfiguredProtocols(activeProfile);

  [...protocolSelect.options].forEach((option) => {
    option.hidden = option.value !== 'auto' && !availableProtocols.includes(option.value);
  });
  if (protocolSelect.value !== 'auto' && protocolSelect.selectedOptions[0]?.hidden) {
    protocolSelect.value = 'auto';
    return true;
  }
  return false;
}

async function loadProfiles() {
  profilesCache = await getProfileSummaries();
  renderProfiles();
  updateProtocolOptions();
}

function showPopupError(message) {
  errorBanner.textContent = message ? `Предупреждение: ${message}` : '';
  errorBanner.classList.toggle('hidden', !message);
}

function updateLiveText(element, text) {
  if (element.textContent === text) {
    return;
  }
  element.textContent = text;
  if (typeof element.animate === 'function') {
    element.animate([
      { opacity: 0.62, transform: 'translateY(1px)' },
      { opacity: 1, transform: 'translateY(0)' },
    ], {
      duration: 260,
      easing: 'ease-out',
    });
  }
}

async function refreshIp() {
  if (refreshIpButton.disabled || refreshInProgress) return;
  refreshInProgress = true;
  refreshIpButton.disabled = true;
  try {
    const response = await sendRuntimeMessage({ action: 'checkProxy' });
    if (!response?.ok) {
      if (response?.busy) {
        updateLiveText(ipLine, 'Текущий IP: выполняется проверка прокси');
        return;
      }
      updateLiveText(ipLine, `Текущий IP: ошибка (${response?.error ?? 'Не удалось проверить IP'})`);
      updateLiveText(pingLine, 'Пинг: —');
      if (currentEnabled) showPopupError(response?.error ?? 'Не удалось проверить IP');
      renderTips(response?.tips);
      return;
    }
    updateLiveText(ipLine, `Текущий IP: ${response.ip ?? 'неизвестен'}`);
    updateLiveText(pingLine, currentEnabled && Number.isFinite(response.ping)
      ? `Пинг: ${response.ping} мс`
      : 'Пинг: —');
    showPopupError('');
    renderTips([]);
  } catch (error) {
    const message = errorMessage(error);
    updateLiveText(ipLine, `Текущий IP: ошибка (${message})`);
    updateLiveText(pingLine, 'Пинг: —');
    if (currentEnabled) showPopupError(message);
    renderTips();
  } finally {
    refreshIpButton.disabled = false;
    refreshInProgress = false;
  }
}

function renderTips(items = [
  'Проверьте хост и порт прокси.',
  'Проверьте логин и пароль, если прокси требует авторизацию.',
  'Откройте chrome://net-internals/#proxy для диагностики Chrome.',
]) {
  const tips = Array.isArray(items) ? items : [];
  tipsList.replaceChildren();
  for (const tip of tips) {
    const item = document.createElement('li');
    item.textContent = tip;
    tipsList.append(item);
  }
  tipsList.classList.toggle('hidden', tips.length === 0);
}

async function updateFromBackground() {
  await loadProfiles();
  await loadStatus();
  await refreshIp();
}

async function restoreUiAfterError(error, reloadProfiles = false) {
  try {
    if (reloadProfiles) {
      await loadProfiles();
    }
    await loadStatus();
  } catch (reloadError) {
    console.error('Unable to restore popup state:', reloadError);
  }
  showPopupError(errorMessage(error));
}

enabledToggle.addEventListener('change', async () => {
  enabledToggle.disabled = true;
  try {
    if (enabledToggle.checked) {
      const selectedProfileId = profileSelect.value;
      if (!selectedProfileId) {
        throw new Error('Сначала выберите профиль.');
      }

      await sendRuntimeCommand({
        action: 'enable',
        profileId: selectedProfileId,
        protocol: protocolSelect.value,
      });
    } else {
      await sendRuntimeCommand({ action: 'disable' });
    }
    await updateFromBackground();
  } catch (error) {
    await restoreUiAfterError(error);
  } finally {
    enabledToggle.disabled = false;
  }
});

profileSelect.addEventListener('change', async () => {
  profileSelect.disabled = true;
  try {
    const selectedProfileId = profileSelect.value || null;
    currentActiveProfileId = selectedProfileId;
    if (!selectedProfileId) {
      await sendRuntimeCommand({ action: 'applyProfile', profileId: null, protocol: 'auto' });
    } else {
      updateProtocolOptions();
      await sendRuntimeCommand({
        action: 'applyProfile',
        profileId: selectedProfileId,
        protocol: protocolSelect.value,
      });
    }
    await loadProfiles();
    await loadStatus();
    await refreshIp();
  } catch (error) {
    await restoreUiAfterError(error, true);
  } finally {
    profileSelect.disabled = false;
  }
});

protocolSelect.addEventListener('change', async () => {
  protocolSelect.disabled = true;
  try {
    if (currentActiveProfileId) {
      await sendRuntimeCommand({ action: 'applyProfile', profileId: currentActiveProfileId, protocol: protocolSelect.value });
      await loadStatus();
      await refreshIp();
    }
  } catch (error) {
    await restoreUiAfterError(error);
  } finally {
    protocolSelect.disabled = false;
  }
});

refreshIpButton.addEventListener('click', refreshIp);
blockTrackingInput.addEventListener('change', saveContentBlockingSettings);

settingsButton.addEventListener('click', async () => {
  try {
    await chrome.runtime.openOptionsPage();
  } catch (error) {
    showPopupError(errorMessage(error));
  }
});

try {
  await updateFromBackground();
} catch (error) {
  showPopupError(errorMessage(error));
}

refreshTimerId = setInterval(() => {
  void refreshIp();
}, 5000);

window.addEventListener('pagehide', () => {
  if (refreshTimerId) {
    clearInterval(refreshTimerId);
    refreshTimerId = null;
  }
}, { once: true });
