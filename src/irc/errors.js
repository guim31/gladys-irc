// -----------------------------------------------------------------------------
// Errors of the IRC side, sorted into a few kinds the user can act on
// (src/texts.js explains each one in four languages).
// -----------------------------------------------------------------------------

export const ERROR_KINDS = {
  NOT_CONFIGURED: 'not_configured',
  INVALID_SERVER: 'invalid_server',
  INVALID_NICKNAME: 'invalid_nickname',
  NO_PASSWORD: 'no_password',
  INSECURE: 'insecure',
  UNREACHABLE: 'unreachable',
  TIMEOUT: 'timeout',
  CERTIFICATE: 'certificate',
  BAD_LOGIN: 'bad_login',
  NO_SASL: 'no_sasl',
  NICKNAME_IN_USE: 'nickname_in_use',
  BANNED: 'banned',
  FLOOD: 'flood',
  INVALID_TARGET: 'invalid_target',
  NOT_IN_CHANNEL: 'not_in_channel',
  NOT_ONLINE: 'not_online',
  SERVER: 'server',
};

// Worth retrying soon: the network, the server restarting, a nickname held a moment.
export const TRANSIENT_KINDS = new Set([
  ERROR_KINDS.UNREACHABLE,
  ERROR_KINDS.TIMEOUT,
  ERROR_KINDS.NICKNAME_IN_USE,
  ERROR_KINDS.SERVER,
]);

export class IrcError extends Error {
  constructor(kind, message, options) {
    super(message, options);
    this.name = 'IrcError';
    this.kind = kind;
  }
}

const NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ETIMEDOUT',
  'EPIPE',
]);

// Node TLS verification failures (tls.connect).
const CERTIFICATE_CODES = /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ALTNAME/;

/** Sorts any error of the socket below irc-framework into an IrcError. */
export function classifyError(err) {
  if (err instanceof IrcError) {
    return err;
  }
  const code = err?.code ?? err?.cause?.code;
  const message = err?.message ?? String(err);
  let kind = ERROR_KINDS.SERVER;
  if (typeof code === 'string' && CERTIFICATE_CODES.test(code)) {
    kind = ERROR_KINDS.CERTIFICATE;
  } else if (NETWORK_CODES.has(code)) {
    kind = ERROR_KINDS.UNREACHABLE;
  } else if (/wrong version number|packet length too long|unknown protocol/i.test(message)) {
    // TLS spoken to a plain-text port (or the reverse).
    kind = ERROR_KINDS.INSECURE;
  }
  return new IrcError(kind, message, { cause: err });
}
