# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration keeps and where:

- The configuration (server, nickname, account, password, channels, allowed
  people) is stored by Gladys; the password is a `secret` field.
- `/data/irc-state.json` holds the last 5 channel messages of allowed people
  (for the widget) and the last nickname seen for each allowed person. No
  message of a private conversation is stored.
- The integration only talks to the IRC server (TCP, TLS on 6697 by default)
  and to Gladys. It sends a password only over TLS, verifies the certificate
  of the server unless the user accepted a self-signed one, and never logs the
  password.

The bot passes the messages of a linked person to Gladys with the authority of
that Gladys user, and only for the allowed list: a person is recognized by the
services account the server reports on each message (IRCv3 `account-tag`) or
by a hostmask, never by a bare nickname. Before a private answer, a WHOIS
checks that the nickname still belongs to that person. Messages are not
end-to-end encrypted: the IRC server and its operators can read them.

Known limits, by design: the "Accept a self-signed certificate" option turns
off the verification of the server entirely, so it is meant for a server on
the local network only. The identity of a person rests on the IRC server and
its services: an untrusted server could announce false accounts or hosts, and
a hostmask is only as strong as the host it names.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
and the third-party services the integration talks to (the IRC server, its
services and the IRC clients).
