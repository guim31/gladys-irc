// -----------------------------------------------------------------------------
// The integration end to end: the fake Gladys of the SDK on one side, a fake
// IRC server on the other (test/helpers/world.js).
// -----------------------------------------------------------------------------

import test from 'node:test';
import assert from 'node:assert/strict';
import { GladysApiError } from '@gladysassistant/integration-sdk';
import {
  ACTION_KEY,
  CREDENTIALS_RETRY_MS,
  IDENTITY_TTL_MS,
  JOIN_TIMEOUT_MS,
  LOST_AFTER_MS,
  MAX_MESSAGE_AGE_MS,
  PING_INTERVAL_MS,
  SCENE_ACTION_KEY,
  TRIGGERS,
  findAllowed,
  parseCommand,
} from '../src/app.js';
import { normalizeConfig } from '../src/config.js';
import { ERROR_KINDS } from '../src/irc/errors.js';
import { WIDGET_KEY } from '../src/widgets.js';
import {
  ALICE,
  BASE_CONFIG,
  BOB,
  CHANNEL,
  MALLORY,
  START,
  createFakeServer,
  createWorld,
  query,
  say,
  settle,
} from './helpers/world.js';

async function connected(t, options) {
  const world = await createWorld(options);
  t.after(() => world.app.stop());
  assert.equal(world.app.connection, 'connected');
  return world;
}

test('not configured: says what is missing, never connects', async (t) => {
  const server = createFakeServer();
  const world = await createWorld({ config: {}, server });
  t.after(() => world.app.stop());
  assert.equal(world.app.connection, 'not_configured');
  assert.equal(world.fake.connectionStatus.connected, false);
  assert.match(world.fake.connectionStatus.message.en, /enter the IRC server/);

  await world.fake.configUpdated({ server: 'https://irc.example.org' });
  assert.match(world.fake.connectionStatus.message.fr, /serveur incompris/);
  await world.fake.configUpdated({ server: 'irc.example.org', nickname: '9lives' });
  assert.match(world.fake.connectionStatus.message.de, /Nickname abgelehnt/);
  await world.fake.configUpdated({ server: 'irc.example.org' });
  assert.match(world.fake.connectionStatus.message.es, /introduzca la contraseña/);
  await world.fake.configUpdated({ server: 'irc.example.org', password: 'x', tls: false });
  assert.match(world.fake.connectionStatus.message.en, /never sent in clear text/);
  assert.equal(server.starts, 0);

  const ack = await world.fake.action(ACTION_KEY, {});
  assert.equal(ack.success, false);
  assert.match(ack.error.fr, /^Échec de la connexion : TLS désactivé/);
});

test('connects with the configured options, joins the channels, says it', async (t) => {
  const world = await connected(t);
  const [session] = world.server.sessions;
  assert.deepEqual(session.options, {
    host: 'irc.example.org',
    port: 6697,
    tls: true,
    allowSelfSigned: false,
    nick: 'Gladys',
    auth: 'sasl',
    account: '',
    password: 'robot-pass-123',
  });
  assert.deepEqual(world.server.joins, [CHANNEL]);
  assert.equal(world.app.channels.get(CHANNEL).joined, true);
  assert.deepEqual(world.fake.connectionStatus, { connected: true });

  const ack = await world.fake.action(ACTION_KEY, {});
  assert.equal(ack.success, true);
  assert.equal(
    ack.data.message.en,
    'Connected to irc.example.org:6697 as Gladys. Channels joined: 1/1. Allowed people: 2.',
  );
});

test('without a password nor TLS: port 6667, no authentication', async (t) => {
  const world = await connected(t, {
    config: { server: 'irc.example.org', tls: false, auth: 'none', channels: '#a' },
  });
  const { options } = world.server.sessions[0];
  assert.equal(options.port, 6667);
  assert.equal(options.tls, false);
  assert.equal(options.auth, 'none');
});

test('channel messages of allowed people fire the triggers, nobody else', async (t) => {
  const world = await connected(t);
  await world.server.deliver(say(ALICE, '!Lumieres off'));
  assert.deepEqual(world.fake.sceneEvents, [
    {
      key: TRIGGERS.MESSAGE,
      data: { channel: CHANNEL, sender: 'alice', nickname: 'alice', text: '!Lumieres off' },
    },
    {
      key: TRIGGERS.COMMAND,
      data: {
        channel: CHANNEL,
        sender: 'alice',
        nickname: 'alice',
        text: '!Lumieres off',
        command: 'lumieres',
        arguments: 'off',
      },
    },
  ]);
  assert.deepEqual(world.store.data.recent, [
    { channel: CHANNEL, sender: 'alice', text: '!Lumieres off', at: new Date(START).toISOString() },
  ]);

  // A hostmask entry matches Bob from his host.
  await world.server.deliver(say(BOB, 'hello'));
  assert.equal(world.fake.sceneEvents.at(-1).data.sender, 'bob!*@home.example.org');

  const count = world.fake.sceneEvents.length;
  // Mallory under the nickname "alice", without the account: not Alice.
  await world.server.deliver(say({ ...MALLORY, nick: 'alice' }, '!garage open'));
  // Mallory under the nickname "bob", from another host: not Bob.
  await world.server.deliver(say({ ...MALLORY, nick: 'bob' }, '!garage open'));
  await world.server.deliver(say(ALICE, '!garage open', { playback: true }));
  await world.server.deliver(say(ALICE, '!garage open', { time: START - MAX_MESSAGE_AGE_MS - 1 }));
  await world.server.deliver(say(ALICE, 'hello', { channel: '#other' }));
  await world.server.deliver(say({ ...ALICE, nick: 'Gladys' }, 'echo'));
  assert.equal(world.fake.sceneEvents.length, count);
  assert.deepEqual(world.fake.messages, [], 'a channel never reaches the brain');
  assert.deepEqual(world.server.said, [], 'Gladys never answers in a channel');
});

test('private: the link code links the person, then messages go to Gladys and back', async (t) => {
  const world = await connected(t, {
    linkedUser: { selector: 'alice', first_name: 'Alice', language: 'fr' },
  });
  await world.server.deliver(query(ALICE, 'abcd2345'));
  assert.equal(world.fake.contacts[0].contact_id, 'alice');
  assert.equal(world.server.said[0].target, 'alice');
  assert.match(world.server.said[0].text, /^Bonjour Alice/);
  assert.deepEqual(world.fake.sceneEvents, [], 'a conversation fires no trigger');

  await world.server.deliver(query(ALICE, 'Bonjour Gladys', { time: START - 1000 }));
  assert.deepEqual(world.fake.messages, [
    {
      contact_id: 'alice',
      text: 'Bonjour Gladys',
      created_at: new Date(START - 1000).toISOString(),
    },
  ]);

  const ack = await world.fake.sendMessage({ id: 'alice' }, { text: 'Il fait 21 °C', file: null });
  assert.equal(ack.success, true);
  assert.deepEqual(world.server.said.at(-1).target, 'alice');
  assert.deepEqual(world.server.said.at(-1).lines, ['Il fait 21 °C']);
});

test('an answer follows the person to a new nickname, checked by WHOIS', async (t) => {
  const world = await connected(t);
  const away = { ...ALICE, nick: 'alice_away' };
  world.server.users.set('alice_away', away);
  await world.server.deliver(query(away, 'hello'));
  assert.equal(world.store.data.nicks.alice, 'alice_away');
  // Seen a moment ago: no WHOIS needed.
  await world.fake.sendMessage({ id: 'alice' }, { text: 'one', file: null });
  assert.equal(world.server.whoisCount, 0);
  assert.equal(world.server.said.at(-1).target, 'alice_away');

  // Later, the nickname changed hands: nothing private goes to the newcomer.
  world.clock.time += IDENTITY_TTL_MS;
  world.server.users.set('alice_away', { ...MALLORY, nick: 'alice_away' });
  const ack = await world.fake.sendMessage({ id: 'alice' }, { text: 'secret', file: null });
  assert.equal(ack.success, false);
  assert.match(ack.error, /IRC: this person is not on IRC, or not identified/);
  assert.equal(world.server.said.at(-1).text, 'one');
});

test('an answer to a person never seen: the account name, if WHOIS proves it', async (t) => {
  const world = await connected(t);
  let ack = await world.fake.sendMessage({ id: 'alice' }, { text: 'hi', file: null });
  assert.equal(ack.success, true);
  assert.equal(world.server.said.at(-1).target, 'alice');
  world.server.users.delete('bob');
  ack = await world.fake.sendMessage({ id: 'bob!*@home.example.org' }, { text: 'x', file: null });
  assert.equal(ack.success, false);
});

test('nothing goes out to a contact who is not, or no longer, an allowed person', async (t) => {
  const world = await connected(t);
  const ack = await world.fake.sendMessage({ id: 'mallory' }, { text: 'secret', file: null });
  assert.equal(ack.success, true);
  await world.fake.sendMessage({ id: 'alice' }, { text: '', file: 'image/jpg;base64,/9j/4AAQ' });
  assert.deepEqual(world.server.said, []);
});

test('a person not linked gets the instructions; Gladys down gets an apology', async (t) => {
  const world = await connected(t);
  t.mock.method(world.gladys, 'publishMessage', async () => {
    throw new GladysApiError(404, 'NOT_FOUND', 'CONTACT_NOT_FOUND');
  });
  t.mock.method(world.gladys, 'linkContact', async () => {
    throw new GladysApiError(404, 'NOT_FOUND', 'INVALID_LINK_CODE');
  });
  await world.server.deliver(query(ALICE, 'Hello'));
  assert.match(world.server.said[0].text, /Generate a link code/);
  await world.server.deliver(query(ALICE, 'ZZZZ9999'));
  assert.match(world.server.said[1].text, /Generate a link code/);
  world.gladys.publishMessage.mock.mockImplementation(async () => {
    throw new GladysApiError(500, 'SERVER_ERROR', 'down');
  });
  await world.server.deliver(query(ALICE, 'Hello'));
  assert.match(world.server.said[2].text, /try again later/);
  // Strangers get nothing at all.
  await world.server.deliver(query(MALLORY, 'Hello'));
  assert.equal(world.server.said.length, 3);
});

test('a message of Gladys that cannot be sent is reported as a failure', async (t) => {
  const world = await connected(t);
  world.server.sayFails = ERROR_KINDS.FLOOD;
  const ack = await world.fake.sendMessage({ id: 'alice' }, { text: 'x', file: null });
  assert.equal(ack.success, false);
  assert.match(ack.error, /IRC: too many messages waiting/);
});

test('scene action: to a nickname, to a channel, failures as outputs', async (t) => {
  const world = await connected(t);
  let ack = await world.fake.sceneAction(SCENE_ACTION_KEY, { to: 'Bob', message: 'Hi' });
  assert.deepEqual(ack.data.outputs, { sent: true, error: '' });
  ack = await world.fake.sceneAction(SCENE_ACTION_KEY, { to: '#Maison', message: 'Alarm on' });
  assert.deepEqual(ack.data.outputs, { sent: true, error: '' });
  assert.deepEqual(
    world.server.said.map(({ target, text }) => [target, text]),
    [
      ['Bob', 'Hi'],
      [CHANNEL, 'Alarm on'],
    ],
  );

  ack = await world.fake.sceneAction(SCENE_ACTION_KEY, { to: 'two words', message: 'x' });
  assert.deepEqual(ack.data.outputs, {
    sent: false,
    error: 'recipient not understood: a nickname or a channel such as #home',
  });
  ack = await world.fake.sceneAction(SCENE_ACTION_KEY, { to: 'bob\r\nQUIT', message: 'x' });
  assert.equal(ack.data.outputs.sent, false);
  ack = await world.fake.sceneAction(SCENE_ACTION_KEY, { to: '#elsewhere', message: 'x' });
  assert.equal(ack.data.outputs.error, 'the bot is not in this channel: add it to the channels');
  ack = await world.fake.sceneAction(SCENE_ACTION_KEY, { to: 'bob', message: ' ' });
  assert.equal(ack.success, false);
  assert.equal(world.server.said.length, 2);
});

test('channels refused, silent or kicked from: reported, retried when it makes sense', async (t) => {
  const server = createFakeServer();
  server.refuse.set('#locked', 'invite_only_channel');
  server.refuse.set('#full', 'channel_is_full');
  server.silent.add('#slow');
  const world = await createWorld({
    server,
    config: { ...BASE_CONFIG, channels: `${CHANNEL}, #locked, #full, #slow` },
  });
  t.after(() => world.app.stop());
  await world.tick(JOIN_TIMEOUT_MS);
  assert.equal(world.app.connection, 'connected');
  assert.match(
    world.fake.connectionStatus.message.en,
    /could not be joined: #locked, #full, #slow/,
  );
  assert.equal(world.app.channels.get('#locked').rejoin, false);
  assert.equal(world.app.channels.get('#full').rejoin, true);
  assert.equal(world.app.channels.get('#slow').rejoin, true);

  server.refuse.delete('#full');
  await world.tick(PING_INTERVAL_MS);
  assert.equal(world.app.channels.get('#full').joined, true);
  assert.equal(server.joins.filter((name) => name === '#locked').length, 1);

  server.session.emit('left', CHANNEL, 'kick');
  await settle();
  assert.equal(world.app.channels.get(CHANNEL).joined, false);
  assert.equal(world.app.channels.get(CHANNEL).rejoin, false, 'kicked: stays out');
  const widget = await world.fake.widgetGet(WIDGET_KEY, { language: 'en', settings: {} });
  assert.equal(widget.data.content.components[0].items.at(-1).value, '1/4');

  // A channel the server forced the bot into is left.
  server.session.emit('joined', '#spam');
  await settle();
  assert.deepEqual(server.parts, ['#spam']);
});

test('the server goes away: lost after a minute, restored when back', async (t) => {
  const world = await connected(t);
  world.server.down = ERROR_KINDS.UNREACHABLE;
  world.server.session.drop();
  await settle();
  assert.equal(world.app.connection, 'connected', 'a blip is not a loss');
  while (world.clock.time - START < LOST_AFTER_MS) {
    await world.wake();
  }
  assert.equal(world.app.connection, 'disconnected');
  assert.deepEqual(world.fake.sceneEvents, [
    { key: TRIGGERS.LOST, data: { error: 'the IRC server does not answer' } },
  ]);
  assert.match(world.fake.connectionStatus.message.fr, /le serveur IRC ne répond pas/);
  const failed = await world.fake.action(ACTION_KEY, {});
  assert.equal(failed.success, false);
  assert.match(failed.error.en, /^Connection failed: the IRC server does not answer/);

  world.server.down = null;
  await world.wake();
  assert.equal(world.app.connection, 'connected');
  assert.deepEqual(world.fake.sceneEvents.at(-1), {
    key: TRIGGERS.RESTORED,
    data: { nickname: 'Gladys' },
  });
  assert.equal(world.app.channels.get(CHANNEL).joined, true, 'channels joined again');
});

test('a dead connection is noticed by the ping', async (t) => {
  const world = await connected(t);
  world.server.pingFails = true;
  await world.tick(PING_INTERVAL_MS);
  assert.equal(world.server.sessions[0].closed, true);
  world.server.pingFails = false;
  await world.wake();
  assert.equal(world.server.sessions.length, 2);
  assert.equal(world.app.connection, 'connected');
});

test('a refused password: lost at once, retried slowly', async (t) => {
  const world = await createWorld({ config: { ...BASE_CONFIG, password: 'wrong' } });
  t.after(() => world.app.stop());
  assert.equal(world.app.connection, 'disconnected');
  assert.match(world.fake.connectionStatus.message.en, /account or password refused/);
  assert.equal(world.sleeps[0].ms, CREDENTIALS_RETRY_MS);
});

test('a new configuration replaces the session, never two at once', async (t) => {
  const world = await connected(t);
  await Promise.all([
    world.fake.configUpdated({ ...BASE_CONFIG, nickname: 'Gladys2' }),
    world.fake.configUpdated({ ...BASE_CONFIG, nickname: 'Gladys3' }),
  ]);
  await settle();
  const open = world.server.sessions.filter((session) => !session.closed);
  assert.equal(open.length, 1);
  assert.equal(open[0].options.nick, 'Gladys3');
});

test('widget: connection, nickname, channels, recent messages, test button, settings', async (t) => {
  const world = await connected(t);
  await world.server.deliver(say(ALICE, 'Bonjour'));
  let ack = await world.fake.widgetGet(WIDGET_KEY, { language: 'fr', settings: {} });
  const [status, list, button] = ack.data.content.components;
  assert.deepEqual(
    status.items.map((item) => [item.label, item.value]),
    [
      ['IRC', 'Connecté'],
      ['Pseudo', 'Gladys'],
      ['Salons', 1],
    ],
  );
  assert.equal(list.items[0].description, 'Bonjour');
  assert.equal(button.action.key, 'test');
  ack = await world.fake.widgetGet(WIDGET_KEY, {
    language: 'en',
    settings: { show_messages: false, show_test_button: false },
  });
  assert.equal(ack.data.content.components.length, 1);

  const pressed = await world.fake.widgetAction(WIDGET_KEY, 'test', {}, { settings: {} });
  assert.equal(pressed.success, true);
  world.server.pingFails = true;
  const failed = await world.fake.widgetAction(WIDGET_KEY, 'test', {}, { settings: {} });
  assert.equal(failed.success, false);
  assert.match(failed.error.fr, /^Échec de la connexion : le serveur IRC répond trop lentement/);
});

test('parseCommand and findAllowed', () => {
  assert.deepEqual(parseCommand('!Lights off now', '!'), { command: 'lights', args: 'off now' });
  assert.equal(parseCommand('lights', '!'), null);
  assert.equal(parseCommand('! lights', '!'), null);
  const { allowed_users: allowed } = normalizeConfig({
    allowed_users: 'Alice, *!*@*.Example.ORG, [Bot]',
  });
  assert.deepEqual(
    allowed.map((entry) => [entry.id, entry.kind]),
    [
      ['alice', 'account'],
      ['*!*@*.example.org', 'mask'],
      ['{bot}', 'account'],
    ],
  );
  assert.equal(findAllowed(allowed, { ...MALLORY, account: 'ALICE' })?.id, 'alice');
  assert.equal(findAllowed(allowed, { ...MALLORY, hostname: 'x.example.org' })?.kind, 'mask');
  assert.equal(findAllowed(allowed, { ...MALLORY, hostname: 'example.org.evil' }), null);
  assert.equal(findAllowed(allowed, { ...MALLORY, account: '{bot}' })?.id, '{bot}');
});
