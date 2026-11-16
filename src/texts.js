// -----------------------------------------------------------------------------
// Texts the integration writes outside the widget (src/widgets.js): the
// connection status, the "Test the connection" report, the errors, and what
// the bot answers in IRC. Four languages, the four of the Gladys interface;
// German says "du", Spanish "usted". test/i18n.test.js checks every table.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './irc/errors.js';

export const LANGUAGE_FALLBACK = 'en';

export const pick = (text, language) => text[language] ?? text[LANGUAGE_FALLBACK];

/** Applies `render` to each language of a table of functions. */
export const each = (table, render) =>
  Object.fromEntries(Object.entries(table).map(([lang, value]) => [lang, render(value, lang)]));

/** A failed action: Gladys shows the four-language message in red. */
export class ActionFailure extends Error {
  constructor(text) {
    super(text.en);
    this.message = text;
  }
}

// One short explanation per error kind (src/irc/errors.js).
export const ERROR_TEXT = {
  [ERROR_KINDS.NOT_CONFIGURED]: {
    en: 'enter the IRC server in the configuration',
    fr: 'saisissez le serveur IRC dans la configuration',
    de: 'gib den IRC-Server in der Konfiguration ein',
    es: 'introduzca el servidor IRC en la configuración',
  },
  [ERROR_KINDS.INVALID_SERVER]: {
    en: 'server not understood, e.g. irc.libera.chat or irc.example.org:6697',
    fr: 'serveur incompris, ex. irc.libera.chat ou irc.example.org:6697',
    de: 'Server nicht verstanden, z. B. irc.libera.chat oder irc.example.org:6697',
    es: 'servidor no válido, p. ej. irc.libera.chat o irc.example.org:6697',
  },
  [ERROR_KINDS.INVALID_NICKNAME]: {
    en: 'nickname refused: letters, digits and - _ [ ] { } only',
    fr: 'pseudo refusé : lettres, chiffres et - _ [ ] { } seulement',
    de: 'Nickname abgelehnt: nur Buchstaben, Ziffern und - _ [ ] { }',
    es: 'apodo rechazado: solo letras, cifras y - _ [ ] { }',
  },
  [ERROR_KINDS.NO_PASSWORD]: {
    en: 'enter the password, or choose "No authentication"',
    fr: 'saisissez le mot de passe, ou choisissez « Aucune authentification »',
    de: 'gib das Passwort ein oder wähle „Keine Authentifizierung“',
    es: 'introduzca la contraseña o elija «Sin autenticación»',
  },
  [ERROR_KINDS.INSECURE]: {
    en: 'TLS is off: the password is never sent in clear text (or TLS on a plain port?)',
    fr: 'TLS désactivé : le mot de passe n’est jamais envoyé en clair (ou TLS sur un port en clair ?)',
    de: 'TLS ist aus: Das Passwort wird nie im Klartext gesendet (oder TLS auf einem Klartext-Port?)',
    es: 'TLS desactivado: la contraseña nunca se envía en claro (¿o TLS en un puerto sin cifrar?)',
  },
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'the IRC server does not answer',
    fr: 'le serveur IRC ne répond pas',
    de: 'der IRC-Server antwortet nicht',
    es: 'el servidor IRC no responde',
  },
  [ERROR_KINDS.TIMEOUT]: {
    en: 'the IRC server answers too slowly',
    fr: 'le serveur IRC répond trop lentement',
    de: 'der IRC-Server antwortet zu langsam',
    es: 'el servidor IRC responde demasiado lento',
  },
  [ERROR_KINDS.CERTIFICATE]: {
    en: 'certificate of the server refused (self-signed? see the option)',
    fr: 'certificat du serveur refusé (auto-signé ? voir l’option)',
    de: 'Zertifikat des Servers abgelehnt (selbstsigniert? siehe die Option)',
    es: 'certificado del servidor rechazado (¿autofirmado? vea la opción)',
  },
  [ERROR_KINDS.BAD_LOGIN]: {
    en: 'account or password refused',
    fr: 'compte ou mot de passe refusé',
    de: 'Konto oder Passwort abgelehnt',
    es: 'cuenta o contraseña rechazadas',
  },
  [ERROR_KINDS.NO_SASL]: {
    en: 'the server does not offer SASL: choose NickServ',
    fr: 'le serveur ne propose pas SASL : choisissez NickServ',
    de: 'der Server bietet kein SASL an: Wähle NickServ',
    es: 'el servidor no ofrece SASL: elija NickServ',
  },
  [ERROR_KINDS.NICKNAME_IN_USE]: {
    en: 'the nickname and its variants are taken',
    fr: 'le pseudo et ses variantes sont pris',
    de: 'der Nickname und seine Varianten sind vergeben',
    es: 'el apodo y sus variantes están ocupados',
  },
  [ERROR_KINDS.BANNED]: {
    en: 'the bot is banned from this network',
    fr: 'le robot est banni de ce réseau',
    de: 'der Bot ist in diesem Netzwerk gesperrt',
    es: 'el bot está vetado en esta red',
  },
  [ERROR_KINDS.FLOOD]: {
    en: 'too many messages waiting: try again in a minute',
    fr: 'trop de messages en attente : réessayez dans une minute',
    de: 'zu viele wartende Nachrichten: Versuch es in einer Minute erneut',
    es: 'demasiados mensajes en espera: inténtelo dentro de un minuto',
  },
  [ERROR_KINDS.INVALID_TARGET]: {
    en: 'recipient not understood: a nickname or a channel such as #home',
    fr: 'destinataire incompris : un pseudo ou un salon comme #maison',
    de: 'Empfänger nicht verstanden: ein Nickname oder ein Kanal wie #zuhause',
    es: 'destinatario no válido: un apodo o un canal como #casa',
  },
  [ERROR_KINDS.NOT_IN_CHANNEL]: {
    en: 'the bot is not in this channel: add it to the channels',
    fr: 'le robot n’est pas dans ce salon : ajoutez-le aux salons',
    de: 'der Bot ist nicht in diesem Kanal: Füg ihn zu den Kanälen hinzu',
    es: 'el bot no está en este canal: añádalo a los canales',
  },
  [ERROR_KINDS.NOT_ONLINE]: {
    en: 'this person is not on IRC, or not identified',
    fr: 'cette personne n’est pas sur IRC, ou pas identifiée',
    de: 'diese Person ist nicht im IRC oder nicht identifiziert',
    es: 'esta persona no está en IRC o no está identificada',
  },
  [ERROR_KINDS.SERVER]: {
    en: 'the IRC server answered with an error',
    fr: 'le serveur IRC a répondu par une erreur',
    de: 'der IRC-Server hat mit einem Fehler geantwortet',
    es: 'el servidor IRC ha respondido con un error',
  },
};

/** The explanation of an error, in one language. */
export function errorText(err, language) {
  const text = ERROR_TEXT[err?.kind] ?? ERROR_TEXT[ERROR_KINDS.SERVER];
  return pick(text, language);
}

/** The explanation of an error, in the four languages. */
export const errorTexts = (err) =>
  each(ERROR_TEXT[err?.kind] ?? ERROR_TEXT[ERROR_KINDS.SERVER], (text) => text);

// The connection status of the Configuration screen when something is only
// half right (the bot works, but...).
export const STATUS_TEXT = {
  en: {
    channels: (failed) => `Connected, but these channels could not be joined: ${failed}.`,
    notIdentified: 'Connected, but NickServ did not confirm the identification.',
  },
  fr: {
    channels: (failed) => `Connecté, mais ces salons n’ont pas pu être rejoints : ${failed}.`,
    notIdentified: 'Connecté, mais NickServ n’a pas confirmé l’identification.',
  },
  de: {
    channels: (failed) => `Verbunden, aber diese Kanäle konnten nicht betreten werden: ${failed}.`,
    notIdentified: 'Verbunden, aber NickServ hat die Identifizierung nicht bestätigt.',
  },
  es: {
    channels: (failed) => `Conectado, pero no se ha podido entrar en estos canales: ${failed}.`,
    notIdentified: 'Conectado, pero NickServ no ha confirmado la identificación.',
  },
};

// The report of the "Test the connection" action (and of the widget button).
export const REPORT_TEXT = {
  en: {
    connected: (nick, server) => `Connected to ${server} as ${nick}.`,
    channels: (joined, total) => `Channels joined: ${joined}/${total}.`,
    noChannels: 'No channel.',
    users: (count) => `Allowed people: ${count}.`,
    noUsers: 'No allowed person: the bot answers nobody.',
    failed: (error) => `Connection failed: ${error}.`,
  },
  fr: {
    connected: (nick, server) => `Connecté à ${server} en tant que ${nick}.`,
    channels: (joined, total) => `Salons rejoints : ${joined}/${total}.`,
    noChannels: 'Aucun salon.',
    users: (count) => `Personnes autorisées : ${count}.`,
    noUsers: 'Aucune personne autorisée : le robot ne répond à personne.',
    failed: (error) => `Échec de la connexion : ${error}.`,
  },
  de: {
    connected: (nick, server) => `Verbunden mit ${server} als ${nick}.`,
    channels: (joined, total) => `Betretene Kanäle: ${joined}/${total}.`,
    noChannels: 'Kein Kanal.',
    users: (count) => `Erlaubte Personen: ${count}.`,
    noUsers: 'Keine erlaubte Person: Der Bot antwortet niemandem.',
    failed: (error) => `Verbindung fehlgeschlagen: ${error}.`,
  },
  es: {
    connected: (nick, server) => `Conectado a ${server} como ${nick}.`,
    channels: (joined, total) => `Canales en los que ha entrado: ${joined}/${total}.`,
    noChannels: 'Ningún canal.',
    users: (count) => `Personas autorizadas: ${count}.`,
    noUsers: 'Ninguna persona autorizada: el bot no responde a nadie.',
    failed: (error) => `Fallo de conexión: ${error}.`,
  },
};

// What the bot writes in IRC, in a private conversation.
export const BOT_TEXT = {
  en: {
    linked: (name) => `Hello ${name}! You are now linked to Gladys: write to me here.`,
    notLinked:
      'You are not linked to Gladys yet. In Gladys, open Integrations → IRC → Configuration, click "Generate a link code", then send me the code here.',
    unavailable: 'Gladys cannot read your message right now, please try again later.',
  },
  fr: {
    linked: (name) => `Bonjour ${name} ! Vous êtes lié à Gladys : écrivez-moi ici.`,
    notLinked:
      'Vous n’êtes pas encore lié à Gladys. Dans Gladys, ouvrez Intégrations → IRC → Configuration, cliquez sur « Générer un code de liaison », puis envoyez-moi le code ici.',
    unavailable: 'Gladys ne peut pas lire votre message pour l’instant, réessayez plus tard.',
  },
  de: {
    linked: (name) => `Hallo ${name}! Du bist jetzt mit Gladys verknüpft: Schreib mir hier.`,
    notLinked:
      'Du bist noch nicht mit Gladys verknüpft. Öffne in Gladys Integrationen → IRC → Konfiguration, klicke auf „Verknüpfungscode generieren“ und schick mir dann den Code hier.',
    unavailable: 'Gladys kann deine Nachricht gerade nicht lesen, versuch es später noch einmal.',
  },
  es: {
    linked: (name) => `¡Hola ${name}! Ahora está vinculado a Gladys: escríbame aquí.`,
    notLinked:
      'Aún no está vinculado a Gladys. En Gladys, abra Integraciones → IRC → Configuración, pulse «Generar un código de vinculación» y envíeme el código aquí.',
    unavailable: 'Gladys no puede leer su mensaje en este momento, inténtelo más tarde.',
  },
};
