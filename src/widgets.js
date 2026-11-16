// -----------------------------------------------------------------------------
// Dashboard widget "IRC" (manifest `widgets`, key `irc`): is the bot
// connected, under which nickname, how many channels it is in, the last
// messages of allowed people in the channels (with their date), and a button
// testing the connection. The messages and the button can be hidden
// (settings `show_messages`, `show_test_button`).
//
// Budget of the core: 8 components, 1 focal, 2 texts, 1 status, 4 buttons.
// Here: 1 status, 1 card-list (or 1 caption when empty), 1 button.
// The private conversations with Gladys are never listed: the widget is seen
// by everyone who sees the dashboard.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { pick } from './texts.js';

export const WIDGET_KEY = 'irc';
export const TEST_ACTION = 'test';
export const RECENT_SHOWN = 5;

export const CONNECTION = {
  NOT_CONFIGURED: 'not_configured',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
};

// Short texts of the widget: labels and values of status rows (≤ 40), button
// (≤ 24), caption (≤ 80).
export const TEXT = {
  connection: { en: 'IRC', fr: 'IRC', de: 'IRC', es: 'IRC' },
  connected: { en: 'Connected', fr: 'Connecté', de: 'Verbunden', es: 'Conectado' },
  disconnected: { en: 'Disconnected', fr: 'Déconnecté', de: 'Getrennt', es: 'Desconectado' },
  connecting: { en: 'Connecting…', fr: 'Connexion…', de: 'Verbinde…', es: 'Conectando…' },
  notConfigured: {
    en: 'Not configured',
    fr: 'Non configuré',
    de: 'Nicht konfiguriert',
    es: 'Sin configurar',
  },
  nickname: { en: 'Nickname', fr: 'Pseudo', de: 'Nickname', es: 'Apodo' },
  channels: { en: 'Channels', fr: 'Salons', de: 'Kanäle', es: 'Canales' },
  empty: {
    en: 'No message received in a channel yet.',
    fr: 'Aucun message reçu dans un salon pour l’instant.',
    de: 'Noch keine Nachricht in einem Kanal erhalten.',
    es: 'Todavía no se ha recibido ningún mensaje en un canal.',
  },
  test: {
    en: 'Test the connection',
    fr: 'Tester la connexion',
    de: 'Verbindung testen',
    es: 'Probar la conexión',
  },
};

const clip = (text, max) => {
  const characters = Array.from(text);
  return characters.length > max ? `${characters.slice(0, max - 1).join('')}…` : text;
};

function connectionRow(connection, language) {
  const label = pick(TEXT.connection, language);
  switch (connection) {
    case CONNECTION.CONNECTED:
      return {
        label,
        value: pick(TEXT.connected, language),
        color: WIDGET_COLORS.SUCCESS,
        icon: 'check-circle',
      };
    case CONNECTION.DISCONNECTED:
      return {
        label,
        value: pick(TEXT.disconnected, language),
        color: WIDGET_COLORS.DANGER,
        icon: 'alert-triangle',
      };
    case CONNECTION.CONNECTING:
      return { label, value: pick(TEXT.connecting, language), color: WIDGET_COLORS.NEUTRAL };
    default:
      return { label, value: pick(TEXT.notConfigured, language), color: WIDGET_COLORS.WARNING };
  }
}

/**
 * The content of the widget.
 * @param {object} state
 * @param {string} state.connection one of CONNECTION
 * @param {string|null} state.nickname the nickname of the bot, once connected
 * @param {{ joined: number, total: number }} state.channels
 * @param {Array<{ channel: string, sender: string, text: string, at: string }>} state.recent newest first
 * @param {string} language
 * @param {object} [settings] the widget settings
 */
export function buildWidgetContent({ connection, nickname, channels, recent }, language, settings) {
  const items = [connectionRow(connection, language)];
  if (nickname) {
    items.push({
      label: pick(TEXT.nickname, language),
      value: clip(nickname, 40),
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  items.push({
    label: pick(TEXT.channels, language),
    value:
      channels.total === channels.joined ? channels.total : `${channels.joined}/${channels.total}`,
    color: channels.joined < channels.total ? WIDGET_COLORS.WARNING : WIDGET_COLORS.NEUTRAL,
  });
  const components = [{ type: 'status', items }];
  if (settings?.show_messages !== false) {
    if (recent.length > 0) {
      components.push({
        type: 'card-list',
        display: 'list',
        items: recent.slice(0, RECENT_SHOWN).map((entry) => ({
          title: clip(entry.sender, 60),
          description: clip(entry.text, 200),
          date: entry.at,
          // A badge holds 16 characters.
          badge: { text: clip(entry.channel, 16), color: WIDGET_COLORS.NEUTRAL },
        })),
      });
    } else {
      components.push({ type: 'text', variant: 'caption', text: pick(TEXT.empty, language) });
    }
  }
  if (settings?.show_test_button !== false) {
    components.push({
      type: 'button',
      label: pick(TEXT.test, language),
      icon: 'refresh-cw',
      style: 'secondary',
      action: { key: TEST_ACTION },
    });
  }
  return { ttl_seconds: 120, components };
}
