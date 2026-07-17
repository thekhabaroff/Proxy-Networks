export function storageGet(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (items) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(items);
    });
  });
}

export function storageSet(items) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(items, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve();
    });
  });
}

export function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(response);
    });
  });
}

export async function sendRuntimeCommand(message) {
  const response = await sendRuntimeMessage(message);
  if (!response?.ok) {
    throw new Error(response?.error || 'Команда расширения завершилась с ошибкой.');
  }
  return response;
}

export function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export function normalizeStringList(value) {
  const items = typeof value === 'string'
    ? value.split(/[\n,]+/)
    : Array.isArray(value) ? value : [];

  return [...new Set(items.map((item) => String(item).trim()).filter(Boolean))];
}

export function normalizeProxyHost(host) {
  if (typeof host !== 'string') {
    return '';
  }

  const value = host.trim();
  return value.startsWith('[') && value.endsWith(']')
    ? value.slice(1, -1)
    : value;
}

export function isValidProxyHost(host) {
  const value = normalizeProxyHost(host);
  if (!value || value.length > 253 || /[\s/?#@\\]/.test(value) || value.includes('://')) {
    return false;
  }

  try {
    const url = value.includes(':')
      ? new URL(`http://[${value}]/`)
      : new URL(`http://${value}/`);
    return Boolean(url.hostname);
  } catch {
    return false;
  }
}

export function normalizePort(port) {
  const value = Number(port);
  return Number.isInteger(value) && value >= 1 && value <= 65535 ? value : 0;
}

export function normalizeDomain(domain) {
  if (typeof domain !== 'string') {
    return null;
  }

  const value = domain.trim().replace(/^\*\./, '').replace(/^\.+/, '').replace(/\.$/, '');
  if (!value || value.startsWith('<') || /[\s/?#@\\]/.test(value) || value.includes('://')) {
    return null;
  }

  try {
    return new URL(`http://${value}/`).hostname || null;
  } catch {
    return null;
  }
}
