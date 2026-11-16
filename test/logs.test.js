// -----------------------------------------------------------------------------
// What reaches `docker logs`: the lifecycle at info level, everything per
// message at debug level, repeated failures once, never a token nor a password.
// -----------------------------------------------------------------------------

import test from 'node:test';
import assert from 'node:assert/strict';
import { ERROR_KINDS } from '../src/irc/errors.js';
import { ALICE, BASE_CONFIG, createWorld, query, say } from './helpers/world.js';

/**
 * Captures the lines of the SDK logger (console.log for debug/info,
 * console.error for warn/error), at every level.
 */
function captureLogs(t) {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = 'debug';
  const lines = [];
  // The SDK logger writes `[time] [LEVEL] [name]` then the arguments.
  const capture = (prefix, ...args) => {
    const [, level, name] = /\[(DEBUG|INFO|WARN|ERROR)\](?: \[([^\]]+)\])?/.exec(prefix) ?? [];
    const text = args.map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(' ');
    lines.push({ level: level?.toLowerCase(), name, text });
  };
  t.mock.method(console, 'log', capture);
  t.mock.method(console, 'error', capture);
  t.after(() => {
    if (previous === undefined) {
      delete process.env.LOG_LEVEL;
    } else {
      process.env.LOG_LEVEL = previous;
    }
  });
  return {
    lines,
    at: (...levels) => lines.filter((line) => levels.includes(line.level)).map((l) => l.text),
    clear: () => lines.splice(0),
  };
}

test('a normal cycle writes nothing at info level', async (t) => {
  const logs = captureLogs(t);
  const world = await createWorld({
    linkedUser: { selector: 'alice', first_name: 'Alice', language: 'en' },
  });
  t.after(() => world.app.stop());
  assert.ok(logs.at('info').some((line) => line.startsWith('Connected to IRC as')));
  logs.clear();
  await world.server.deliver(say(ALICE, '!lights off'));
  await world.server.deliver(say(ALICE, 'hello'));
  await world.server.deliver(query(ALICE, 'What is the temperature?'));
  await world.fake.sendMessage({ id: 'alice' }, { text: '21 °C', file: null });
  await world.fake.widgetGet('irc', { language: 'en', settings: {} });
  await world.tick(2 * 60 * 1000); // a ping
  assert.equal(world.fake.sceneEvents.length, 3);
  assert.equal(world.fake.messages.length, 1);
  assert.deepEqual(logs.at('info', 'warn', 'error'), []);
  assert.ok(logs.at('debug').length > 0, 'the details are at debug level');
});

test('a server down: one line when it starts, none per retry', async (t) => {
  const logs = captureLogs(t);
  const world = await createWorld();
  t.after(() => world.app.stop());
  logs.clear();
  world.server.down = ERROR_KINDS.UNREACHABLE;
  world.server.session.drop();
  for (let i = 0; i < 8; i += 1) {
    await world.wake();
  }
  const failures = logs
    .at('warn', 'error')
    .filter((line) => line.startsWith('IRC connection failed'));
  assert.equal(failures.length, 1);
  assert.equal(logs.at('warn').filter((line) => line.startsWith('IRC connection lost')).length, 1);
});

test('no log line ever holds the password', async (t) => {
  const logs = captureLogs(t);
  const world = await createWorld({ config: { ...BASE_CONFIG, password: 'wrong-password' } });
  t.after(() => world.app.stop());
  const right = await createWorld();
  t.after(() => right.app.stop());
  const all = logs.lines.map((line) => line.text).join('\n');
  assert.ok(all.length > 0);
  for (const secret of ['wrong-password', BASE_CONFIG.password]) {
    assert.equal(all.includes(secret), false, secret);
  }
});
