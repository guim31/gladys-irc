// -----------------------------------------------------------------------------
// The integration: an IRC bot wired to Gladys.
//
// - One session at a time (src/irc/connection.js), started again with a
//   backoff when it ends. Only the people of the "allowed" list are ever
//   answered or obeyed; everybody else is ignored. An allowed person is a
//   services account (checked on the `account` tag the server adds to each
//   message) or a hostmask: never a bare nickname, which anybody can take.
// - Private messages of an allowed person are a conversation with Gladys
//   (manifest `type: "communication"`): a link code links the person to a
//   Gladys user, then the messages go to the brain (publishMessage) and the
//   answers come back through onSendMessage, to the nickname last seen for
//   that person, checked by WHOIS before anything private is sent.
// - Channels (configuration) only fire scenes: every message of an allowed
//   person fires `message_received`, a message starting with the command
//   prefix also fires `command_received`. Gladys never answers in a channel,
//   where others can read.
// - Scene action `send_message`: a message to a nickname or a joined channel.
// - Triggers `connection_lost` / `connection_restored`, the connection status
//   of the Configuration screen, the widget and the `test_connection` action.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import {
  PORTS,
  ircLower,
  isChannel,
  normalizeConfig,
  parseChannel,
  parseNickname,
  parseServer,
} from './config.js';
import { IrcSession } from './irc/connection.js';
import { ERROR_KINDS, IrcError, TRANSIENT_KINDS } from './irc/errors.js';
import { createFailureLog } from './log.js';
import { Store } from './store.js';
import {
  ActionFailure,
  BOT_TEXT,
  REPORT_TEXT,
  STATUS_TEXT,
  each,
  errorText,
  errorTexts,
  pick,
} from './texts.js';
import { CONNECTION, TEST_ACTION, WIDGET_KEY, buildWidgetContent } from './widgets.js';

const logger = createLogger({ name: 'irc' });

export const ACTION_KEY = 'test_connection';
export const SCENE_ACTION_KEY = 'send_message';
export const TRIGGERS = {
  MESSAGE: 'message_received',
  COMMAND: 'command_received',
  LOST: 'connection_lost',
  RESTORED: 'connection_restored',
};

// Messages older than this when the bot reads them (history replayed by a
// bouncer) are skipped: a "!open garage" from two hours ago must not run now.
export const MAX_MESSAGE_AGE_MS = 5 * 60 * 1000;
// The connection is declared lost after failures lasting this long, never on one blip.
export const LOST_AFTER_MS = 60 * 1000;
export const RETRY_DELAYS_MS = [2000, 5000, 10_000, 30_000, 60_000];
// Refused password, ban: retry slowly, in case the server is the cause.
export const CREDENTIALS_RETRY_MS = 5 * 60 * 1000;
// A PING of the server this often, and the channels left behind joined again.
export const PING_INTERVAL_MS = 2 * 60 * 1000;
export const JOIN_TIMEOUT_MS = 10_000;
export const RECENT_KEPT = 5;
// Gladys waits 5 s for the ack of a message: answer before, even if the server is slow.
export const MESSAGE_TIMEOUT_MS = 4500;
// How long a message of Gladys waits for the first connection, within that deadline.
export const CONNECT_WAIT_MS = 1500;
// A WHOIS proving a nickname is still the allowed person is trusted this long.
export const IDENTITY_TTL_MS = 60 * 1000;
// Join errors worth a new attempt at the next ping.
const TRANSIENT_JOIN_ERRORS = new Set(['timeout', 'channel_is_full', 'too_many_channels', 'part']);
// Gladys link codes: 8 characters of an alphabet without 0/O/1/I/L.
const LINK_CODE = /^[A-HJ-KM-NP-Z2-9]{8}$/i;
const MAX_TEXT_LENGTH = 4096; // the limit of publishMessage

/** Parses a command: "!lights off" → { command: "lights", args: "off" }. */
export function parseCommand(text, prefix) {
  if (!text.startsWith(prefix)) {
    return null;
  }
  const rest = text.slice(prefix.length);
  const match = rest.match(/^(\S+)(?:\s+([\s\S]*))?$/);
  if (!match) {
    return null;
  }
  return { command: match[1].toLowerCase(), args: (match[2] ?? '').trim() };
}

/** The allowed person a message (or a WHOIS answer) comes from, or null. */
export function findAllowed(allowed, { nick, ident, hostname, account }) {
  // ASCII lower case, as the list (see parseAllowed).
  const mask = `${nick}!${ident}@${hostname}`.toLowerCase();
  const login = account ? account.toLowerCase() : null;
  return (
    allowed.find((entry) =>
      entry.kind === 'account' ? login === entry.id : entry.pattern.test(mask),
    ) ?? null
  );
}

const defaultSleep = (ms, signal) =>
  new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });

/**
 * @param {import('@gladysassistant/integration-sdk').GladysIntegration} gladys
 * @param {object} [options] replaced by the tests
 * @param {(options: object) => IrcSession} [options.createSession]
 * @param {{ load(): Promise<object>, save(data: object): Promise<void>, flush(): Promise<void> }} [options.store]
 * @param {() => number} [options.now] milliseconds
 * @param {(ms: number, signal: AbortSignal) => Promise<void>} [options.sleep] waits between attempts
 * @param {(ms: number, signal: AbortSignal) => Promise<void>} [options.timer] waits between pings, joins
 */
export function registerHandlers(gladys, options = {}) {
  const {
    createSession = (sessionOptions) => new IrcSession(sessionOptions),
    store = new Store(),
    now = () => Date.now(),
    sleep = defaultSleep,
    timer = defaultSleep,
  } = options;

  let data = {}; // persisted: { recent, nicks }
  const loaded = store.load().then((stored) => {
    data = stored ?? {};
  });

  let config = normalizeConfig({});
  let sessionOptions = null; // null: not configured (see configError)
  let session = null; // the connected session, or null
  let configError = new IrcError(ERROR_KINDS.NOT_CONFIGURED, 'Not configured yet');
  let connection = CONNECTION.NOT_CONFIGURED;
  let lastError = null;
  // Channel → { joined, failed, rejoin, waiter }
  let channels = new Map();
  let verified = new Map(); // lower-case nick → { id, at }: WHOIS checks of allowed people
  let controller = null; // aborts the running loop
  let running = null; // the running loop
  let stopped = false;
  let lastStatus = null;
  let lostFired = false; // connection_lost was fired: connection_restored may follow
  let appliedKey = null; // the normalized configuration the loop runs with
  let applying = Promise.resolve(); // configurations are applied one at a time
  let readyWaiters = []; // onSendMessage calls waiting for the first connection
  const statusLog = createFailureLog(logger, { recovered: 'Connection status published again' });
  const connectLog = createFailureLog(logger, { recovered: 'IRC connection works again' });
  const brainLog = createFailureLog(logger, { recovered: 'Messages reach Gladys again' });

  // --- Gladys side effects, never fatal --------------------------------------

  async function publishStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === lastStatus || !gladys.connected) {
      return;
    }
    try {
      await gladys.setConnectionStatus(connected, message);
      lastStatus = key;
      statusLog.ok();
    } catch (err) {
      statusLog.fail(`Cannot publish the connection status: ${err.message}`);
    }
  }

  async function fire(key, payload) {
    try {
      await gladys.publishSceneEvent(key, payload);
    } catch (err) {
      logger.warn(`Cannot fire the "${key}" trigger: ${err.message}`);
    }
  }

  function refreshWidget() {
    try {
      gladys.requestWidgetRefresh(WIDGET_KEY);
    } catch (err) {
      logger.debug(`Widget refresh not requested: ${err.message}`);
    }
  }

  function setConnection(next) {
    if (connection !== next) {
      connection = next;
      refreshWidget();
    }
  }

  const joinedCount = () => [...channels.values()].filter((channel) => channel.joined).length;
  const failedChannels = () =>
    [...channels.entries()].filter(([, channel]) => channel.failed).map(([name]) => name);

  function connectedStatus() {
    if (!session) {
      return undefined;
    }
    const failed = failedChannels();
    const notes = (text) =>
      [
        failed.length > 0 ? text.channels(failed.join(', ')) : null,
        config.auth === 'nickserv' && !session.identified ? text.notIdentified : null,
      ].filter(Boolean);
    return notes(STATUS_TEXT.en).length > 0
      ? each(STATUS_TEXT, (text) => notes(text).join(' '))
      : undefined;
  }

  // --- Channels --------------------------------------------------------------------

  const newChannel = () => ({ joined: false, failed: '', rejoin: false, waiter: null });

  /** Joins a channel; resolves once the server answered, or after JOIN_TIMEOUT_MS. */
  async function joinChannel(current, name, signal) {
    const channel = channels.get(name);
    channel.joined = false;
    channel.failed = '';
    const answered = new Promise((resolve) => {
      channel.waiter = resolve;
    });
    // The timeout ends with the answer (or the session): no timer left behind.
    const done = new AbortController();
    const onAbort = () => done.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    current.once('closed', onAbort);
    try {
      current.join(name);
      await Promise.race([answered, timer(JOIN_TIMEOUT_MS, done.signal)]);
    } finally {
      done.abort();
      signal?.removeEventListener('abort', onAbort);
      current.off('closed', onAbort);
    }
    if (channel.waiter) {
      channel.waiter = null;
      if (signal?.aborted || current.closed) {
        return;
      }
      channel.failed = 'timeout';
      channel.rejoin = true; // tried again at the next ping
      logger.warn(`The channel ${name} did not answer the join`);
    }
  }

  async function joinChannels(current, signal) {
    await Promise.all(config.channels.map((name) => joinChannel(current, name, signal)));
  }

  function settleJoin(channel) {
    channel.waiter?.();
    channel.waiter = null;
  }

  function onJoined(name) {
    const channel = channels.get(name);
    if (!channel) {
      session?.part(name); // forced in by the server or an old configuration: leave
      return;
    }
    if (!channel.joined) {
      channel.joined = true;
      channel.failed = '';
      channel.rejoin = false;
      logger.info(`Joined the channel ${name}`);
      settleJoin(channel);
      refreshWidget();
      if (connection === CONNECTION.CONNECTED) {
        publishStatus(true, connectedStatus());
      }
    }
  }

  function onJoinFailed(name, reason) {
    const channel = channels.get(name);
    if (!channel || channel.joined) {
      return;
    }
    channel.failed = reason;
    channel.rejoin = TRANSIENT_JOIN_ERRORS.has(reason);
    logger.warn(`Cannot join the channel ${name}: ${reason}`);
    settleJoin(channel);
    refreshWidget();
  }

  function onLeft(name, reason) {
    const channel = channels.get(name);
    if (!channel?.joined) {
      return;
    }
    channel.joined = false;
    channel.failed = reason;
    // Kicked: stay out, the operators said so. Parted (server side): the next ping rejoins.
    channel.rejoin = TRANSIENT_JOIN_ERRORS.has(reason);
    logger.warn(`The bot is no longer in the channel ${name} (${reason})`);
    refreshWidget();
    if (connection === CONNECTION.CONNECTED) {
      publishStatus(true, connectedStatus());
    }
  }

  // --- Connection ----------------------------------------------------------------

  async function markConnected() {
    lastError = null;
    setConnection(CONNECTION.CONNECTED);
    readyWaiters.splice(0).forEach((wake) => wake());
    await publishStatus(true, connectedStatus());
    if (lostFired) {
      lostFired = false;
      logger.info('IRC connection restored');
      await fire(TRIGGERS.RESTORED, { nickname: session?.nick ?? '' });
    }
  }

  /** Resolves once the bot is connected, or after `ms` at most. */
  function whenConnected(ms) {
    if (session && connection === CONNECTION.CONNECTED) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const wake = () => {
        clearTimeout(wait);
        resolve();
      };
      const wait = setTimeout(() => {
        readyWaiters = readyWaiters.filter((entry) => entry !== wake);
        resolve();
      }, ms);
      readyWaiters.push(wake);
    });
  }

  /**
   * Resolves with the error that ended the session (null for an abort), pinging
   * the server meanwhile. The session may have ended before this is called.
   */
  function untilClosed(current, signal) {
    const ended = (error) =>
      error ?? new IrcError(ERROR_KINDS.UNREACHABLE, 'Connection closed by the server');
    if (signal.aborted) {
      return Promise.resolve(null);
    }
    if (current.closed) {
      return Promise.resolve(ended(current.closeError));
    }
    // Ends the pings and the listeners with the session.
    const watch = new AbortController();
    const onAbort = () => watch.abort();
    signal.addEventListener('abort', onAbort, { once: true });
    return new Promise((resolve) => {
      const finish = (value) => {
        resolve(value);
        current.off('closed', onClosed);
        signal.removeEventListener('abort', onAbort);
        watch.abort();
      };
      const onClosed = (error) => finish(ended(error));
      current.once('closed', onClosed);
      watch.signal.addEventListener('abort', () => finish(null), { once: true });
      (async () => {
        while (!watch.signal.aborted) {
          await timer(PING_INTERVAL_MS, watch.signal);
          if (watch.signal.aborted) {
            return;
          }
          try {
            await current.ping();
            logger.debug('IRC ping answered');
          } catch (err) {
            if (!current.closed) {
              current.stop().catch(() => {});
            }
            finish(err);
            return;
          }
          for (const [name, channel] of channels) {
            if (channel.rejoin && !channel.joined) {
              channel.rejoin = false;
              joinChannel(current, name, watch.signal).catch(() => {});
            }
          }
        }
      })();
    });
  }

  // --- The connection loop ---------------------------------------------------------

  function bindSession(current) {
    const live = () => !current.closed;
    current.on('message', (message) => {
      if (live()) {
        handleMessage(current, message).catch((err) =>
          logger.warn(`Message not handled: ${err.message}`),
        );
      }
    });
    current.on('joined', (name) => live() && onJoined(name));
    current.on('join_failed', (name, reason) => live() && onJoinFailed(name, reason));
    current.on('left', (name, reason) => live() && onLeft(name, reason));
    // A nickname that quit or changed may soon belong to someone else.
    current.on('nick_gone', (nick) => verified.delete(ircLower(nick)));
  }

  async function loop(signal) {
    let failingSince = null;
    let attempt = 0;
    while (!signal.aborted) {
      const current = createSession(sessionOptions);
      try {
        bindSession(current);
        const nick = await current.start(signal);
        if (signal.aborted) {
          await current.stop();
          return;
        }
        session = current;
        verified = new Map();
        await joinChannels(current, signal);
        if (signal.aborted) {
          await current.stop();
          return;
        }
        if (current.closed) {
          // Closed right after the registration (a K-line after 001...): never "connected".
          throw current.closeError ?? new IrcError(ERROR_KINDS.UNREACHABLE, 'Closed');
        }
        failingSince = null;
        attempt = 0;
        connectLog.ok();
        logger.info(`Connected to IRC as ${nick}`);
        await markConnected();
        const ended = await untilClosed(current, signal);
        session = null;
        if (ended === null) {
          await current.stop();
          return;
        }
        throw ended;
      } catch (err) {
        session = null;
        for (const channel of channels.values()) {
          channel.joined = false;
        }
        if (signal.aborted) {
          await current.stop();
          return;
        }
        const error =
          err instanceof IrcError ? err : new IrcError(ERROR_KINDS.SERVER, String(err?.message));
        const transient = TRANSIENT_KINDS.has(error.kind);
        lastError = error;
        let delay = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
        attempt += 1;
        if (!transient) {
          // The configuration is wrong: say it, and retry slowly in case the server is the cause.
          delay = CREDENTIALS_RETRY_MS;
        }
        failingSince ??= now();
        connectLog.fail(`IRC connection failed: ${error.message}`);
        if (!transient || now() - failingSince >= LOST_AFTER_MS) {
          if (connection !== CONNECTION.DISCONNECTED) {
            const wasConnected = connection === CONNECTION.CONNECTED;
            setConnection(CONNECTION.DISCONNECTED);
            logger.warn(`IRC connection lost: ${error.message}`);
            if (wasConnected) {
              lostFired = true;
              await fire(TRIGGERS.LOST, { error: errorText(error, config.language) });
            }
          }
          await publishStatus(false, errorTexts(error));
        } else {
          // Try again when the minute is over, so the loss is declared on time.
          delay = Math.max(1000, Math.min(delay, failingSince + LOST_AFTER_MS - now()));
        }
        await sleep(delay, signal);
      }
    }
  }

  // --- Incoming messages -----------------------------------------------------------

  async function handleMessage(current, message) {
    if (message.text.trim() === '' || ircLower(message.nick) === ircLower(current.nick)) {
      return;
    }
    if (message.playback) {
      return; // history replayed by a bouncer: never acted upon
    }
    if (message.time !== null && message.time < now() - MAX_MESSAGE_AGE_MS) {
      logger.debug(`Message from ${message.nick} skipped: too old`);
      return;
    }
    const person = findAllowed(config.allowed_users, message);
    if (!person) {
      logger.debug(`Message from ${message.nick} ignored: not an allowed person`);
      return;
    }
    if (data.nicks?.[person.id] !== message.nick) {
      data.nicks = { ...data.nicks, [person.id]: message.nick };
      store.save(data);
    }
    verified.set(ircLower(message.nick), { id: person.id, at: now() });
    if (message.private) {
      await handleConversation(message, person);
    } else if (channels.get(message.target)?.joined) {
      await handleChannelMessage(message, person);
    }
  }

  async function handleChannelMessage(message, person) {
    const text = message.text.trim();
    data.recent = [
      {
        channel: message.target,
        sender: message.nick,
        text: text.slice(0, 500),
        at: new Date(now()).toISOString(),
      },
      ...(data.recent ?? []),
    ].slice(0, RECENT_KEPT);
    store.save(data);
    refreshWidget();
    logger.debug(`Message from ${person.id} in ${message.target}`);
    const common = {
      channel: message.target,
      sender: person.id,
      nickname: message.nick,
      text: text.slice(0, 1000),
    };
    await fire(TRIGGERS.MESSAGE, common);
    const command = parseCommand(text, config.command_prefix);
    if (command) {
      await fire(TRIGGERS.COMMAND, {
        ...common,
        command: command.command.slice(0, 1000),
        arguments: command.args.slice(0, 1000),
      });
    }
  }

  async function reply(nick, text) {
    try {
      await session?.say(nick, text);
    } catch (err) {
      logger.warn(`Cannot answer in IRC: ${err.message}`);
    }
  }

  async function handleConversation(message, person) {
    const text = message.text.trim();
    const nick = message.nick;
    if (LINK_CODE.test(text)) {
      try {
        const user = await gladys.linkContact(text.toUpperCase(), person.id, nick);
        logger.info(`IRC person ${person.id} linked to a Gladys user`);
        const language = BOT_TEXT[user?.language] ? user.language : config.language;
        await reply(nick, pick(BOT_TEXT, language).linked(user?.first_name || nick));
        return;
      } catch (err) {
        if (err?.status !== 404) {
          logger.warn(`Cannot link ${person.id}: ${err.message}`);
          await reply(nick, pick(BOT_TEXT, config.language).unavailable);
          return;
        }
        // Not a valid code: maybe a word that looks like one, for the brain.
      }
    }
    try {
      await gladys.publishMessage(person.id, text.slice(0, MAX_TEXT_LENGTH), {
        createdAt: new Date(message.time ?? now()),
      });
      brainLog.ok();
      logger.debug(`Message from ${person.id} passed to Gladys`);
    } catch (err) {
      if (err?.status === 404) {
        logger.info(`Message from ${person.id}, not linked: instructions sent`);
        await reply(nick, pick(BOT_TEXT, config.language).notLinked);
        return;
      }
      brainLog.fail(`Cannot pass a message to Gladys: ${err.message}`);
      await reply(nick, pick(BOT_TEXT, config.language).unavailable);
    }
  }

  /**
   * The nickname an allowed person goes by right now, checked by WHOIS (a
   * nickname can change hands): throws NOT_ONLINE when nobody matching has it.
   */
  async function currentNick(current, person) {
    const maskNick = person.kind === 'mask' ? person.id.split('!')[0] : '';
    const nick =
      data.nicks?.[person.id] ??
      (person.kind === 'account' ? person.id : /[*?]/.test(maskNick) ? null : maskNick);
    if (!nick) {
      throw new IrcError(ERROR_KINDS.NOT_ONLINE, 'Nickname unknown');
    }
    const known = verified.get(ircLower(nick));
    if (known?.id === person.id && now() - known.at < IDENTITY_TTL_MS) {
      return nick;
    }
    const who = await current.whois(nick);
    if (!who || findAllowed([person], who)?.id !== person.id) {
      verified.delete(ircLower(nick));
      throw new IrcError(ERROR_KINDS.NOT_ONLINE, `${nick} is not ${person.id} now`);
    }
    verified.set(ircLower(nick), { id: person.id, at: now() });
    return nick;
  }

  // --- Configuration -------------------------------------------------------------

  async function stopLoop() {
    controller?.abort();
    await running;
    controller = null;
    running = null;
  }

  function applyConfig(raw, reconnected = false) {
    // Serialized: two saves in a row must never leave two sessions running.
    applying = applying.then(() => doApplyConfig(raw, reconnected));
    return applying;
  }

  async function doApplyConfig(raw, reconnected) {
    await loaded;
    const next = normalizeConfig(raw);
    const key = JSON.stringify(next);
    if (reconnected && running && key === appliedKey) {
      // The SDK reconnected to Gladys, the configuration is the same: keep the
      // IRC session (no QUIT and rejoin in the channels), publish the status again.
      if (connection === CONNECTION.CONNECTED) {
        await publishStatus(true, connectedStatus());
      } else if (lastError && connection === CONNECTION.DISCONNECTED) {
        await publishStatus(false, errorTexts(lastError));
      }
      return;
    }
    appliedKey = key;
    await stopLoop();
    config = next;
    session = null;
    lastError = null;
    lostFired = false;
    sessionOptions = null;
    verified = new Map();
    channels = new Map(config.channels.map((name) => [name, newChannel()]));
    const server = parseServer(config.server);
    const tls = config.tls || server?.scheme === 'ircs';
    if (!config.server) {
      configError = new IrcError(ERROR_KINDS.NOT_CONFIGURED, 'No server');
    } else if (!server) {
      configError = new IrcError(ERROR_KINDS.INVALID_SERVER, 'Server not understood');
    } else if (!parseNickname(config.nickname)) {
      configError = new IrcError(ERROR_KINDS.INVALID_NICKNAME, 'Nickname not valid');
    } else if (config.auth !== 'none' && !config.password) {
      configError = new IrcError(ERROR_KINDS.NO_PASSWORD, 'No password');
    } else if (config.auth !== 'none' && !tls) {
      configError = new IrcError(ERROR_KINDS.INSECURE, 'A password needs TLS');
    } else {
      configError = null;
    }
    if (configError) {
      setConnection(CONNECTION.NOT_CONFIGURED);
      await publishStatus(false, errorTexts(configError));
      return;
    }
    sessionOptions = {
      host: server.host,
      port: server.port ?? (tls ? PORTS.tls : PORTS.plain),
      tls,
      allowSelfSigned: config.allow_self_signed,
      nick: config.nickname,
      auth: config.auth,
      account: config.account,
      password: config.password,
    };
    if (stopped) {
      return;
    }
    // Stays "connected" during a short outage: lost only after LOST_AFTER_MS (see loop).
    setConnection(CONNECTION.CONNECTING);
    controller = new AbortController();
    running = loop(controller.signal).catch((err) => logger.error('IRC loop stopped', err));
  }

  function requireConnected() {
    if (!sessionOptions) {
      throw configError;
    }
    if (!session) {
      throw lastError ?? new IrcError(ERROR_KINDS.UNREACHABLE, 'Not connected to IRC yet');
    }
    return session;
  }

  /** The report of a working connection; throws an ActionFailure otherwise. */
  async function testConnection() {
    try {
      const current = requireConnected();
      await current.ping();
      const server = `${sessionOptions.host}:${sessionOptions.port}`;
      const lines = (text) => [
        text.connected(current.nick, server),
        config.channels.length > 0
          ? text.channels(joinedCount(), config.channels.length)
          : text.noChannels,
        config.allowed_users.length > 0 ? text.users(config.allowed_users.length) : text.noUsers,
      ];
      logger.info('Connection tested');
      return each(REPORT_TEXT, (text) => lines(text).join(' '));
    } catch (err) {
      logger.info(`Connection test failed: ${err.message}`);
      throw new ActionFailure(each(REPORT_TEXT, (text, lang) => text.failed(errorText(err, lang))));
    }
  }

  // --- Handlers ------------------------------------------------------------------

  gladys.onSendMessage(async (contact, message) => {
    const contactId = typeof contact?.id === 'string' ? contact.id : '';
    // Right after a start (the "Gladys updated" message), the bot may still be logging in.
    await whenConnected(CONNECT_WAIT_MS);
    const person = config.allowed_users.find((entry) => entry.id === contactId);
    if (!person) {
      // Linked once, then removed from the allowed people: nothing goes out to them.
      logger.debug(
        `Message to ${contactId || 'an unknown contact'} not sent: not an allowed person`,
      );
      return;
    }
    const text = typeof message?.text === 'string' ? message.text : '';
    if (text.trim() === '') {
      return; // an image alone: not supported over IRC (see the documentation)
    }
    try {
      const deadline = AbortSignal.timeout(MESSAGE_TIMEOUT_MS - CONNECT_WAIT_MS);
      await Promise.race([
        (async () => {
          const current = requireConnected();
          await current.say(await currentNick(current, person), text);
        })(),
        new Promise((_, reject) =>
          deadline.addEventListener('abort', () =>
            reject(new IrcError(ERROR_KINDS.TIMEOUT, 'No answer in time')),
          ),
        ),
      ]);
    } catch (err) {
      logger.warn(`Message not delivered to ${contactId}: ${err.message}`);
      throw new Error(`IRC: ${errorText(err, 'en')}`, { cause: err });
    }
  });

  gladys.onSceneAction(SCENE_ACTION_KEY, async (fields) => {
    const raw = typeof fields?.to === 'string' ? fields.to.trim() : '';
    const text = typeof fields?.message === 'string' ? fields.message : '';
    if (text.trim() === '') {
      throw new Error('IRC: the message is empty');
    }
    const to = isChannel(raw) ? parseChannel(raw) : parseNickname(raw);
    try {
      if (!to) {
        throw new IrcError(ERROR_KINDS.INVALID_TARGET, 'Recipient not understood');
      }
      const current = requireConnected();
      if (isChannel(to) && !channels.get(to)?.joined) {
        throw new IrcError(ERROR_KINDS.NOT_IN_CHANNEL, 'Not in the channel');
      }
      await current.say(to, text);
      logger.debug(`Scene message sent to ${to}`);
      return { sent: true, error: '' };
    } catch (err) {
      logger.warn(`Scene message not sent to ${to ?? raw}: ${err.message}`);
      return { sent: false, error: errorText(err, config.language) };
    }
  });

  gladys.onAction(ACTION_KEY, () => testConnection());

  gladys.onWidgetGet(WIDGET_KEY, async ({ language, settings }) => {
    await loaded;
    return buildWidgetContent(
      {
        connection,
        nickname: session?.nick ?? null,
        channels: { joined: joinedCount(), total: config.channels.length },
        recent: data.recent ?? [],
      },
      language,
      settings,
    );
  });

  gladys.onWidgetAction(WIDGET_KEY, async (actionKey) => {
    if (actionKey !== TEST_ACTION) {
      throw new Error(`Unknown widget action "${actionKey}"`);
    }
    const clip = (text) => (text.length > 200 ? `${text.slice(0, 199)}…` : text);
    try {
      return each(await testConnection(), clip);
    } catch (err) {
      throw err instanceof ActionFailure ? new ActionFailure(each(err.message, clip)) : err;
    }
  });

  gladys.onConfigUpdated((raw) => applyConfig(raw));

  gladys.on('connected', () => {
    lastStatus = null; // a new connection: publish the status again
    return applyConfig(gladys.config, true).catch((err) =>
      logger.error('Cannot apply the configuration', err),
    );
  });

  return {
    get config() {
      return config;
    },
    get connection() {
      return connection;
    },
    get data() {
      return data;
    },
    get channels() {
      return channels;
    },
    async stop() {
      stopped = true;
      await stopLoop();
      await store.flush();
    },
  };
}
