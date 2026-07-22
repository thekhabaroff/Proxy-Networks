import {
  deleteProfile,
  getActiveProfileId,
  getEnabled,
  getProfiles,
  normalizeProfile,
  reorderProfiles,
  saveProfile,
  saveProfiles,
} from './storage.js';
import { geositeNameFromEntry } from './geosite.js';
import {
  errorMessage,
  isValidProxyHost,
  normalizeDomain,
  normalizePort,
  parseProxyClipboardEntry,
  normalizeStringList,
  sendRuntimeCommand,
  sendRuntimeMessage,
} from './utils.js';

const profilesList = document.getElementById('profilesList');
const newProfileButton = document.getElementById('newProfileButton');
const formTitle = document.getElementById('formTitle');
const profileForm = document.getElementById('profileForm');
const profileIdInput = document.getElementById('profileId');
const nameInput = document.getElementById('name');
const httpHostInput = document.getElementById('httpHost');
const httpPortInput = document.getElementById('httpPort');
const httpsHostInput = document.getElementById('httpsHost');
const httpsPortInput = document.getElementById('httpsPort');
const socksHostInput = document.getElementById('socksHost');
const socksPortInput = document.getElementById('socksPort');
const bypassListInput = document.getElementById('bypassList');
const bypassRussianResourcesInput = document.getElementById('bypassRussianResources');
const bypassLocalNetworksInput = document.getElementById('bypassLocalNetworks');
const blockListInput = document.getElementById('blockList');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const formError = document.getElementById('formError');
const formSuccess = document.getElementById('formSuccess');
const deleteButton = document.getElementById('deleteButton');
const saveButton = document.getElementById('saveButton');
const checkProxyButtons = [...document.querySelectorAll('.check-proxy-button')];
const exportProfilesButton = document.getElementById('exportProfilesButton');
const importProfilesButton = document.getElementById('importProfilesButton');
const importProfilesInput = document.getElementById('importProfilesInput');
const togglePasswordButton = document.getElementById('togglePasswordButton');
const clearPasswordButton = document.getElementById('clearPasswordButton');
const pasteProxyButton = document.getElementById('pasteProxyButton');

const ALLOWED_SCHEMES = new Set(['http', 'https', 'socks5']);
const PROXY_URL_PROTOCOLS = new Set(['http:', 'https:', 'socks:', 'socks5:']);
const PROTOCOL_NAMES = Object.freeze({
  http: 'HTTP',
  https: 'HTTPS',
  socks: 'SOCKS5',
});
const PROXY_FIELDS = Object.freeze({
  http: { scheme: 'http', hostInput: httpHostInput, portInput: httpPortInput },
  https: { scheme: 'https', hostInput: httpsHostInput, portInput: httpsPortInput },
  socks: { scheme: 'socks5', hostInput: socksHostInput, portInput: socksPortInput },
});

let profiles = [];
let selectedProfileId = null;
let successTimer = null;
let draggedProfileId = null;
const proxyStatusTimers = new Map();
const PROXY_RESULT_TIMEOUT_MS = 10000;

function showError(message) {
  if (!message) {
    formError.classList.add('hidden');
    formError.textContent = '';
    return;
  }

  formError.textContent = message;
  formError.classList.remove('hidden');
}

function showSuccess(message) {
  clearTimeout(successTimer);
  if (!message) {
    formSuccess.classList.add('hidden');
    formSuccess.textContent = '';
    return;
  }

  formSuccess.textContent = message;
  formSuccess.classList.remove('hidden');
  successTimer = setTimeout(() => showSuccess(''), 2200);
}

function formatStringList(items) {
  return Array.isArray(items) ? items.join('\n') : '';
}

function parseProxyUrl(value) {
  const trimmed = value.trim();
  if (!trimmed.includes('://')) {
    return null;
  }

  try {
    const url = new URL(trimmed);
    if (!PROXY_URL_PROTOCOLS.has(url.protocol)
      || url.username
      || url.password
      || (url.pathname && url.pathname !== '/')
      || url.search
      || url.hash) {
      return null;
    }
    return {
      host: url.hostname,
      port: url.port ? Number(url.port) : 0,
    };
  } catch {
    return null;
  }
}

function endpointFromInputs(scheme, hostInputEl, portInputEl) {
  const parsed = parseProxyUrl(hostInputEl.value);
  const host = parsed?.host ?? hostInputEl.value.trim();
  const port = parsed?.port || Number(portInputEl.value);

  if (!host && !portInputEl.value.trim()) {
    return null;
  }

  return {
    scheme,
    host,
    port,
  };
}

function renderProfileList() {
  profilesList.replaceChildren();

  for (const profile of profiles) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `profile-item${profile.id === selectedProfileId ? ' active' : ''}`;
    item.draggable = true;
    item.title = 'Перетащите профиль, чтобы изменить порядок.';
    item.setAttribute('aria-pressed', String(profile.id === selectedProfileId));
    const name = document.createElement('span');
    name.className = 'profile-name';
    name.textContent = profile.name || profile.id;
    item.append(name);
    item.addEventListener('click', () => {
      loadProfile(profile.id);
    });
    item.addEventListener('dragstart', (event) => {
      draggedProfileId = profile.id;
      item.classList.add('dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', profile.id);
    });
    item.addEventListener('dragend', () => {
      draggedProfileId = null;
      item.classList.remove('dragging');
      profilesList.querySelectorAll('.drop-target').forEach((element) => {
        element.classList.remove('drop-target');
      });
    });
    item.addEventListener('dragover', (event) => {
      if (!draggedProfileId || draggedProfileId === profile.id) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
    });
    item.addEventListener('dragenter', () => {
      if (draggedProfileId && draggedProfileId !== profile.id) {
        item.classList.add('drop-target');
      }
    });
    item.addEventListener('dragleave', () => {
      item.classList.remove('drop-target');
    });
    item.addEventListener('drop', (event) => {
      event.preventDefault();
      item.classList.remove('drop-target');
      const sourceId = draggedProfileId || event.dataTransfer.getData('text/plain');
      void moveProfile(sourceId, profile.id);
    });
    profilesList.append(item);
  }
}

async function moveProfile(sourceId, targetId) {
  if (!sourceId || sourceId === targetId) {
    return;
  }

  const sourceIndex = profiles.findIndex((profile) => profile.id === sourceId);
  const targetIndex = profiles.findIndex((profile) => profile.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0) {
    return;
  }

  const nextProfiles = [...profiles];
  const [movedProfile] = nextProfiles.splice(sourceIndex, 1);
  const insertionIndex = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
  nextProfiles.splice(insertionIndex, 0, movedProfile);
  profiles = nextProfiles;
  renderProfileList();

  try {
    await reorderProfiles(profiles.map((profile) => profile.id));
    showSuccess('Порядок профилей сохранён.');
  } catch (error) {
    await loadProfiles();
    showError(errorMessage(error));
  }
}

function setProxyStatus(status, state = '', details = '') {
  if (!status) {
    return;
  }
  const statusText = {
    online: 'доступен',
    offline: 'недоступен',
    invalid: 'некорректные параметры',
    checking: 'проверяется',
  }[state] ?? 'не проверен';
  const protocolName = PROTOCOL_NAMES[status.dataset.protocol] ?? 'прокси';
  status.className = `proxy-status${state ? ` ${state}` : ''}`;
  status.title = details;
  status.setAttribute('aria-label', `Статус ${protocolName}: ${statusText}${details ? `. ${details}` : ''}`);
}

function setProxyPing(protocol, ping = null) {
  const pingElement = document.querySelector(`.proxy-ping[data-protocol="${protocol}"]`);
  if (!pingElement) {
    return;
  }
  pingElement.textContent = Number.isFinite(ping) ? `Пинг: ${ping} мс` : '';
}

function clearProxyStatusTimer(protocol) {
  const timerId = proxyStatusTimers.get(protocol);
  if (timerId) {
    clearTimeout(timerId);
    proxyStatusTimers.delete(protocol);
  }
}

function clearProxyCheckResult(protocol) {
  const status = document.querySelector(`.proxy-status[data-protocol="${protocol}"]`);
  setProxyStatus(status);
  setProxyPing(protocol);
}

function scheduleProxyCheckResultClear(protocol) {
  clearProxyStatusTimer(protocol);
  const timerId = setTimeout(() => {
    clearProxyCheckResult(protocol);
    proxyStatusTimers.delete(protocol);
  }, PROXY_RESULT_TIMEOUT_MS);
  proxyStatusTimers.set(protocol, timerId);
}

function resetProtocolStatuses() {
  for (const status of document.querySelectorAll('.proxy-status')) {
    const protocol = status.dataset.protocol;
    clearProxyStatusTimer(protocol);
    clearProxyCheckResult(protocol);
  }
}

function fillForm(profile) {
  resetProtocolStatuses();
  profileIdInput.value = profile?.id ?? '';
  nameInput.value = profile?.name ?? '';
  httpHostInput.value = profile?.proxyForHttp?.host ?? '';
  httpPortInput.value = profile?.proxyForHttp?.port ? String(profile.proxyForHttp.port) : '';
  httpsHostInput.value = profile?.proxyForHttps?.host ?? '';
  httpsPortInput.value = profile?.proxyForHttps?.port ? String(profile.proxyForHttps.port) : '';
  socksHostInput.value = profile?.socks?.host ?? '';
  socksPortInput.value = profile?.socks?.port ? String(profile.socks.port) : '';
  bypassListInput.value = formatStringList(profile?.bypassList ?? []);
  bypassRussianResourcesInput.checked = profile?.bypassRussianResources === true;
  bypassLocalNetworksInput.checked = profile?.bypassLocalNetworks === true;
  blockListInput.value = formatStringList(profile?.blockList ?? []);
  usernameInput.value = profile?.username ?? '';
  passwordInput.value = profile?.password ?? '';
  passwordInput.type = 'password';
  togglePasswordButton.textContent = 'Показать пароль';
  formTitle.textContent = profile?.id ? `Профиль: ${profile.name || profile.id}` : 'Новый профиль';
  deleteButton.disabled = !profile?.id;
}

function loadProfile(id) {
  const profile = profiles.find((item) => item.id === id) ?? null;
  selectedProfileId = profile?.id ?? null;
  renderProfileList();
  fillForm(profile);
  showError('');
  showSuccess('');
}

async function loadProfiles() {
  const [loadedProfiles, activeProfileId] = await Promise.all([
    getProfiles(),
    getActiveProfileId(),
  ]);
  profiles = loadedProfiles;
  selectedProfileId = selectedProfileId && profiles.some((item) => item.id === selectedProfileId)
    ? selectedProfileId
    : activeProfileId ?? profiles[0]?.id ?? null;
  renderProfileList();
  fillForm(profiles.find((item) => item.id === selectedProfileId) ?? null);
}

function validateProfile(data) {
  if (!data || typeof data.name !== 'string' || !data.name.trim()) {
    return 'Введите название профиля.';
  }
  if (data.name.length > 120) {
    return 'Название профиля не должно превышать 120 символов.';
  }

  const endpoints = [data.proxyForHttp, data.proxyForHttps, data.socks].filter(Boolean);
  if (endpoints.length === 0) {
    return 'Заполните хотя бы один прокси-эндпоинт.';
  }

  for (const endpoint of endpoints) {
    if (typeof endpoint !== 'object') {
      return 'Прокси-эндпоинт имеет некорректный формат.';
    }
    if (!ALLOWED_SCHEMES.has(endpoint.scheme)) {
      return 'Выбрана неизвестная схема прокси-эндпоинта.';
    }
    if (!isValidProxyHost(endpoint.host)) {
      return 'Укажите корректный хост для всех заполненных прокси-эндпоинтов без http://, путей и пробелов.';
    }
    if (!normalizePort(endpoint.port)) {
      return 'Порт должен быть числом от 1 до 65535.';
    }
  }

  if (data.proxyForHttp && data.proxyForHttp.scheme !== 'http') {
    return 'HTTP прокси должен использовать протокол http.';
  }

  if (data.proxyForHttps && data.proxyForHttps.scheme !== 'https') {
    return 'HTTPS прокси должен использовать протокол https.';
  }

  if (data.socks && data.socks.scheme !== 'socks5') {
    return 'SOCKS прокси должен использовать только socks5.';
  }

  for (const [entries, label] of [
    [data.bypassList, 'исключениях'],
    [data.blockList, 'списке блокировки'],
  ]) {
    for (const entry of entries) {
      if (/^geosite:/i.test(entry) && !geositeNameFromEntry(entry)) {
        return `Некорректная geosite-запись в ${label}: ${entry}`;
      }
    }
  }
  for (const entry of data.blockList) {
    if (!geositeNameFromEntry(entry) && !normalizeDomain(entry)) {
      return `Некорректный домен в списке блокировки: ${entry}`;
    }
  }
  if (data.username.length > 256) {
    return 'Логин не должен превышать 256 символов.';
  }
  if (data.password.length > 1024) {
    return 'Пароль не должен превышать 1024 символа.';
  }

  return '';
}

function collectProfile() {
  return {
    id: profileIdInput.value || undefined,
    name: nameInput.value.trim(),
    proxyForHttp: endpointFromInputs('http', httpHostInput, httpPortInput),
    proxyForHttps: endpointFromInputs('https', httpsHostInput, httpsPortInput),
    socks: endpointFromInputs('socks5', socksHostInput, socksPortInput),
    bypassList: normalizeStringList(bypassListInput.value),
    bypassRussianResources: bypassRussianResourcesInput.checked,
    bypassLocalNetworks: bypassLocalNetworksInput.checked,
    blockList: normalizeStringList(blockListInput.value),
    username: usernameInput.value.trim(),
    password: passwordInput.value,
  };
}

function applyClipboardProxy(proxy) {
  const fields = PROXY_FIELDS[proxy.protocol];
  if (!fields) {
    throw new Error('Не удалось определить тип прокси.');
  }

  fields.hostInput.value = proxy.host;
  fields.portInput.value = String(proxy.port);
  if (proxy.username !== null) {
    usernameInput.value = proxy.username;
    passwordInput.value = proxy.password ?? '';
  }
  resetProtocolStatuses();
  showError('');

  const protocolName = PROTOCOL_NAMES[proxy.protocol] ?? 'прокси';
  const authNote = proxy.username === null
    ? ' Данные авторизации не изменены.'
    : '';
  showSuccess(`${protocolName} прокси вставлен в форму.${authNote} Нажмите «Сохранить», чтобы применить изменения.`);
}

async function refreshAfterSave(savedProfile) {
  await loadProfiles();
  loadProfile(savedProfile.id);
  const enabled = await getEnabled();
  if (enabled && savedProfile.id === (await getActiveProfileId())) {
    await sendRuntimeCommand({ action: 'applyProfile', profileId: savedProfile.id });
  }
}

profileForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const profile = collectProfile();
  const validationError = validateProfile(profile);
  if (validationError) {
    showSuccess('');
    showError(validationError);
    return;
  }

  showError('');
  saveButton.disabled = true;
  try {
    const savedProfile = await saveProfile(profile);
    await refreshAfterSave(savedProfile);
    showSuccess('Профиль сохранён.');
  } catch (error) {
    showError(errorMessage(error));
  } finally {
    saveButton.disabled = false;
  }
});

newProfileButton.addEventListener('click', () => {
  selectedProfileId = null;
  renderProfileList();
  fillForm(null);
  showError('');
  showSuccess('');
});

deleteButton.addEventListener('click', async () => {
  const id = profileIdInput.value;
  if (!id) {
    return;
  }

  if (!confirm('Удалить этот профиль?')) {
    return;
  }

  deleteButton.disabled = true;
  try {
    const activeProfileId = await getActiveProfileId();
    if (id === activeProfileId && await getEnabled()) {
      await sendRuntimeCommand({ action: 'disable' });
    }
    await deleteProfile(id);
    await loadProfiles();
    showSuccess('Профиль удалён.');
  } catch (error) {
    showError(errorMessage(error));
  } finally {
    deleteButton.disabled = !profileIdInput.value;
  }
});

for (const button of checkProxyButtons) {
  button.addEventListener('click', async () => {
    const protocol = button.dataset.protocol;
    const status = document.querySelector(`.proxy-status[data-protocol="${protocol}"]`);
    const fields = PROXY_FIELDS[protocol];
    const endpoint = fields
      ? endpointFromInputs(fields.scheme, fields.hostInput, fields.portInput)
      : null;
    clearProxyStatusTimer(protocol);
    if (!endpoint || !isValidProxyHost(endpoint.host) || !normalizePort(endpoint.port)) {
      setProxyStatus(status, 'invalid', 'Укажите корректные хост и порт.');
      setProxyPing(protocol);
      scheduleProxyCheckResultClear(protocol);
      return;
    }
    for (const checkButton of checkProxyButtons) checkButton.disabled = true;
    setProxyStatus(status, 'checking', 'Проверка…');
    setProxyPing(protocol);
    try {
      const response = await sendRuntimeMessage({
        action: 'checkProxyEndpoint',
        endpoint,
        username: usernameInput.value.trim(),
        password: passwordInput.value,
      });
      setProxyStatus(
        status,
        response?.ok ? 'online' : 'offline',
        response?.error || (response?.ip ? `IP: ${response.ip}` : ''),
      );
      setProxyPing(protocol, response?.ok ? response.ping : null);
    } catch (error) {
      setProxyStatus(status, 'offline', errorMessage(error));
      setProxyPing(protocol);
    } finally {
      for (const checkButton of checkProxyButtons) checkButton.disabled = false;
      scheduleProxyCheckResultClear(protocol);
    }
  });
}

for (const [protocol, fields] of Object.entries(PROXY_FIELDS)) {
  for (const input of [fields.hostInput, fields.portInput]) {
    input.addEventListener('input', () => {
      const status = document.querySelector(`.proxy-status[data-protocol="${protocol}"]`);
      clearProxyStatusTimer(protocol);
      clearProxyCheckResult(protocol);
    });
  }
}

profileForm.addEventListener('input', () => {
  showSuccess('');
});

usernameInput.addEventListener('input', resetProtocolStatuses);
passwordInput.addEventListener('input', resetProtocolStatuses);

window.addEventListener('pagehide', () => {
  for (const timerId of proxyStatusTimers.values()) {
    clearTimeout(timerId);
  }
  proxyStatusTimers.clear();
}, { once: true });

exportProfilesButton.addEventListener('click', async () => {
  const includePasswords = confirm('Экспортировать профили вместе с паролями? Нажмите “Отмена”, чтобы экспортировать без паролей.');
  exportProfilesButton.disabled = true;
  try {
    const exportedProfiles = (await getProfiles()).map((profile) => ({
      name: profile.name,
      proxyForHttp: profile.proxyForHttp,
      proxyForHttps: profile.proxyForHttps,
      socks: profile.socks,
      bypassList: profile.bypassList,
      bypassRussianResources: profile.bypassRussianResources === true,
      bypassLocalNetworks: profile.bypassLocalNetworks === true,
      blockList: profile.blockList,
      username: profile.username,
      password: includePasswords ? profile.password : '',
    }));
    const blob = new Blob([JSON.stringify({ version: 1, profiles: exportedProfiles }, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'proxy-networks-profiles.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    showSuccess(includePasswords ? 'Профили экспортированы с паролями.' : 'Профили экспортированы без паролей.');
  } catch (error) {
    showError(errorMessage(error));
  } finally {
    exportProfilesButton.disabled = false;
  }
});

importProfilesButton.addEventListener('click', () => {
  importProfilesInput.click();
});

importProfilesInput.addEventListener('change', async () => {
  const file = importProfilesInput.files?.[0];
  if (!file) {
    return;
  }

  importProfilesButton.disabled = true;
  try {
    if (file.size > 1024 * 1024) {
      throw new Error('Файл импорта не должен превышать 1 МБ.');
    }
    const payload = JSON.parse(await file.text());
    const importedProfiles = Array.isArray(payload?.profiles) ? payload.profiles : null;
    if (!importedProfiles) {
      throw new Error('Файл должен содержать массив profiles.');
    }
    if (importedProfiles.length > 500) {
      throw new Error('За один раз можно импортировать не более 500 профилей.');
    }

    const preparedProfiles = importedProfiles.map((profile) => {
      if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
        throw new Error('Каждый профиль должен быть объектом.');
      }
      const prepared = normalizeProfile({
        ...profile,
        id: '',
        name: profile.name ? `${profile.name} (import)` : 'Imported profile',
      });
      const validationError = validateProfile(prepared);
      if (validationError) {
        throw new Error(validationError);
      }
      return prepared;
    });

    await saveProfiles(preparedProfiles);

    await loadProfiles();
    showError('');
    showSuccess(`Импортировано профилей: ${importedProfiles.length}.`);
  } catch (error) {
    showSuccess('');
    showError(errorMessage(error));
  } finally {
    importProfilesInput.value = '';
    importProfilesButton.disabled = false;
  }
});

pasteProxyButton.addEventListener('click', async () => {
  if (!navigator.clipboard?.readText) {
    showError('Браузер не поддерживает чтение буфера обмена.');
    return;
  }

  pasteProxyButton.disabled = true;
  try {
    const proxy = parseProxyClipboardEntry(await navigator.clipboard.readText());
    applyClipboardProxy(proxy);
  } catch (error) {
    showSuccess('');
    showError(errorMessage(error));
  } finally {
    pasteProxyButton.disabled = false;
  }
});

togglePasswordButton.addEventListener('click', () => {
  const nextType = passwordInput.type === 'password' ? 'text' : 'password';
  passwordInput.type = nextType;
  togglePasswordButton.textContent = nextType === 'password' ? 'Показать пароль' : 'Скрыть пароль';
});

clearPasswordButton.addEventListener('click', () => {
  passwordInput.value = '';
  resetProtocolStatuses();
  showError('');
  showSuccess('Пароль очищен в форме. Нажмите “Сохранить”, чтобы применить изменение.');
});

try {
  await loadProfiles();
} catch (error) {
  showError(errorMessage(error));
}

window.addEventListener('pagehide', () => {
  clearTimeout(successTimer);
}, { once: true });
