// -----------------------------------------------------------------------------
// One IRC session of the bot, over irc-framework (TCP, TLS by default).
//
// What irc-framework does not do for us, and this file does:
// - Its reconnection is turned off: the integration retries with its own
//   backoff (src/app.js), each time with a fresh session, and a refused
//   password is never retried every few seconds.
// - It goes on registering when SASL fails: here a refused password ends the
//   session (`sasl_disconnect_on_fail`) with a clear error.
// - It sends every line at once: here a queue sends a burst of a few lines,
//   then one line every 2 s, so a long answer of Gladys never gets the bot
//   kicked for flooding.
// - A nickname already taken during registration is retried with "_" added.
// - NickServ identification (networks without SASL), WHOIS and PING with a
//   timeout, as promises.
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import IRC from 'irc-framework';
import { createLogger } from '@gladysassistant/integration-sdk';
import { ircLower } from '../config.js';
import { ERROR_KINDS, IrcError, classifyError } from './errors.js';
import { MAX_LINE_BYTES, splitMessage } from './split.js';

const logger = createLogger({ name: 'irc' });

export const CONNECT_TIMEOUT_MS = 30_000;
export const PING_TIMEOUT_MS = 15_000;
export const WHOIS_TIMEOUT_MS = 3000;
export const NICKSERV_TIMEOUT_MS = 10_000;
export const STOP_TIMEOUT_MS = 2000;
// Flood control: a burst of BURST_LINES, then one line every LINE_INTERVAL_MS.
export const BURST_LINES = 4;
export const LINE_INTERVAL_MS = 2000;
// Lines waiting at most: beyond, a message is refused rather than sent minutes late.
export const MAX_QUEUED_LINES = 40;
const MAX_NICK_ATTEMPTS = 3;

// The join errors of irc-framework ('irc error' events) and what they mean.
const JOIN_ERRORS = new Set([
  'channel_is_full',
  'invite_only_channel',
  'banned_from_channel',
  'bad_channel_key',
  'too_many_channels',
  'no_such_channel',
]);

/**
 * @typedef {object} SessionOptions
 * @property {string} host
 * @property {number} port
 * @property {boolean} tls
 * @property {boolean} [allowSelfSigned]
 * @property {string} nick
 * @property {'sasl'|'nickserv'|'server_password'|'none'} auth
 * @property {string} [account] SASL / NickServ account, the nickname when empty
 * @property {string} [password]
 */

/**
 * A connected IRC session. Emits:
 * - `message` { private, nick, ident, hostname, account, target, text, time, playback }
 * - `joined` (channel), `join_failed` (channel, reason), `left` (channel, reason)
 * - `closed` (IrcError|null)
 */
export class IrcSession extends EventEmitter {
  /** @param {SessionOptions} options */
  constructor(options, { createClient = () => new IRC.Client() } = {}) {
    super();
    this.options = options;
    this.createClient = createClient;
    this.client = null;
    this.closed = false;
    this.closeError = null;
    this.identified = false;
    this.queue = [];
    this.tokens = BURST_LINES;
    this.refill = null;
  }

  /** The nickname the server knows the bot by. */
  get nick() {
    return this.client?.user?.nick ?? this.options.nick;
  }

  /** Connects and registers; resolves with the nickname, rejects with an IrcError. */
  start(signal) {
    const { host, port, tls, allowSelfSigned, nick, auth, account, password } = this.options;
    const client = this.createClient();
    this.client = client;
    const login = account || nick;
    return new Promise((resolve, reject) => {
      let registered = false;
      let failure = null;
      let attempts = 0;
      const fail = (error) => {
        failure ??= error;
        client.quit();
        destroy(client);
      };
      const timeout = setTimeout(
        () => fail(new IrcError(ERROR_KINDS.TIMEOUT, 'No registration in time')),
        CONNECT_TIMEOUT_MS,
      );
      const onAbort = () => fail(new IrcError(ERROR_KINDS.UNREACHABLE, 'Aborted'));
      signal?.addEventListener('abort', onAbort, { once: true });
      const done = () => {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', onAbort);
      };

      client.on('sasl failed', (event) => {
        fail(
          event.reason === 'capability_missing' || event.reason === 'unsupported_mechanism'
            ? new IrcError(ERROR_KINDS.NO_SASL, `SASL not offered (${event.reason})`)
            : new IrcError(ERROR_KINDS.BAD_LOGIN, `SASL refused (${event.reason})`),
        );
      });
      client.on('nick in use', () => {
        if (registered) {
          return; // a nickname change refused later on: nothing to do
        }
        attempts += 1;
        if (attempts >= MAX_NICK_ATTEMPTS) {
          fail(new IrcError(ERROR_KINDS.NICKNAME_IN_USE, 'Nickname in use'));
          return;
        }
        client.changeNick(`${nick}${'_'.repeat(attempts)}`);
      });
      client.on('nick invalid', () => {
        fail(new IrcError(ERROR_KINDS.INVALID_NICKNAME, 'Nickname refused by the server'));
      });
      client.on('irc error', (event) => {
        if (event.error === 'password_mismatch') {
          fail(new IrcError(ERROR_KINDS.BAD_LOGIN, 'Server password refused'));
        } else if (event.error === 'banned_from_network') {
          fail(new IrcError(ERROR_KINDS.BANNED, 'Banned from the network'));
        } else if (event.error === 'irc') {
          // ERROR :Closing link... — K-lines say "banned"; the close follows.
          const reason = String(event.reason ?? '');
          failure ??= /k-?line|ban/i.test(reason)
            ? new IrcError(ERROR_KINDS.BANNED, reason)
            : new IrcError(ERROR_KINDS.SERVER, reason || 'Closed by the server');
        } else if (JOIN_ERRORS.has(event.error) && event.channel) {
          this.emit('join_failed', ircLower(event.channel), event.error);
        }
      });
      client.on('registered', async (event) => {
        registered = true;
        if (event?.nick) {
          client.user.nick = event.nick; // "Gladys_" when "Gladys" was taken
        }
        if (auth === 'nickserv') {
          this.identified = await this.identify(login, password);
        } else {
          this.identified = auth === 'sasl';
        }
        done();
        if (this.closed) {
          reject(failure ?? new IrcError(ERROR_KINDS.UNREACHABLE, 'Closed during registration'));
          return;
        }
        resolve(this.nick);
      });
      client.on('socket close', (err) => {
        const error =
          failure ??
          (err ? classifyError(err) : null) ??
          new IrcError(ERROR_KINDS.UNREACHABLE, 'Connection closed by the server');
        this.close(error);
        if (!registered) {
          done();
          reject(error);
        }
      });
      this.bindEvents(client);
      client.connect({
        host,
        port,
        tls,
        rejectUnauthorized: !allowSelfSigned,
        nick,
        username:
          nick
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '')
            .slice(0, 10) || 'gladys',
        gecos: 'Gladys Assistant',
        account: auth === 'sasl' ? { account: login, password } : undefined,
        // ZNC reads "user/network:password" from PASS.
        password:
          auth === 'server_password' ? (account ? `${account}:${password}` : password) : undefined,
        sasl_disconnect_on_fail: true,
        auto_reconnect: false,
        ping_interval: 60,
        ping_timeout: 120,
        message_max_length: MAX_LINE_BYTES,
        version: null,
      });
    });
  }

  /**
   * NickServ IDENTIFY after registration; true once the server confirms it.
   * Networks confirm differently: RPL_LOGGEDIN (900, Atheme), an ACCOUNT line
   * (account-notify, Ergo), or only a NOTICE of NickServ (Anope, OFTC).
   */
  identify(account, password) {
    const client = this.client;
    return new Promise((resolve) => {
      const timer = setTimeout(() => finish(false), NICKSERV_TIMEOUT_MS);
      const onLogin = () => finish(true);
      const onAccount = (event) => {
        if (event.account && ircLower(event.nick ?? '') === ircLower(this.nick)) {
          finish(true);
        }
      };
      const onNotice = (event) => {
        if (ircLower(event.nick ?? '') !== 'nickserv') {
          return;
        }
        const text = String(event.message ?? '');
        if (/invalid|incorrect|denied|failed|not registered|wrong/i.test(text)) {
          finish(false);
        } else if (/identified|logged in|recognized/i.test(text)) {
          finish(true);
        }
      };
      const onClose = () => finish(false);
      const finish = (ok) => {
        clearTimeout(timer);
        client.removeListener('socket close', onClose);
        client.removeListener('loggedin', onLogin);
        client.removeListener('account', onAccount);
        client.removeListener('notice', onNotice);
        resolve(ok);
      };
      client.on('socket close', onClose);
      client.on('loggedin', onLogin);
      client.on('account', onAccount);
      client.on('notice', onNotice);
      client.raw('PRIVMSG', 'NickServ', `IDENTIFY ${account} ${password}`);
    });
  }

  bindEvents(client) {
    const self = () => ircLower(this.nick);
    client.on('privmsg', (event) => this.onMessage(event));
    client.on('quit', (event) => this.emit('nick_gone', event.nick ?? ''));
    client.on('nick', (event) => this.emit('nick_gone', event.nick ?? ''));
    client.on('action', (event) => this.onMessage(event)); // "/me ..."
    client.on('join', (event) => {
      if (ircLower(event.nick ?? '') === self()) {
        this.emit('joined', ircLower(event.channel));
      }
    });
    client.on('part', (event) => {
      if (ircLower(event.nick ?? '') === self()) {
        this.emit('left', ircLower(event.channel), 'part');
      }
    });
    client.on('kick', (event) => {
      if (ircLower(event.kicked ?? '') === self()) {
        this.emit('left', ircLower(event.channel), 'kick');
      }
    });
  }

  onMessage(event) {
    if (event.from_server || !event.nick || typeof event.message !== 'string') {
      return;
    }
    const target = event.target ?? '';
    this.emit('message', {
      private: ircLower(target) === ircLower(this.nick),
      nick: event.nick,
      ident: event.ident ?? '',
      hostname: event.hostname ?? '',
      account: event.account && event.account !== '*' ? event.account : null,
      target: ircLower(target),
      text: event.message,
      time: typeof event.time === 'number' ? event.time : null,
      // Replayed history (a bouncer, CHATHISTORY): never acted upon.
      playback: Boolean(event.batch),
    });
  }

  join(channel) {
    this.client.raw('JOIN', channel);
  }

  part(channel) {
    this.client.raw('PART', channel);
  }

  /**
   * Queues a text for a nickname or a channel: cut into lines, sent under the
   * flood control. Resolves once queued; rejects when the session is closed or
   * the queue is full.
   */
  async say(target, text) {
    if (this.closed) {
      throw new IrcError(ERROR_KINDS.UNREACHABLE, 'Not connected');
    }
    // Room for ":nick!user@host PRIVMSG target :" and CRLF in the 512 bytes (bytes, not characters).
    const budget = Math.min(
      MAX_LINE_BYTES,
      512 - 2 - 120 - Buffer.byteLength(`PRIVMSG ${target} :`),
    );
    const lines = splitMessage(text, { maxBytes: budget });
    if (this.queue.length + lines.length > MAX_QUEUED_LINES) {
      throw new IrcError(ERROR_KINDS.FLOOD, 'Too many messages waiting');
    }
    for (const line of lines) {
      this.queue.push([target, line]);
    }
    this.drain();
    return lines.length;
  }

  drain() {
    while (this.queue.length > 0 && this.tokens > 0 && !this.closed) {
      const [target, line] = this.queue.shift();
      this.tokens -= 1;
      // Always the trailing form, so a line starting with ":" stays intact.
      this.client.connection.write(`PRIVMSG ${target} :${line}`);
    }
    if (!this.refill && this.tokens < BURST_LINES && !this.closed) {
      this.refill = setInterval(() => {
        this.tokens = Math.min(BURST_LINES, this.tokens + 1);
        this.drain();
        if (this.tokens >= BURST_LINES && this.queue.length === 0) {
          clearInterval(this.refill);
          this.refill = null;
        }
      }, LINE_INTERVAL_MS);
      this.refill.unref?.();
    }
  }

  /** PING the server; resolves once it answers, rejects after PING_TIMEOUT_MS. */
  ping() {
    if (this.closed) {
      return Promise.reject(new IrcError(ERROR_KINDS.UNREACHABLE, 'Not connected'));
    }
    const token = `gladys-${Math.random().toString(36).slice(2, 10)}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.client.removeListener('pong', onPong);
        reject(new IrcError(ERROR_KINDS.TIMEOUT, 'No PONG'));
      }, PING_TIMEOUT_MS);
      const onPong = (event) => {
        if (event.message === token) {
          clearTimeout(timer);
          this.client.removeListener('pong', onPong);
          resolve();
        }
      };
      this.client.on('pong', onPong);
      this.client.raw('PING', token);
    });
  }

  /** WHOIS a nickname: { nick, ident, hostname, account } or null if nobody has it. */
  whois(nick) {
    if (this.closed) {
      return Promise.reject(new IrcError(ERROR_KINDS.UNREACHABLE, 'Not connected'));
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.client.removeListener('whois', onWhois);
        reject(new IrcError(ERROR_KINDS.TIMEOUT, 'No WHOIS answer'));
      }, WHOIS_TIMEOUT_MS);
      const onWhois = (event) => {
        if (ircLower(event.nick ?? '') !== ircLower(nick)) {
          return;
        }
        clearTimeout(timer);
        this.client.removeListener('whois', onWhois);
        resolve(
          event.error
            ? null
            : {
                nick: event.nick,
                ident: event.ident ?? '',
                hostname: event.hostname ?? '',
                account: event.account || null,
              },
        );
      };
      this.client.on('whois', onWhois);
      this.client.raw('WHOIS', nick);
    });
  }

  close(error) {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.closeError = error;
    clearInterval(this.refill);
    this.refill = null;
    if (this.queue.length > 0) {
      logger.debug(`${this.queue.length} queued IRC lines dropped with the session`);
    }
    this.queue = [];
    this.emit('closed', error);
  }

  /** QUIT, then the socket closed at most STOP_TIMEOUT_MS later. */
  async stop() {
    if (!this.client) {
      return;
    }
    const client = this.client;
    if (!this.closed) {
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, STOP_TIMEOUT_MS);
        client.once('socket close', () => {
          clearTimeout(timer);
          resolve();
        });
        client.quit('Gladys stopping');
      });
    }
    destroy(client);
    this.close(null);
  }
}

/** Drops a client at once: no reconnection, socket destroyed. */
function destroy(client) {
  try {
    client.connection.requested_disconnect = true;
    client.connection.transport?.socket?.destroy?.();
  } catch {
    // Already gone.
  }
}
