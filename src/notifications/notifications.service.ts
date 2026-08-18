import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Expo's push gateway. Tokens are issued by the app via expo-notifications. */
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
/** Expo accepts at most 100 messages per request. */
const CHUNK_SIZE = 100;

export type NotificationKind = 'match' | 'message' | 'like' | 'system';

export type NotificationInput = {
  userId: string;
  type: NotificationKind;
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

/** Which preference switch governs each kind of notification. */
const PREF_KEY: Record<NotificationKind, string | null> = {
  match: 'matches',
  message: 'messages',
  like: 'likes',
  system: null,
};

type ExpoTicket = {
  status?: string;
  message?: string;
  details?: { error?: string };
};

/**
 * Writes the in-app notification row and, when the recipient has the matching
 * preference switched on, pushes it to their devices.
 *
 * Delivery is best-effort: a failure here must never roll back the match or
 * message that triggered it.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private prisma: PrismaService) {}

  async notify(input: NotificationInput) {
    return this.notifyMany([input]);
  }

  async notifyMany(inputs: NotificationInput[]) {
    if (!inputs.length) return;

    await this.prisma.notification.createMany({
      data: inputs.map((input) => ({
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body,
        data: (input.data ?? undefined) as Prisma.InputJsonValue | undefined,
      })),
    });

    // The row is what the app reads on next load; push is the nice-to-have.
    void this.push(inputs).catch((error) =>
      this.logger.warn(`Push dispatch failed: ${String(error)}`),
    );
  }

  private async push(inputs: NotificationInput[]) {
    const userIds = [...new Set(inputs.map((input) => input.userId))];
    const [users, tokens] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, notificationPrefs: true },
      }),
      this.prisma.pushToken.findMany({
        where: { userId: { in: userIds } },
        select: { token: true, userId: true },
      }),
    ]);

    const prefsByUser = new Map(
      users.map((user) => [
        user.id,
        (user.notificationPrefs ?? {}) as Record<string, unknown>,
      ]),
    );
    const tokensByUser = new Map<string, string[]>();
    for (const row of tokens) {
      tokensByUser.set(row.userId, [
        ...(tokensByUser.get(row.userId) ?? []),
        row.token,
      ]);
    }

    const messages = inputs.flatMap((input) => {
      if (!this.isAllowed(prefsByUser.get(input.userId), input.type)) return [];
      return (tokensByUser.get(input.userId) ?? []).map((token) => ({
        to: token,
        title: input.title,
        body: input.body,
        data: { type: input.type, ...(input.data ?? {}) },
        sound: 'default' as const,
      }));
    });

    for (let i = 0; i < messages.length; i += CHUNK_SIZE) {
      await this.send(messages.slice(i, i + CHUNK_SIZE));
    }
  }

  /** Defaults follow the schema: matches and messages on, likes off. */
  private isAllowed(
    prefs: Record<string, unknown> | undefined,
    type: NotificationKind,
  ): boolean {
    const key = PREF_KEY[type];
    if (!key) return true;
    const value = prefs?.[key];
    if (typeof value === 'boolean') return value;
    return key !== 'likes';
  }

  private async send(messages: { to: string }[]) {
    if (!messages.length) return;

    let payload: { data?: ExpoTicket[] };
    try {
      const response = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(messages),
      });
      if (!response.ok) {
        this.logger.warn(`Expo push returned ${response.status}`);
        return;
      }
      payload = (await response.json()) as { data?: ExpoTicket[] };
    } catch (error) {
      this.logger.warn(
        `Could not reach the Expo push service: ${String(error)}`,
      );
      return;
    }

    // A token is dropped once the device has uninstalled or reset the app;
    // keeping it around means every later send wastes a slot on it.
    const dead = (payload.data ?? []).flatMap((ticket, index) =>
      ticket?.status === 'error' &&
      ticket.details?.error === 'DeviceNotRegistered'
        ? [messages[index].to]
        : [],
    );

    if (dead.length) {
      await this.prisma.pushToken
        .deleteMany({ where: { token: { in: dead } } })
        .catch(() => undefined);
      this.logger.log(`Removed ${dead.length} unregistered push token(s)`);
    }
  }
}
