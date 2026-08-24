import type { AppConfig } from '../config.ts';

export interface CommitmentNotificationConfig {
  enabled: boolean;
  destinationJid?: string;
}

function parseBoolean(value: string | undefined, fallback = false): boolean {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  throw new Error(`Invalid boolean value: ${value}`);
}

function parseDestination(value: string | undefined): string | undefined {
  const jid = value?.trim().toLowerCase();
  if (!jid) return undefined;
  if (!/^\d+(?::\d+)?@(s\.whatsapp\.net|lid)$/.test(jid)) {
    throw new Error('Invalid COMMITMENT_NOTIFICATION_DESTINATION_JID');
  }
  return jid;
}

export function loadCommitmentNotificationConfig(
  appConfig: AppConfig,
  env: NodeJS.ProcessEnv = process.env,
): CommitmentNotificationConfig {
  const enabled = parseBoolean(env.COMMITMENT_NOTIFICATIONS_ENABLED, false);
  const destinationJid = parseDestination(env.COMMITMENT_NOTIFICATION_DESTINATION_JID);

  if (enabled && !appConfig.whatsapp.enabled) {
    throw new Error('WHATSAPP_ENABLED=true is required when COMMITMENT_NOTIFICATIONS_ENABLED=true');
  }
  if (enabled && !destinationJid) {
    throw new Error('COMMITMENT_NOTIFICATION_DESTINATION_JID is required when COMMITMENT_NOTIFICATIONS_ENABLED=true');
  }
  if (enabled && destinationJid && !appConfig.whatsapp.selfJids.includes(destinationJid)) {
    throw new Error('COMMITMENT_NOTIFICATION_DESTINATION_JID must be present in WHATSAPP_SELF_JIDS');
  }

  return { enabled, destinationJid };
}
