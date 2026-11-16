// -----------------------------------------------------------------------------
// The IRC building blocks without a server: configuration parsing, line
// splitting, error sorting, and the session over a fake irc-framework client
// (registration, SASL refused, nickname taken, flood control).
// -----------------------------------------------------------------------------

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { DEFAULT_CONFIG, ircLower, normalizeConfig, parseServer } from '../src/config.js';
import { BURST_LINES, IrcSession, LINE_INTERVAL_MS } from '../src/irc/connection.js';
import { ERROR_KINDS, classifyError } from '../src/irc/errors.js';
import { MAX_LINES, splitMessage } from '../src/irc/split.js';

const bytes = (text) => Buffer.byteLength(text);

test('parseServer: host, host:port, irc:// and ircs://, nothing else', () => {
  assert.equal(parseServer(''), null);
  assert.deepEqual(parseServer('irc.libera.chat'), {
    host: 'irc.libera.chat',
    port: null,
    scheme: null,
  });
  assert.deepEqual(parseServer('192.0.2.10:6667'), {
    host: '192.0.2.10',
    port: 6667,
    scheme: null,
  });
  assert.deepEqual(parseServer('ircs://irc.oftc.net/'), {
    host: 'irc.oftc.net',
    port: 6697,
    scheme: 'ircs',
  });
  assert.equal(parseServer('[2001:db8::1]:6697').host, '2001:db8::1');
  for (const wrong of ['https://irc.example.org', 'user:pw@irc.example.org', 'irc.example.org/x']) {
    assert.equal(parseServer(wrong), undefined, wrong);
  }
});

test('normalizeConfig: defaults, channels, allowed people, prefix', () => {
  const config = normalizeConfig({});
  assert.equal(config.nickname, DEFAULT_CONFIG.nickname);
  assert.equal(config.tls, true);
  assert.equal(config.auth, 'sasl');
  assert.deepEqual(config.channels, []);
  const typed = normalizeConfig({
    channels: '#Maison, #maison ; #Alertes\n bad, #with space',
    allowed_users: 'Alice, alice, nick, *!*@*, x y',
    command_prefix: 'long!',
    auth: 'kerberos',
    tls: 'false',
    language: 'it',
  });
  assert.deepEqual(typed.channels, ['#maison', '#alertes', '#with']);
  assert.deepEqual(
    typed.allowed_users.map((entry) => entry.id),
    ['alice', 'nick', '*!*@*', 'x', 'y'],
  );
  assert.equal(typed.command_prefix, '!');
  assert.equal(typed.auth, 'sasl');
  assert.equal(typed.tls, false);
  assert.equal(typed.language, 'fr');
  assert.equal(ircLower('[Gladys]\\~'), '{gladys}|^');
});

test('splitMessage: line breaks, 400 bytes of UTF-8 between words, 10 lines at most', () => {
  assert.deepEqual(splitMessage('one\r\ntwo\n\n  \nthree\0'), ['one', 'two', 'three']);
  assert.deepEqual(splitMessage('   '), []);
  const words = splitMessage('mot '.repeat(150));
  assert.equal(words.length, 2);
  assert.ok(words.every((line) => bytes(line) <= 400 && !line.startsWith(' ')));
  assert.ok(words[0].endsWith('mot'));
  const accents = splitMessage('é'.repeat(300));
  assert.deepEqual(
    accents.map((line) => bytes(line)),
    [400, 200],
  );
  assert.equal(accents.join(''), 'é'.repeat(300), 'no character lost or cut');
  const many = splitMessage(Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n'));
  assert.equal(many.length, MAX_LINES);
  assert.equal(many.at(-1), 'line 9 …');
});

test('classifyError: network, certificate, TLS on a plain port', () => {
  assert.equal(classifyError({ code: 'ECONNREFUSED', message: 'x' }).kind, ERROR_KINDS.UNREACHABLE);
  assert.equal(
    classifyError({ code: 'DEPTH_ZERO_SELF_SIGNED_CERT', message: 'self-signed' }).kind,
    ERROR_KINDS.CERTIFICATE,
  );
  assert.equal(
    classifyError(new Error('ssl3_get_record:wrong version number')).kind,
    ERROR_KINDS.INSECURE,
  );
  assert.equal(classifyError(new Error('odd')).kind, ERROR_KINDS.SERVER);
});

// A fake irc-framework client: records what the session writes, lets a test
// play the server.
class FakeClient extends EventEmitter {
  constructor() {
    super();
    this.user = {};
    this.written = [];
    this.raws = [];
    this.connection = { write: (line) => this.written.push(line), transport: null };
  }

  connect(options) {
    this.options = options;
    this.user.nick = options.nick;
  }

  raw(...args) {
    this.raws.push(args);
  }

  changeNick(nick) {
    this.raws.push(['NICK', nick]);
  }

  quit() {
    setImmediate(() => this.emit('socket close'));
  }
}

const OPTIONS = {
  host: 'irc.example.org',
  port: 6697,
  tls: true,
  nick: 'Gladys',
  auth: 'sasl',
  password: 'robot-pass-123',
};

function session(options = OPTIONS) {
  const client = new FakeClient();
  return { client, session: new IrcSession(options, { createClient: () => client }) };
}

test('session: SASL options, registration, the nickname of the server', async (t) => {
  const { client, session: irc } = session();
  t.after(() => irc.stop());
  const started = irc.start();
  assert.deepEqual(client.options.account, { account: 'Gladys', password: 'robot-pass-123' });
  assert.equal(client.options.sasl_disconnect_on_fail, true);
  assert.equal(client.options.auto_reconnect, false);
  assert.equal(client.options.rejectUnauthorized, true);
  client.emit('nick in use', { nick: 'Gladys' });
  assert.deepEqual(client.raws.at(-1), ['NICK', 'Gladys_']);
  client.emit('registered', { nick: 'Gladys_' });
  assert.equal(await started, 'Gladys_');
  assert.equal(irc.identified, true);
});

test('session: SASL refused, no SASL, nickname taken thrice, closed by the server', async () => {
  const cases = [
    [(c) => c.emit('sasl failed', { reason: 'fail' }), ERROR_KINDS.BAD_LOGIN],
    [(c) => c.emit('sasl failed', { reason: 'capability_missing' }), ERROR_KINDS.NO_SASL],
    [(c) => ['a', 'b', 'c'].forEach(() => c.emit('nick in use', {})), ERROR_KINDS.NICKNAME_IN_USE],
    [(c) => c.emit('irc error', { error: 'password_mismatch' }), ERROR_KINDS.BAD_LOGIN],
    [
      (c) => {
        c.emit('irc error', { error: 'irc', reason: 'Closing Link: K-Lined' });
        c.emit('socket close');
      },
      ERROR_KINDS.BANNED,
    ],
    [(c) => c.emit('socket close', { code: 'ECONNREFUSED' }), ERROR_KINDS.UNREACHABLE],
  ];
  for (const [play, kind] of cases) {
    const { client, session: irc } = session();
    const started = irc.start();
    play(client);
    await assert.rejects(started, (err) => err.kind === kind, kind);
    assert.equal(irc.closed, true);
  }
});

test('session: NickServ identification, messages, joins and kicks as events', async (t) => {
  const { client, session: irc } = session({ ...OPTIONS, auth: 'nickserv', account: 'gladys' });
  t.after(() => irc.stop());
  const started = irc.start();
  assert.equal(client.options.account, undefined);
  client.emit('registered', { nick: 'Gladys' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(client.raws.at(-1), ['PRIVMSG', 'NickServ', 'IDENTIFY gladys robot-pass-123']);
  client.emit('loggedin', { account: 'gladys' });
  await started;
  assert.equal(irc.identified, true);

  const events = [];
  irc.on('message', (message) => events.push(['message', message]));
  irc.on('joined', (name) => events.push(['joined', name]));
  irc.on('left', (name, reason) => events.push(['left', name, reason]));
  client.emit('join', { nick: 'Gladys', channel: '#Maison' });
  client.emit('join', { nick: 'alice', channel: '#maison' });
  client.emit('privmsg', {
    nick: 'alice',
    ident: '~a',
    hostname: '198.51.100.7',
    target: '#maison',
    message: 'hi',
    account: 'alice',
    time: 1,
  });
  client.emit('privmsg', { nick: 'bob', target: 'gladys', message: 'psst', account: '*' });
  client.emit('privmsg', { from_server: true, target: 'Gladys', message: 'MOTD' });
  client.emit('kick', { kicked: 'Gladys', channel: '#maison' });
  assert.deepEqual(events, [
    ['joined', '#maison'],
    [
      'message',
      {
        private: false,
        nick: 'alice',
        ident: '~a',
        hostname: '198.51.100.7',
        account: 'alice',
        target: '#maison',
        text: 'hi',
        time: 1,
        playback: false,
      },
    ],
    [
      'message',
      {
        private: true,
        nick: 'bob',
        ident: '',
        hostname: '',
        account: null,
        target: 'gladys',
        text: 'psst',
        time: null,
        playback: false,
      },
    ],
    ['left', '#maison', 'kick'],
  ]);
});

test('session: flood control sends a burst, then one line every 2 s', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  const { client, session: irc } = session();
  const started = irc.start();
  client.emit('registered', { nick: 'Gladys' });
  await started;
  await irc.say('#maison', 'a\nb\nc\nd\ne\nf');
  assert.equal(client.written.length, BURST_LINES);
  assert.equal(client.written[0], 'PRIVMSG #maison :a');
  t.mock.timers.tick(LINE_INTERVAL_MS);
  assert.equal(client.written.length, BURST_LINES + 1);
  t.mock.timers.tick(LINE_INTERVAL_MS);
  assert.deepEqual(client.written.slice(-2), ['PRIVMSG #maison :e', 'PRIVMSG #maison :f']);
  const ten = Array.from({ length: 10 }, (_, i) => `line ${i}`).join('\n');
  for (let i = 0; i < 4; i += 1) {
    await irc.say('#maison', ten);
  }
  await assert.rejects(irc.say('#maison', ten), (err) => err.kind === ERROR_KINDS.FLOOD);
  irc.close(null);
  await assert.rejects(irc.say('#maison', 'late'), (err) => err.kind === ERROR_KINDS.UNREACHABLE);
});

test('session: NickServ confirmed by a NOTICE or an ACCOUNT line, refused by a NOTICE', async () => {
  const plays = [
    [
      (c) => c.emit('notice', { nick: 'NickServ', message: 'You are now identified for gladys.' }),
      true,
    ],
    [(c) => c.emit('account', { nick: 'Gladys', account: 'gladys' }), true],
    [(c) => c.emit('notice', { nick: 'NickServ', message: 'Invalid password for gladys.' }), false],
    [(c) => c.emit('notice', { nick: 'mallory', message: 'You are now identified' }), null],
  ];
  for (const [play, expected] of plays) {
    const { client, session: irc } = session({ ...OPTIONS, auth: 'nickserv' });
    const started = irc.start();
    client.emit('registered', { nick: 'Gladys' });
    await new Promise((resolve) => setImmediate(resolve));
    play(client);
    if (expected === null) {
      // Not NickServ: still waiting; the real NickServ answers afterwards.
      client.emit('loggedin', { account: 'gladys' });
    }
    await started;
    assert.equal(irc.identified, expected ?? true);
    irc.close(null);
  }
});
