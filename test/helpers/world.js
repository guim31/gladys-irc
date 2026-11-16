// -----------------------------------------------------------------------------
// The integration wired to the fake Gladys of the SDK and to a fake IRC
// server (sessions emitting what src/irc/connection.js emits; the shape of the
// events was recorded from Ergo 2.19, see test/live.test.js). No network, a
// virtual clock, manual sleeps and timers.
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { ERROR_KINDS, IrcError } from '../../src/irc/errors.js';
import { splitMessage } from '../../src/irc/split.js';

export const BOT = 'Gladys';
export const PASSWORD = 'robot-pass-123';
export const CHANNEL = '#maison';
export const START = Date.parse('2026-11-16T08:00:00Z');

// Alice is identified to her account; Mallory took the nickname "bob".
export const ALICE = { nick: 'alice', ident: '~alice', hostname: '198.51.100.7', account: 'alice' };
export const MALLORY = { nick: 'mallory', ident: '~m', hostname: '203.0.113.9', account: null };
export const BOB = { nick: 'bob', ident: '~bob', hostname: 'home.example.org', account: null };

export const BASE_CONFIG = {
  server: 'irc.example.org',
  nickname: BOT,
  password: PASSWORD,
  channels: CHANNEL,
  allowed_users: 'alice, bob!*@home.example.org',
  language: 'en',
};

class FakeSession extends EventEmitter {
  constructor(server, options) {
    super();
    this.server = server;
    this.options = options;
    this.closed = false;
    this.nick = options.nick;
    this.identified = options.auth === 'sasl';
  }

  async start() {
    this.server.starts += 1;
    if (this.server.down) {
      throw new IrcError(this.server.down, `Fake failure: ${this.server.down}`);
    }
    if (this.options.auth !== 'none' && this.options.password !== PASSWORD) {
      throw new IrcError(ERROR_KINDS.BAD_LOGIN, 'SASL refused (fail)');
    }
    this.server.session = this;
    return this.nick;
  }

  join(name) {
    this.server.joins.push(name);
    setImmediate(() => {
      const refusal = this.server.refuse.get(name);
      if (this.server.silent.has(name)) {
        return;
      }
      if (refusal) {
        this.emit('join_failed', name, refusal);
      } else {
        this.emit('joined', name);
      }
    });
  }

  part(name) {
    this.server.parts.push(name);
  }

  async say(target, text) {
    if (this.closed) {
      throw new IrcError(ERROR_KINDS.UNREACHABLE, 'Not connected');
    }
    if (this.server.sayFails) {
      throw new IrcError(this.server.sayFails, 'Fake say failure');
    }
    const lines = splitMessage(text);
    this.server.said.push({ target, text, lines });
    return lines.length;
  }

  async whois(nick) {
    if (this.closed) {
      throw new IrcError(ERROR_KINDS.UNREACHABLE, 'Not connected');
    }
    this.server.whoisCount += 1;
    return this.server.users.get(nick.toLowerCase()) ?? null;
  }

  async ping() {
    if (this.closed || this.server.pingFails) {
      throw new IrcError(ERROR_KINDS.TIMEOUT, 'No PONG');
    }
    this.server.pings += 1;
  }

  async stop() {
    this.closed = true;
  }

  /** The server ends the session (restart, network). */
  drop(error = new IrcError(ERROR_KINDS.UNREACHABLE, 'ECONNRESET')) {
    if (!this.closed) {
      this.closed = true;
      this.closeError = error;
      this.emit('closed', error);
    }
  }
}

/** A fake IRC server: sessions, channels, users, and everything the bot said. */
export function createFakeServer() {
  const server = {
    down: null, // an error kind: every start fails with it
    starts: 0,
    pings: 0,
    whoisCount: 0,
    pingFails: false,
    sayFails: null,
    session: null, // the last started session
    sessions: [],
    joins: [],
    parts: [],
    said: [], // { target, text, lines }
    refuse: new Map(), // channel → join error
    silent: new Set(), // channels that never answer a join
    // Who is online now (WHOIS), by lower-case nickname.
    users: new Map([
      ['alice', ALICE],
      ['bob', BOB],
      ['mallory', MALLORY],
    ]),
  };
  server.createSession = (options) => {
    const session = new FakeSession(server, options);
    server.sessions.push(session);
    return session;
  };
  /** Delivers a message to the bot, and lets it be handled. */
  server.deliver = async (message) => {
    server.session.emit('message', message);
    await settle();
  };
  return server;
}

/** A channel message, as IrcSession emits it. */
export const say = (from, text, { channel = CHANNEL, time = null, playback = false } = {}) => ({
  private: false,
  ...from,
  target: channel,
  text,
  time,
  playback,
});

/** A private message to the bot. */
export const query = (from, text, { time = null } = {}) => ({
  private: true,
  ...from,
  target: BOT.toLowerCase(),
  text,
  time,
  playback: false,
});

export function createMemoryStore(initial = {}) {
  return {
    data: structuredClone(initial),
    writes: 0,
    async load() {
      return structuredClone(this.data);
    },
    async save(data) {
      this.data = structuredClone(data);
      this.writes += 1;
    },
    async flush() {},
  };
}

/** Lets pending promises and immediates settle. */
export async function settle(rounds = 20) {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/** Waits that a test ends by hand, moving the virtual clock. */
function manualWaits(clock) {
  const pending = [];
  const wait = (ms, signal) =>
    new Promise((resolve) => {
      const entry = { ms, resolve };
      pending.push(entry);
      signal?.addEventListener('abort', () => {
        pending.splice(pending.indexOf(entry) >>> 0, 1);
        resolve();
      });
    });
  /** Ends the oldest pending wait of this length (any length if omitted). */
  const end = async (ms) => {
    await settle();
    const index = pending.findIndex((entry) => ms === undefined || entry.ms === ms);
    if (index < 0) {
      throw new Error(`nothing is waiting${ms === undefined ? '' : ` ${ms} ms`}`);
    }
    const [entry] = pending.splice(index, 1);
    clock.time += entry.ms;
    entry.resolve();
    await settle();
    return entry.ms;
  };
  return { pending, wait, end };
}

export async function createWorld({
  config = BASE_CONFIG,
  stored = {},
  server = createFakeServer(),
  linkedUser,
} = {}) {
  const gladys = createFakeGladys({ config, linkedUser });
  const store = createMemoryStore(stored);
  const clock = { time: START };
  const sleeps = manualWaits(clock);
  const timers = manualWaits(clock);
  const app = registerHandlers(gladys, {
    createSession: server.createSession,
    store,
    now: () => clock.time,
    sleep: sleeps.wait,
    timer: timers.wait,
  });
  await gladys.connect();
  await settle();
  return {
    gladys,
    fake: gladys.fake,
    server,
    store,
    clock,
    sleeps: sleeps.pending,
    /** Ends the oldest retry sleep. */
    wake: () => sleeps.end(),
    /** Ends the oldest timer of this length (pings, join timeouts). */
    tick: (ms) => timers.end(ms),
    app,
  };
}
