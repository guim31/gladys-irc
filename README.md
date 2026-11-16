# IRC for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com)
that connects an [IRC](https://en.wikipedia.org/wiki/IRC) bot to Gladys: talk
to Gladys from WeeChat, irssi, HexChat, The Lounge or any IRC client, receive
the messages of Gladys there, write to nicknames and channels from your
scenes, and start scenes on a message or a command such as `!lights off` in a
channel. Works with public networks (Libera.Chat, OFTC…), your own server
(Ergo, InspIRCd, UnrealIRCd…) or a bouncer (ZNC).

> **Developed without the hardware: feedback welcome.** The integration was
> tested against a real [Ergo](https://ergo.chat) 2.19 server (the
> `ghcr.io/ergochat/ergo` Docker image): TLS, SASL, channels, messages in both
> directions, long messages, server restart, wrong password. It was not tested
> inside a real Gladys nor on every network. Please report what works and what
> does not in the [issues](https://github.com/guim31/gladys-irc/issues) or on
> the [Gladys forum](https://community.gladysassistant.com).

## Features

- **Talk to Gladys** in a private conversation with the bot, like the Telegram
  bot: each Gladys user links their IRC account once with a code.
- **Allowed people** by services account (checked on the IRCv3 `account` tag
  of each message) or hostmask, never by bare nickname. Before anything
  private is sent, a WHOIS checks the nickname still belongs to that person.
- **Channels**: the bot joins them; a message of an allowed person fires
  _IRC message received_, a command (`!lights off`) fires _IRC command
  received_.
- **Scene action** _Send an IRC message_ to a nickname or a channel, with
  _Sent_ and _Error_ outputs.
- **Triggers** _IRC connection lost_ / _IRC connection restored_.
- **Widget**: connection, nickname, channels, the last messages, a test
  button (both hideable).
- TLS by default, SASL PLAIN, NickServ or server password (ZNC); reconnection
  with a growing delay; flood control (4 lines, then one every 2 s); long
  messages cut at about 400 bytes between words.
- Four languages: English, French, German, Spanish.

## Requirements

- Gladys Assistant **5.1.0** or later.
- An IRC server Gladys can reach, and a nickname registered for the bot
  (services), unless your own server has none.

## Installation

In Gladys: **Integrations → Install from GitHub**, then enter
`https://github.com/guim31/gladys-irc`. Fill in the server, the bot nickname
and password, the channels and the allowed people, click **Test the
connection**, then each user links their account. The full documentation is
in [docs/en.md](docs/en.md) (also in [French](docs/fr.md),
[German](docs/de.md) and [Spanish](docs/es.md)).

## How it works

- [`irc-framework`](https://github.com/kiwiirc/irc-framework) over TCP and
  TLS, with the IRCv3 capabilities `sasl`, `account-tag`, `server-time` and
  `batch`. Its own reconnection is replaced by a backoff in the integration,
  and a refused SASL login ends the session.
- Private messages of an allowed person are a conversation with Gladys
  (`linkContact`, `publishMessage`, `onSendMessage`). Channel messages only
  fire triggers, so Gladys never answers where others can read. History
  replayed by a bouncer and messages older than 5 minutes are ignored.

## Limits

- No end-to-end encryption: the IRC server can read the messages.
- Text only: images sent by Gladys are not forwarded; files and DCC are
  ignored.
- Channels with a key (+k) are not supported.
- One bot per Gladys and per network.

## Development

```bash
npm install
npm test            # node --test, against the fake Gladys of the SDK and a fake IRC server
npm run lint
npm run format:check
npx -y github:GladysAssistant/integration-store --skip-image-check .

# Against a real Ergo server, two registered accounts (see test/live.test.js):
IRC_LIVE_SERVER=irc.test:6697 IRC_LIVE_BOT_PASSWORD=… IRC_LIVE_ALICE_PASSWORD=… node --test test/live.test.js
```

## Credits

- [irc-framework](https://github.com/kiwiirc/irc-framework) (MIT, Kiwi IRC),
  the IRC client library.
- [Ergo](https://github.com/ergochat/ergo) (MIT), the IRC server the
  integration was tested against.
- The architecture, the `/data` store and the quiet logs come from
  [gladys-xmpp](https://github.com/guim31/gladys-xmpp) and
  [gladys-matrix](https://github.com/guim31/gladys-matrix); the tests follow
  [gladys-wled](https://github.com/guim31/gladys-wled).
- The cover is a home-made pictogram (IRC has no single official logo).

## Disclaimer

This project is not affiliated with, endorsed or sponsored by any IRC network
or by the authors of IRC software.

## License

Apache-2.0
