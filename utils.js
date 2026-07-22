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

const CLIPBOARD_PROXY_PROTOCOLS = Object.freeze({
  http: 'http',
  https: 'https',
  socks: 'socks',
  socks5: 'socks',
});

function decodeProxyCredential(value, label) {
  try {
    const decoded = decodeURIComponent(value);
    if (/[\u0000\r\n]/.test(decoded)) {
      throw new Error('Недопустимые символы.');
    }
    return decoded;
  } catch {
    throw new Error(`Некорректно записан ${label}. Используйте URL-кодирование для специальных символов.`);
  }
}

function parseProxyCredentials(value) {
  const separatorIndex = value.indexOf(':');
  if (separatorIndex < 1) {
    throw new Error('Авторизация должна быть записана как login:password.');
  }

  return normalizeProxyCredentials(value.slice(0, separatorIndex), value.slice(separatorIndex + 1));
}

function normalizeProxyCredentials(username, password) {
  const normalizedUsername = decodeProxyCredential(username, 'логин');
  if (!normalizedUsername) {
    throw new Error('Укажите логин перед паролем.');
  }

  return {
    username: normalizedUsername,
    password: decodeProxyCredential(password, 'пароль'),
  };
}

function parseProxyHostPort(value) {
  const ipv6Match = /^\[([^\]]+)\]:(\d+)$/.exec(value);
  if (ipv6Match) {
    return { host: ipv6Match[1], port: Number(ipv6Match[2]) };
  }

  const separatorIndex = value.lastIndexOf(':');
  if (separatorIndex < 1) {
    return null;
  }

  const host = value.slice(0, separatorIndex);
  const port = value.slice(separatorIndex + 1);
  if (host.includes(':') || !/^\d+$/.test(port)) {
    return null;
  }
  return { host, port: Number(port) };
}

function normalizeClipboardEndpoint(protocol, endpoint, credentials = null) {
  const host = normalizeProxyHost(endpoint?.host);
  const port = normalizePort(endpoint?.port);
  if (!isValidProxyHost(host) || !port) {
    throw new Error('Не удалось определить корректные хост и порт прокси.');
  }

  return {
    protocol,
    host,
    port,
    username: credentials?.username ?? null,
    password: credentials?.password ?? null,
  };
}

function parseProxyUrlFromClipboard(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Не удалось прочитать URL прокси.');
  }

  const protocol = CLIPBOARD_PROXY_PROTOCOLS[url.protocol.replace(/:$/, '').toLowerCase()];
  if (!protocol) {
    throw new Error('Поддерживаются только HTTP, HTTPS и SOCKS5-прокси.');
  }
  if ((url.pathname && url.pathname !== '/') || url.search || url.hash) {
    throw new Error('Строка прокси не должна содержать путь, параметры или якорь.');
  }

  const credentials = url.username || url.password
    ? normalizeProxyCredentials(url.username, url.password)
    : null;

  return normalizeClipboardEndpoint(protocol, {
    host: url.hostname,
    port: Number(url.port),
  }, credentials);
}

function protocolFromClipboardPrefix(value) {
  const match = /^(https?|socks5?):(?:\/\/)?/i.exec(value);
  if (!match) {
    return { protocol: 'http', entry: value };
  }

  return {
    protocol: CLIPBOARD_PROXY_PROTOCOLS[match[1].toLowerCase()],
    entry: value.slice(match[0].length),
  };
}

function parseAtSeparatedProxy(value, protocol) {
  const atIndex = value.lastIndexOf('@');
  if (atIndex < 1 || atIndex === value.length - 1) {
    return null;
  }

  const left = value.slice(0, atIndex);
  const right = value.slice(atIndex + 1);
  const endpointAfterCredentials = parseProxyHostPort(right);
  if (endpointAfterCredentials) {
    return normalizeClipboardEndpoint(protocol, endpointAfterCredentials, parseProxyCredentials(left));
  }

  const endpointBeforeCredentials = parseProxyHostPort(left);
  if (endpointBeforeCredentials) {
    return normalizeClipboardEndpoint(protocol, endpointBeforeCredentials, parseProxyCredentials(right));
  }

  return null;
}

function parseDelimitedProxy(value, protocol, delimiter) {
  if (!value.includes(delimiter)) {
    return null;
  }

  const parts = value.split(delimiter);
  if (parts.some((part) => !part)) {
    return null;
  }
  if (parts.length === 2) {
    return normalizeClipboardEndpoint(protocol, { host: parts[0], port: Number(parts[1]) });
  }
  if (parts.length < 4) {
    return null;
  }
  if (/^\d+$/.test(parts[1])) {
    return normalizeClipboardEndpoint(protocol, {
      host: parts[0],
      port: Number(parts[1]),
    }, normalizeProxyCredentials(parts[2], parts.slice(3).join(delimiter)));
  }
  if (/^\d+$/.test(parts.at(-1))) {
    return normalizeClipboardEndpoint(protocol, {
      host: parts.at(-2),
      port: Number(parts.at(-1)),
    }, normalizeProxyCredentials(parts[0], parts.slice(1, -2).join(delimiter)));
  }
  return null;
}

function parseColonSeparatedProxy(value, protocol) {
  const hostPort = parseProxyHostPort(value);
  if (hostPort) {
    return normalizeClipboardEndpoint(protocol, hostPort);
  }

  const endpointFirstMatch = /^([^:]+):(\d+):([^:]+):(.+)$/.exec(value);
  if (endpointFirstMatch) {
    return normalizeClipboardEndpoint(protocol, {
      host: endpointFirstMatch[1],
      port: Number(endpointFirstMatch[2]),
    }, normalizeProxyCredentials(endpointFirstMatch[3], endpointFirstMatch[4]));
  }

  const credentialsFirstMatch = /^([^:]+):(.+):([^:]+):(\d+)$/.exec(value);
  if (credentialsFirstMatch) {
    return normalizeClipboardEndpoint(protocol, {
      host: credentialsFirstMatch[3],
      port: Number(credentialsFirstMatch[4]),
    }, normalizeProxyCredentials(credentialsFirstMatch[1], credentialsFirstMatch[2]));
  }

  return null;
}

/**
 * Parses one proxy copied by a user. The returned protocol matches the
 * profile fields: http, https, or socks (SOCKS5).
 */
export function parseProxyClipboardEntry(value) {
  if (typeof value !== 'string') {
    throw new TypeError('Буфер обмена не содержит текст прокси.');
  }

  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length !== 1 || lines[0].length > 4096) {
    throw new Error('Вставьте одну строку прокси длиной не более 4096 символов.');
  }

  const entry = lines[0];
  if (/\s/.test(entry)) {
    throw new Error('Строка прокси не должна содержать пробелы.');
  }
  if (entry.includes('://')) {
    try {
      return parseProxyUrlFromClipboard(entry);
    } catch (error) {
      const prefixed = protocolFromClipboardPrefix(entry);
      if (prefixed.entry === entry || /[/?#]/.test(prefixed.entry)) {
        throw error;
      }
    }
  }

  const { protocol, entry: unprefixedEntry } = protocolFromClipboardPrefix(entry);
  if (!unprefixedEntry) {
    throw new Error('После типа прокси укажите хост и порт.');
  }

  const parsed = parseAtSeparatedProxy(unprefixedEntry, protocol)
    ?? parseDelimitedProxy(unprefixedEntry, protocol, ';')
    ?? parseDelimitedProxy(unprefixedEntry, protocol, '|')
    ?? parseColonSeparatedProxy(unprefixedEntry, protocol);
  if (parsed) {
    return parsed;
  }

  throw new Error('Формат не распознан. Используйте host:port, login:pass@host:port или URL прокси.');
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
