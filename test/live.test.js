// -----------------------------------------------------------------------------
// Live checks against a real IRC server (Ergo), with the fake Gladys of the
// SDK: skipped unless IRC_LIVE_SERVER is set, so `npm test` and the CI never
// touch the network. The server needs two registered accounts, the bot and
// "alice" (passwords IRC_LIVE_BOT_PASSWORD and IRC_LIVE_ALICE_PASSWORD).
//
//   docker run -d --name gladys-test-irc-ergo --network gladys-test-irc \
//     --network-alias irc.test ghcr.io/ergochat/ergo:stable
//   IRC_LIVE_SERVER=irc.test:6697 IRC_LIVE_BOT=gladysbot ... node --test test/live.test.js
//
// With IRC_LIVE_RESTART=1, the test waits for the server to be restarted by
// hand (it prints when) and checks the bot comes back on its own.
// -----------------------------------------------------------------------------

import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers, TRIGGERS } from '../src/app.js';
import { IrcSession } from '../src/irc/connection.js';
import { createMemoryStore } from './helpers/world.js';

const env = process.env;
const live = Boolean(env.IRC_LIVE_SERVER);
const [host, port] = (env.IRC_LIVE_SERVER ?? 'irc.test:6697').split(':');
const BOT = env.IRC_LIVE_BOT ?? 'gladysbot';
const CHANNEL = '#gladys-live';

const until = async (check, ms = 20_000, what = 'condition') => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.fail(`timed out waiting for ${what}`);
};

async function alice() {
  const session = new IrcSession({
    host,
    port: Number(port),
    tls: true,
    allowSelfSigned: true,
    nick: 'alice',
    auth: 'sasl',
    password: env.IRC_LIVE_ALICE_PASSWORD,
  });
  await session.start();
  return session;
}

test(
  'live: TLS + SASL, channel, triggers, conversation, long message, restart',
  { skip: !live },
  async (t) => {
    const config = {
      server: env.IRC_LIVE_SERVER,
      allow_self_signed: true,
      nickname: BOT,
      password: env.IRC_LIVE_BOT_PASSWORD,
      channels: CHANNEL,
      allowed_users: 'alice',
      language: 'en',
    };
    const gladys = createFakeGladys({
      config,
      linkedUser: { selector: 'alice', first_name: 'Alice', language: 'en' },
    });
    let sessions = 0;
    const app = registerHandlers(gladys, {
      store: createMemoryStore(),
      createSession: (options) => {
        sessions += 1;
        return new IrcSession(options);
      },
    });
    t.after(() => app.stop());
    const person = await alice();
    t.after(() => person.stop());
    const heard = [];
    person.on('message', (message) => heard.push(message));
    person.join(CHANNEL);

    await gladys.connect();
    await until(() => app.connection === 'connected', 20_000, 'the bot connected');
    await until(() => app.channels.get(CHANNEL).joined, 10_000, 'the channel joined');
    assert.equal(gladys.fake.connectionStatus.connected, true);

    // A channel command of Alice fires both triggers, with her account.
    await person.say(CHANNEL, '!lights off');
    await until(() => gladys.fake.sceneEvents.length === 2, 10_000, 'the triggers');
    assert.deepEqual(gladys.fake.sceneEvents[1], {
      key: TRIGGERS.COMMAND,
      data: {
        channel: CHANNEL,
        sender: 'alice',
        nickname: 'alice',
        text: '!lights off',
        command: 'lights',
        arguments: 'off',
      },
    });

    // Private: a link code, then a message to the brain, then the answer back.
    await person.say(BOT, 'ABCD2345');
    await until(() => gladys.fake.contacts.length === 1, 10_000, 'the link');
    await person.say(BOT, 'Hello Gladys');
    await until(() => gladys.fake.messages.length === 1, 10_000, 'the message to Gladys');
    const long = `${'word '.repeat(120)}\nsecond line`;
    const ack = await gladys.fake.sendMessage({ id: 'alice' }, { text: long, file: null });
    assert.equal(ack.success, true);
    await until(() => heard.filter((m) => m.private).length >= 4, 15_000, 'the long answer');
    const lines = heard.filter((m) => m.private).map((m) => m.text);
    assert.match(lines[0], /^Hello Alice!/);
    assert.ok(lines.slice(1).every((line) => Buffer.byteLength(line) <= 400));
    assert.equal(lines.at(-1), 'second line');
    assert.equal(lines.slice(1, -1).join(' ').split(' ').length, 120);

    // The scene action writes in the channel.
    const scene = await gladys.fake.sceneAction('send_message', { to: CHANNEL, message: 'Alarm' });
    assert.deepEqual(scene.data.outputs, { sent: true, error: '' });
    await until(() => heard.some((m) => !m.private && m.text === 'Alarm'), 10_000, 'the scene');

    if (env.IRC_LIVE_RESTART) {
      console.log('IRC_LIVE: RESTART THE SERVER NOW');
      await until(() => sessions >= 2, 90_000, 'a new session after the restart');
      await until(() => app.channels.get(CHANNEL).joined, 60_000, 'the channel joined again');
      const back = await alice();
      t.after(() => back.stop());
      back.join(CHANNEL);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await back.say(CHANNEL, 'back');
      await until(() => gladys.fake.sceneEvents.some((e) => e.data.text === 'back'), 10_000);
    }
  },
);

test('live: a wrong password is refused, said in the status', { skip: !live }, async (t) => {
  const gladys = createFakeGladys({
    config: {
      server: env.IRC_LIVE_SERVER,
      allow_self_signed: true,
      nickname: 'gladyswrong',
      account: BOT,
      password: 'wrong-password',
    },
  });
  const app = registerHandlers(gladys, { store: createMemoryStore() });
  t.after(() => app.stop());
  await gladys.connect();
  await until(() => app.connection === 'disconnected', 20_000, 'the refusal');
  assert.match(gladys.fake.connectionStatus.message.en, /account or password refused/);
});

test('live: a self-signed certificate is refused unless accepted', { skip: !live }, async (t) => {
  const gladys = createFakeGladys({
    config: { server: env.IRC_LIVE_SERVER, nickname: 'gladyscert', auth: 'none' },
  });
  const app = registerHandlers(gladys, { store: createMemoryStore() });
  t.after(() => app.stop());
  await gladys.connect();
  await until(() => app.connection === 'disconnected', 20_000, 'the refusal');
  assert.match(gladys.fake.connectionStatus.message.en, /certificate of the server refused/);
});
