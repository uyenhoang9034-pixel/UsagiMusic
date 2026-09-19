import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);

const DEFAULT_NODE_NAME = 'Usagi Lavalink';
const DEFAULT_HOST = 'localhost';
const DEFAULT_PORT = 2333;
const DEFAULT_PASSWORD = 'youshallnotpass';

function parseBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  const normalized = String(value).trim().toLowerCase();

  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) {
    return true;
  }

  if (['false', '0', 'no', 'n', 'off'].includes(normalized)) {
    return false;
  }

  return defaultValue;
}

function parsePort(value, defaultValue = DEFAULT_PORT) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    return defaultValue;
  }

  return parsed;
}

function parseNodesPayload(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (Array.isArray(payload?.nodes)) {
    return payload.nodes;
  }

  if (payload?.host || payload?.hostname) {
    return [payload];
  }

  return null;
}

function normalizeNode(rawNode, index = 0) {
  if (!rawNode || typeof rawNode !== 'object') {
    return null;
  }

  const host = String(rawNode.host || rawNode.hostname || '').trim();

  if (!host) {
    return null;
  }

  const port = parsePort(rawNode.port);
  const secure = parseBoolean(rawNode.secure, port === 443);
  const password = String(
    rawNode.password ?? process.env.LAVALINK_PASSWORD ?? DEFAULT_PASSWORD,
  );
  const name = String(
    rawNode.name || rawNode.identifier || `${DEFAULT_NODE_NAME} ${index + 1}`,
  ).trim();

  return {
    host,
    port,
    password,
    secure,
    name,
  };
}

function normalizeNodes(payload) {
  const nodeList = parseNodesPayload(payload);

  if (!Array.isArray(nodeList)) {
    return null;
  }

  const nodes = nodeList
    .map((node, index) => normalizeNode(node, index))
    .filter(Boolean);

  return nodes.length > 0 ? nodes : null;
}

function parseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function parseNodesFromEnv() {
  const raw = process.env.LAVALINK_NODES?.trim();

  if (!raw) {
    return null;
  }

  const parsed = parseJson(raw);

  if (!parsed) {
    return null;
  }

  return normalizeNodes(parsed);
}

function loadNodesFromFile() {
  const nodesFile =
    process.env.LAVALINK_NODES_FILE?.trim() ||
    path.join(projectRoot, 'lavalink', 'nodes.json');

  if (!existsSync(nodesFile)) {
    return null;
  }

  const parsed = parseJson(readFileSync(nodesFile, 'utf8'));

  if (!parsed) {
    return null;
  }

  return normalizeNodes(parsed);
}

function buildNodeFromSingleEnv() {
  const host = String(process.env.LAVALINK_HOST || DEFAULT_HOST).trim();
  const port = parsePort(process.env.LAVALINK_PORT);

  return {
    host,
    port,
    password: String(process.env.LAVALINK_PASSWORD || DEFAULT_PASSWORD),
    secure: parseBoolean(process.env.LAVALINK_SECURE, port === 443),
    name: String(process.env.LAVALINK_NAME || DEFAULT_NODE_NAME).trim(),
  };
}

export function getLavalinkNodes() {
  const fromEnv = parseNodesFromEnv();

  if (fromEnv?.length) {
    return fromEnv;
  }

  if (process.env.LAVALINK_HOST?.trim()) {
    return [buildNodeFromSingleEnv()];
  }

  const fromFile = loadNodesFromFile();

  if (fromFile?.length) {
    return fromFile;
  }

  return [buildNodeFromSingleEnv()];
}

export const lavalinkConfig = {
  nodes: getLavalinkNodes(),

  defaultSearchPlatform:
    process.env.LAVALINK_SEARCH_PLATFORM ||
    process.env.DEFAULT_SEARCH_PLATFORM ||
    'ytmsearch',

  restVersion:
    process.env.LAVALINK_REST_VERSION ||
    'v4',
};

export default lavalinkConfig;
