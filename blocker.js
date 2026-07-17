import { resolveGeositeDomainList } from './geosite.js';
import { normalizeDomain } from './utils.js';

const BLOCK_RULE_ID_START = 1000000;
const MAX_BLOCK_RULES = Number(
  chrome.declarativeNetRequest.MAX_NUMBER_OF_DYNAMIC_RULES
    ?? chrome.declarativeNetRequest.MAX_NUMBER_OF_DYNAMIC_AND_SESSION_RULES
    ?? 5000,
);
const BLOCKED_RESOURCE_TYPES = Object.freeze([
  'main_frame',
  'sub_frame',
  'stylesheet',
  'script',
  'image',
  'font',
  'object',
  'xmlhttprequest',
  'ping',
  'media',
  'websocket',
  'other',
]);

function buildBlockRules(entries) {
  const domains = [...new Set(entries.map(normalizeDomain).filter(Boolean))];
  if (domains.length > MAX_BLOCK_RULES) {
    throw new Error(`Список блокировки содержит ${domains.length} доменов. Лимит Chrome — ${MAX_BLOCK_RULES}.`);
  }

  return domains.map((domain, index) => ({
    id: BLOCK_RULE_ID_START + index,
    priority: 1,
    action: { type: 'block' },
    condition: {
      urlFilter: `||${domain}^`,
      resourceTypes: BLOCKED_RESOURCE_TYPES,
    },
  }));
}

export async function updateBlockRules(blockList = []) {
  const expandedList = blockList.length > 0
    ? await resolveGeositeDomainList(blockList)
    : [];
  const rules = buildBlockRules(expandedList);
  const currentRules = await chrome.declarativeNetRequest.getDynamicRules();
  // This extension owns the whole dynamic ruleset. Remove every existing
  // dynamic rule so rules created by an older version cannot survive after
  // the user disables blocking or reloads the unpacked extension.
  const managedRuleIds = currentRules.map((rule) => rule.id);

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: managedRuleIds,
    addRules: rules,
  });

  return rules.length;
}
