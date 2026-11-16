# IRC

Talk to Gladys from [IRC](https://en.wikipedia.org/wiki/IRC) (Libera.Chat, OFTC, your own server…), from any
IRC client (WeeChat, irssi, HexChat, The Lounge, Quassel, Goguma…), the way the Telegram bot of Gladys works:
ask a question, run a scene, receive the messages of Gladys. The integration also writes to nicknames and
channels from your scenes, and starts scenes when a message or a command such as `!lights off` is written in
a channel the bot is in.

> **Developed without the hardware: feedback welcome.** The integration was tested against a real Ergo IRC
> server (TLS, SASL, channels, reconnection), but not inside a real Gladys nor on every network. Please report
> what works and what does not in the [issues](https://github.com/guim31/gladys-irc/issues) or on the
> [Gladys forum](https://community.gladysassistant.com).

## What you need

- Gladys Assistant **5.1.0** or later.
- An IRC server Gladys can reach: a public network (Libera.Chat, OFTC…) or your own server (Ergo,
  InspIRCd, UnrealIRCd…), or a bouncer (ZNC).
- A **nickname registered for the bot** with NickServ (`/msg NickServ REGISTER <password> <email>` on most
  networks), so nobody else can take it and so the bot can log in with SASL. On your own server without
  services, no password is needed.
- The **services account** of each person allowed to talk to the bot (their registered nickname, such as
  `alice`): the bot trusts a person only when the server says they are logged in to that account. Without
  services, a **hostmask** such as `alice!*@home.example.org` works too.

## Set up

1. Register the bot nickname on your network (log in once with an IRC client under that nickname, then
   `/msg NickServ REGISTER …`; Libera.Chat asks to confirm by email).
2. In Gladys, **Integrations → IRC → Configuration**:
   - **Server**: a host name, with a port if needed: `irc.libera.chat`, `irc.example.org:6697`,
     `192.168.1.20:6667`, or `ircs://irc.oftc.net`. Without a port: 6697 with TLS, 6667 without.
   - **Encrypted connection (TLS)**: on by default; leave it on. Without TLS, no password is ever sent.
   - **Accept a self-signed certificate**: only for your own server on the local network, whose certificate
     is not signed by an authority (Ergo creates such a certificate). The connection stays encrypted, but the
     server is not verified. Off by default.
   - **Bot nickname**: `Gladys` by default. If it is taken, the bot tries `Gladys_` then `Gladys__`.
   - **Authentication**: **SASL** (most networks: Libera.Chat, OFTC, Ergo…), **NickServ** (the bot sends
     `IDENTIFY` after logging in: older networks), **Server password** (a bouncer such as ZNC, or a private
     server), or **No authentication**.
   - **Account (optional)**: the services account of the bot, when it is not its nickname. For ZNC:
     `user/network`.
   - **Password**: the password of the account (or of the server). Never written in the logs.
   - **Channels**: the channels the bot joins, such as `#home, #alerts`, separated by commas. Their messages
     start scenes.
   - **Allowed people**: the services accounts (`alice`) or hostmasks (`alice!*@home.example.org`, `*` and
     `?` allowed) the bot listens to, separated by commas. **Never a bare nickname**: anybody can take a free
     nickname. **Empty, the bot answers nobody.**
   - **Command prefix**: `!` by default.
   - **Language of the bot**: the language of what the bot writes before a person is linked.
3. Click **Test the connection**: the report gives the server and the nickname of the bot, the channels it
   joined and the number of allowed people. The connection status of the page says it too.

### Link your IRC account to talk to Gladys

Each Gladys user who wants to talk to Gladys from IRC does it once:

1. Log in to your account on the network (SASL or NickServ, as usual), so the bot can recognize you.
2. In Gladys, **Integrations → IRC → Configuration**, block "Link my account": click **Generate a link
   code**.
3. Send the code (8 characters) to the bot in a private message: `/msg Gladys ABCD2345`. The bot confirms:
   your account is linked to your Gladys user. You can unlink it from the same block.

## What the bot does

- **In a private conversation** (`/msg Gladys …` or `/query Gladys`): it passes your messages to Gladys,
  with the authority of the linked Gladys user, exactly like the Telegram bot: "What is the temperature in
  the living room?", "Turn off the lights". The answers of Gladys come back there, and so do the messages
  Gladys sends to you (the **Send Message** scene action, the system messages).
- **Who gets an answer**: the bot writes to the nickname it last saw you under, and first checks with a
  WHOIS that this nickname is still you (your account, or your hostmask). If you are not connected, or the
  nickname now belongs to someone else, nothing private is sent.
- **In a channel**: every message of an allowed person starts the **IRC message received** trigger, and a
  message starting with the prefix also starts **IRC command received**. The bot never answers there by
  itself, where others can read: what happens is up to your scenes.
- **What it ignores**: everyone who is not an allowed person, its own messages, the history replayed by a
  bouncer, the messages older than 5 minutes when it receives them (a "!open garage" from two hours ago does
  not run now), and the channels it was forced into (it leaves them).
- **Long messages**: an IRC line holds about 400 bytes; a longer message is cut between words, and each line
  break of the text starts a new line, 10 lines at most. To avoid being kicked for flooding, the bot sends 4
  lines at once, then one line every 2 seconds.
- **Connection**: when it drops, the bot reconnects by itself (after 2, 5, 10, 30 then 60 seconds) and joins
  its channels again. A channel that was full or did not answer is tried again every 2 minutes; after a kick,
  the bot stays out until the next restart or configuration change.

## Dashboard

The **IRC** widget shows whether the bot is connected, its nickname, the channels it is in, the last 5
messages of allowed people in the channels (nickname, text, date) and a **Test the connection** button. Two
settings hide the messages and the button. The private conversations with Gladys are never shown: everyone
who sees the dashboard sees the widget.

## Scenes

### Triggers

- **IRC message received**: an allowed person wrote in a channel of the bot. Filters (empty = any):
  **Channel** (`#home`) and **Sender** (the account or hostmask as written in the allowed people, `alice`).
  Variables: Message, Sender, Nickname, Channel.
- **IRC command received**: an allowed person wrote a command in a channel: the prefix, then a word, then
  optional arguments, for example `!lights off kitchen`. Filter **Command**: the word **without the prefix,
  in lower case** (`lights`); and Channel, Sender. Variables: Command (`lights`), Arguments (`off kitchen`),
  Message, Sender, Nickname, Channel. The same message also starts **IRC message received**.
- **IRC connection lost**: the bot cannot reach the server any more, for a minute, or its password or the
  certificate of the server are refused. Variable: Error. Started once, until the connection comes back.
- **IRC connection restored**: the bot reaches the server again after a lost connection. Variable: Bot
  nickname.

### Actions

- **Send an IRC message**: writes a message to a nickname (`alice`) or in a channel the bot is in (`#home`).
  The message accepts the scene variables. Results: Sent (yes/no), Error. A failed message does not stop the
  scene: test **Sent** with a condition if needed.

To write to one Gladys user rather than to a nickname, use the **Send Message** action of Gladys: it reaches
their linked IRC account, after the WHOIS check.

### Scene ideas

- **Garage by command**: trigger **IRC command received**, command `garage`, channel `#home`; then a
  condition on the variable Arguments equal to `close`, and the action that closes the garage.
- **Washing machine done**: trigger on the power of the plug, then **Send an IRC message** to `#home`: "The
  washing machine is done".
- **Alert when the bot is cut off**: trigger **IRC connection lost**, then a notification through another
  channel (Gotify, ntfy, SMS) with the Error variable.

## Troubleshooting

- **"the IRC server does not answer"**: check the host and the port. Most networks offer TLS on 6697;
  `TLS on a plain port?` means TLS was spoken to a port without it (often 6667).
- **"certificate of the server refused"**: the certificate is self-signed, expired, or does not name the host
  you typed (use the name, not the IP address, of a public network). For your own server on the local
  network, tick **Accept a self-signed certificate**.
- **"account or password refused"**: check them by logging in with an IRC client. The account is the
  registered nickname, or **Account (optional)** if it differs.
- **"the server does not offer SASL"**: choose **NickServ** in **Authentication**.
- **"the bot is banned from this network"**: some networks refuse connections from some hosting providers or
  need SASL from such addresses; see the rules of the network.
- **A channel is not joined**: the status of the page and the test name it, with the reason (invite only,
  banned, key needed, full). Channels with a key (+k) are not supported: invite the bot or add it to the
  access list of the channel.
- **The bot does not answer me**: are you logged in to your account (`/whois yournick` shows "is logged in
  as")? Is your account in **Allowed people**, written exactly? Is it linked (the bot then gives you the
  instructions)?
- **A channel message does not start the scene**: the server must tell the bot who is logged in (the IRCv3
  `account-tag` capability: Libera.Chat, OFTC, Ergo, InspIRCd and UnrealIRCd do); otherwise use a hostmask.
  The Command filter is the word without the prefix, in lower case: `lights`, not `!Lights`.
- More details in the logs of the integration with `LOG_LEVEL=debug`.

## Limits

- **No end-to-end encryption**: messages travel encrypted between your client, the server and Gladys (TLS),
  but the IRC server and its operators can read them, as can everyone in a channel. Keep secrets out of the
  channels.
- A person linked to Gladys can do from IRC everything their Gladys user can do: keep the list of allowed
  people short, protect the accounts with strong passwords, and prefer accounts to hostmasks.
- Images sent by Gladys (camera snapshots) are not forwarded: only the text is sent. Files and DCC are
  ignored.
- One bot per Gladys and per network. Channels with a key are not supported.
- Not affiliated with any IRC network.
