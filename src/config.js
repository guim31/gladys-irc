// -----------------------------------------------------------------------------
// Integration configuration (the `config_schema` of the manifest), normalized
// so the rest of the code never deals with `undefined`, stray spaces or a
// half-typed address.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

export const AUTH_METHODS = ['sasl', 'nickserv', 'server_password', 'none'];

// Defaults: they MUST stay consistent with the `default` values declared in the
// `config_schema` of the manifest (test/manifest.test.js).
export const DEFAULT_CONFIG = {
  server: '',
  tls: true,
  allow_self_signed: false,
  nickname: 'Gladys',
  auth: 'sasl',
  account: '',
  password: '',
  channels: '',
  allowed_users: '',
  command_prefix: '!',
  language: 'fr',
};

export const PORTS = { tls: 6697, plain: 6667 };

const trimmed = (value) => (typeof value === 'string' ? value.trim() : '');

// RFC 2812 nicknames, as networks accept them today: a letter or one of
// []\`_^{|} first, then letters, digits, those and "-". 30 characters at most.
const NICKNAME = /^[A-Za-z[\]\\`_^{|}][A-Za-z0-9[\]\\`_^{|}-]{0,29}$/;
// A channel: a prefix, then anything but space, comma, BEL and the line ends.
// eslint-disable-next-line no-control-regex -- BEL and NUL are exactly what a channel name cannot hold
const CHANNEL = /^[#&+!][^\s,\x07\x00:]{1,49}$/;
// A hostmask pattern: nick!user@host, `*` and `?` allowed.
const HOSTMASK = /^[^\s!@]+![^\s!@]+@[^\s!@]+$/;
// An account name (NickServ, SASL): what the services accept.
const ACCOUNT = /^[^\s!@,*?#&:]{1,64}$/;

/** IRC lower case (rfc1459 casemapping): []\~ are the capitals of {}|^. */
export const ircLower = (text) =>
  text.toLowerCase().replace(/[[\]\\~]/g, (c) => ({ '[': '{', ']': '}', '\\': '|', '~': '^' })[c]);

/** A nickname, or null when the text is not one. */
export function parseNickname(value) {
  const text = trimmed(value);
  return NICKNAME.test(text) ? text : null;
}

/** A channel name in IRC lower case, or null when the text is not one. */
export function parseChannel(value) {
  const text = trimmed(value);
  return CHANNEL.test(text) ? ircLower(text) : null;
}

export const isChannel = (target) => /^[#&+!]/.test(target);

/** Splits a list typed in a text field: commas, semicolons, spaces or new lines. */
export function parseList(value) {
  const items = trimmed(value)
    .split(/[\s,;]+/)
    .map((item) => item.trim())
    .filter((item) => item !== '');
  return [...new Set(items)];
}

/**
 * One allowed person: a services account (`alice`, matched on the `account`
 * tag the server adds to each message), or a hostmask (`alice!*@home.example.org`).
 * A bare nickname is never trusted: anybody can take a free nickname.
 * @returns {{ id: string, kind: 'account'|'mask', pattern?: RegExp } | null}
 */
export function parseAllowed(value) {
  // ASCII lower case only: servers disagree on [ ] \ ~ (Ergo tells "ab[c" from
  // "ab{c" while announcing rfc1459), and a mismatch must refuse, never accept.
  const text = trimmed(value).toLowerCase();
  if (HOSTMASK.test(text)) {
    const source = text
      .split('')
      .map((c) => (c === '*' ? '.*' : c === '?' ? '.' : c.replace(/[.+^$()|{}[\]\\]/g, '\\$&')))
      .join('');
    return { id: text, kind: 'mask', pattern: new RegExp(`^${source}$`) };
  }
  if (ACCOUNT.test(text)) {
    return { id: text, kind: 'account' };
  }
  return null;
}

/**
 * The server to connect to: `host` or `host:port`, an `ircs://` or `irc://`
 * address. The port defaults to 6697 with TLS, 6667 without.
 * @returns {{ host: string, port: number|null } | null | undefined} null when
 * empty, undefined when the text is not understood
 */
export function parseServer(value) {
  const text = trimmed(value).replace(/\/+$/, '');
  if (text === '') {
    return null;
  }
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(text)?.[1]?.toLowerCase();
  if (scheme && !['irc', 'ircs'].includes(scheme)) {
    return undefined;
  }
  try {
    const url = new URL(scheme ? `http${text.slice(scheme.length)}` : `http://${text}`);
    if (!url.hostname || url.username || url.password || (url.pathname && url.pathname !== '/')) {
      return undefined;
    }
    if (url.search || url.hash) {
      return undefined;
    }
    // An explicit port; for ircs:// without one, 6697.
    const port = url.port ? Number(url.port) : scheme === 'ircs' ? PORTS.tls : null;
    return { host: url.hostname.replace(/^\[|\]$/g, ''), port, scheme: scheme ?? null };
  } catch {
    return undefined;
  }
}

const bool = (value, fallback) =>
  value === true || value === 'true'
    ? true
    : value === false || value === 'false'
      ? false
      : fallback;

/**
 * Merge the user config with the defaults.
 * @param {Record<string, unknown>} [raw] config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const config = raw ?? {};
  const prefix = trimmed(config.command_prefix);
  const allowed = parseList(config.allowed_users).map(parseAllowed).filter(Boolean);
  return {
    server: trimmed(config.server),
    tls: bool(config.tls, DEFAULT_CONFIG.tls),
    allow_self_signed: bool(config.allow_self_signed, false),
    nickname: trimmed(config.nickname) || DEFAULT_CONFIG.nickname,
    auth: AUTH_METHODS.includes(config.auth) ? config.auth : DEFAULT_CONFIG.auth,
    account: trimmed(config.account),
    password: typeof config.password === 'string' ? config.password : '',
    channels: [...new Set(parseList(config.channels).map(parseChannel).filter(Boolean))],
    allowed_users: [...new Map(allowed.map((entry) => [entry.id, entry])).values()],
    // One to three characters, no space: "!" by default.
    command_prefix:
      prefix === '' || prefix.length > 3 || /\s/.test(prefix)
        ? DEFAULT_CONFIG.command_prefix
        : prefix,
    language: LANGUAGES.includes(config.language) ? config.language : DEFAULT_CONFIG.language,
  };
}
