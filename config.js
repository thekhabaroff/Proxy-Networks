import {
  isValidProxyHost,
  normalizePort,
  normalizeProxyHost,
} from './utils.js';

export const PROTOCOLS = Object.freeze(['auto', 'http', 'https', 'socks']);

const PROXY_SCHEMES = new Set(['http', 'https', 'socks5']);
const PROFILE_ENDPOINT_KEYS = Object.freeze({
  http: 'proxyForHttp',
  https: 'proxyForHttps',
  socks: 'socks',
});

export function getProfileEndpoint(profile, protocol) {
  const key = PROFILE_ENDPOINT_KEYS[protocol];
  return key ? profile?.[key] ?? null : null;
}

export function getConfiguredProtocols(profile) {
  return Object.keys(PROFILE_ENDPOINT_KEYS)
    .filter((protocol) => Boolean(endpointToProxyServer(getProfileEndpoint(profile, protocol))));
}

function bypassEntryToAscii(entry) {
  if (typeof entry !== 'string') {
    return '';
  }

  const value = entry.trim();
  if (!value || !/[^\x00-\x7F]/.test(value)) {
    return value;
  }

  // Chrome accepts only ASCII URL patterns in proxy bypassList. Keep its
  // special tokens, wildcards and IP/CIDR entries intact while converting
  // internationalized domain names to their ASCII/Punycode form.
  const wildcard = value.startsWith('*.');
  const hostname = wildcard ? value.slice(2) : value;

  try {
    const asciiHostname = new URL(`http://${hostname}`).hostname;
    return wildcard ? `*.${asciiHostname}` : asciiHostname;
  } catch {
    // Leave malformed entries untouched so validation/error reporting can
    // still identify the value supplied by the user.
    return value;
  }
}

function normalizeBypassListForChrome(bypassList) {
  if (!Array.isArray(bypassList)) {
    return [];
  }

  return [...new Set(bypassList.map(bypassEntryToAscii).filter(Boolean))];
}

function addBypassList(rules, bypassList) {
  const normalized = normalizeBypassListForChrome(bypassList);
  if (normalized.length > 0) {
    rules.bypassList = normalized;
  }
  return rules;
}

export function endpointToProxyServer(endpoint) {
  if (!endpoint || typeof endpoint.host !== 'string') {
    return null;
  }

  const host = normalizeProxyHost(endpoint.host);
  const port = normalizePort(endpoint.port);
  if (!isValidProxyHost(host) || !PROXY_SCHEMES.has(endpoint.scheme) || !port) {
    return null;
  }

  return { scheme: endpoint.scheme, host, port };
}

function buildProxyConfig(profile) {
  if (!profile) {
    return { mode: 'direct' };
  }

  const rules = {};
  const httpProxy = endpointToProxyServer(profile.proxyForHttp);
  const httpsProxy = endpointToProxyServer(profile.proxyForHttps);
  const socksProxy = endpointToProxyServer(profile.socks);

  if (httpProxy) rules.proxyForHttp = httpProxy;
  if (httpsProxy) rules.proxyForHttps = httpsProxy;
  if (socksProxy) rules.fallbackProxy = socksProxy;
  addBypassList(rules, profile.bypassList);

  return httpProxy || httpsProxy || socksProxy
    ? { mode: 'fixed_servers', rules }
    : { mode: 'direct' };
}

export function buildSelectedProxyConfig(profile, protocol = 'auto') {
  if (protocol === 'auto') {
    return buildProxyConfig(profile);
  }
  if (!PROTOCOLS.includes(protocol)) {
    throw new Error('Неизвестный протокол прокси.');
  }

  const endpoint = getProfileEndpoint(profile, protocol);
  const server = endpointToProxyServer(endpoint);
  if (!server) {
    throw new Error('Для выбранного протокола не настроен прокси.');
  }

  return {
    mode: 'fixed_servers',
    rules: addBypassList({
      singleProxy: server,
    }, profile?.bypassList),
  };
}
