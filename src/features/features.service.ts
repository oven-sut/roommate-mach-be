import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma, Role, SwipeDecision } from '@prisma/client';
import { compare, hash } from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import {
  AppSettingsService,
  type MatchWeights,
} from '../config/app-settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StorageService } from '../storage/storage.service';
import {
  QUESTION_DEFINITIONS,
  QUESTION_KEYS,
} from './questionnaire.definitions';
import {
  compareLifestyles,
  lifestyleTags,
  parseAnswers,
  type Lifestyle,
  type StoredAnswers,
} from './scoring';
import type { DiscoverQueryDto } from './dto/discover-query.dto';
import type { ProfileDto } from './dto/profile.dto';

/** How many candidates are scored for one discover request. */
const DISCOVER_CANDIDATE_CAP = 500;
const DISCOVER_PAGE_SIZE = 30;
/** Most photos a profile can hold. */
const MAX_PHOTOS = 6;
const MESSAGE_PAGE_SIZE = 50;

@Injectable()
export class FeaturesService {
  private readonly logger = new Logger(FeaturesService.name);

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private settings: AppSettingsService,
    private notifications: NotificationsService,
  ) {}

  private async processPhotos(
    userId: string,
    photos: string[],
  ): Promise<string[]> {
    const processed: string[] = [];
    for (let i = 0; i < photos.length; i++) {
      const photo = photos[i];
      if (photo && photo.startsWith('data:')) {
        try {
          const extension = photo.split(';')[0].split('/')[1] || 'jpeg';
          const fileName = `profiles/${userId}/photo_${i}_${Date.now()}.${extension}`;
          processed.push(await this.storage.uploadFile(photo, fileName));
        } catch (error) {
          this.logger.error(
            `Failed to upload profile photo ${i} for user ${userId}`,
            error as Error,
          );
          processed.push(photo);
        }
      } else if (photo) {
        processed.push(photo);
      }
    }
    return processed.slice(0, MAX_PHOTOS);
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        displayName: true,
        email: true,
        sutId: true,
        role: true,
        discoverable: true,
        notificationPrefs: true,
        createdAt: true,
        profile: true,
        verification: true,
      },
    });

    if (!user) return null;

    return {
      ...user,
      answers: await this.getAnswers(userId),
    };
  }

  updateMe(
    userId: string,
    data: {
      displayName?: string;
      discoverable?: boolean;
      notificationPrefs?: Record<string, boolean>;
    },
  ) {
    const update: Prisma.UserUpdateInput = {};
    if (data.displayName !== undefined) update.displayName = data.displayName;
    if (data.discoverable !== undefined)
      update.discoverable = data.discoverable;
    if (data.notificationPrefs !== undefined)
      update.notificationPrefs = data.notificationPrefs;

    return this.prisma.user.update({
      where: { id: userId },
      data: update,
      select: {
        id: true,
        displayName: true,
        email: true,
        discoverable: true,
        notificationPrefs: true,
      },
    });
  }

  async profile(userId: string, data: ProfileDto) {
    const photos = await this.processPhotos(userId, data.photos ?? []);
    const clean = {
      age: data.age,
      major: data.major,
      gender: data.gender,
      bio: data.bio,
      year: data.year,
      roomType: data.roomType,
      propertyType: data.propertyType,
      roommateGender: data.roommateGender,
      zone: data.zone,
      budgetMin: data.budgetMin,
      budgetMax: data.budgetMax,
      photos,
      completed: Boolean(data.completed),
    };

    const profile = await this.prisma.profile.upsert({
      where: { userId },
      create: { userId, ...clean },
      update: clean,
    });

    if (data.displayName) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { displayName: data.displayName },
      });
    }

    return profile;
  }

  /**
   * The question rows plus this user's saved selections. The app reads
   * `answers` to reopen the questionnaire on the user's previous choices.
   */
  async getQuestionnaire(userId: string) {
    const rows = await this.prisma.answer.findMany({
      where: { userId },
      select: { questionId: true, selections: true, updatedAt: true },
    });

    const answers: StoredAnswers = {};
    for (const row of rows) {
      answers[row.questionId] = (
        Array.isArray(row.selections) ? row.selections : []
      ) as string[][];
    }

    const updatedAt = rows.length
      ? new Date(
          Math.max(...rows.map((row) => row.updatedAt.getTime())),
        ).toISOString()
      : null;

    return { questions: QUESTION_DEFINITIONS, answers, updatedAt };
  }

  async questionnaire(
    userId: string,
    answers: Record<string, unknown>,
    completed = true,
  ) {
    await this.ensureQuestionsSeeded();

    const selectionsFor = (key: string) =>
      (Array.isArray(answers?.[key])
        ? answers[key]
        : []) as Prisma.InputJsonValue;

    await this.prisma.$transaction(
      QUESTION_DEFINITIONS.map((question) =>
        this.prisma.answer.upsert({
          where: { userId_questionId: { userId, questionId: question.id } },
          create: {
            userId,
            questionId: question.id,
            selections: selectionsFor(question.key),
          },
          update: { selections: selectionsFor(question.key) },
        }),
      ),
    );

    if (completed)
      await this.prisma.profile.upsert({
        where: { userId },
        create: { userId, completed: true },
        update: { completed: true },
      });
    return { success: true };
  }

  async verification(userId: string, documentUrl: string) {
    let finalUrl = documentUrl;
    if (documentUrl && documentUrl.startsWith('data:')) {
      try {
        const extension = documentUrl.split(';')[0].split('/')[1] || 'jpeg';
        const fileName = `verifications/${userId}/document_${Date.now()}.${extension}`;
        finalUrl = await this.storage.uploadFile(documentUrl, fileName);
      } catch (error) {
        this.logger.error(
          `Failed to upload verification document for user ${userId}`,
          error as Error,
        );
        throw new ServiceUnavailableException(
          'Document storage is temporarily unavailable. Please try again later.',
        );
      }
    }
    return this.prisma.verification.upsert({
      where: { userId },
      create: { userId, documentUrl: finalUrl },
      update: { documentUrl: finalUrl, status: 'PENDING', note: null },
    });
  }

  /** Ids this user must never be shown: blocks in either direction. */
  private async blockedIds(userId: string): Promise<Set<string>> {
    const blocks = await this.prisma.block.findMany({
      where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
      select: { blockerId: true, blockedId: true },
    });
    return new Set(
      blocks.map((row) =>
        row.blockerId === userId ? row.blockedId : row.blockerId,
      ),
    );
  }

  async discover(userId: string, query: DiscoverQueryDto = {}) {
    const page = Math.max(1, query.page ?? 1);
    const offset = (page - 1) * DISCOVER_PAGE_SIZE;

    const viewer = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { profile: { select: { year: true } } },
    });

    const [blocked, swiped, weights] = await Promise.all([
      this.blockedIds(userId),
      this.prisma.swipe.findMany({
        where: { fromId: userId },
        select: { toId: true },
      }),
      this.settings.matchWeights(),
    ]);

    const excludedIds = [userId, ...swiped.map((row) => row.toId), ...blocked];

    const profileFilters: Prisma.ProfileWhereInput = { completed: true };
    if (query.major) profileFilters.major = query.major;

    // Budget windows are ranges on both sides: keep anyone whose range
    // overlaps the requested one, rather than requiring containment.
    if (query.budgetMin != null)
      profileFilters.budgetMax = { gte: query.budgetMin };
    if (query.budgetMax != null)
      profileFilters.budgetMin = { lte: query.budgetMax };

    const viewerYear = viewer?.profile?.year ?? null;
    if (query.yearBand && query.yearBand !== 'everyone' && viewerYear != null) {
      if (query.yearBand === 'under') profileFilters.year = { lt: viewerYear };
      else if (query.yearBand === 'peer') profileFilters.year = viewerYear;
      else if (query.yearBand === 'upper')
        profileFilters.year = { gt: viewerYear };
    }

    const candidates = await this.prisma.user.findMany({
      where: {
        id: { notIn: excludedIds },
        role: 'USER',
        suspended: false,
        discoverable: true,
        profile: { is: profileFilters },
      },
      select: {
        id: true,
        displayName: true,
        createdAt: true,
        profile: true,
        verification: { select: { status: true } },
        answers: { select: { questionId: true, selections: true } },
      },
      // Newest first is a stable, index-friendly order to cap on; the cap only
      // bounds how many are scored, the sort below still ranks by fit.
      orderBy: { createdAt: 'desc' },
      take: DISCOVER_CANDIDATE_CAP,
    });

    const mine = parseAnswers(await this.answersFor(userId));

    const mustMatch = query.mustMatch
      ? query.mustMatch
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean)
      : [];

    const scored = candidates.map((candidate) => {
      const theirs = parseAnswers(this.toStoredAnswers(candidate.answers));
      const { score, breakdown } = compareLifestyles(mine, theirs, weights);
      const { answers, ...rest } = candidate;
      void answers; // scored above; not part of the card payload
      return {
        ...rest,
        score,
        breakdown,
        tags: lifestyleTags(theirs),
        lifestyle: theirs,
      };
    });

    const filtered = scored.filter((candidate) => {
      if (
        query.minScore != null &&
        candidate.score != null &&
        candidate.score < query.minScore
      ) {
        return false;
      }
      return mustMatch.every((key) =>
        this.satisfiesMustMatch(
          key,
          mine,
          candidate.lifestyle,
          candidate.breakdown,
        ),
      );
    });

    return filtered
      .sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
      .slice(offset, offset + DISCOVER_PAGE_SIZE)
      .map(({ lifestyle, ...person }) => {
        void lifestyle; // only needed while filtering
        return person;
      });
  }

  /**
   * "Must match on" chips are a stricter floor on one category: the pair has
   * to agree on it clearly, not just on balance across everything else.
   */
  private satisfiesMustMatch(
    key: string,
    mine: Lifestyle,
    theirs: Lifestyle,
    breakdown: {
      sleep?: number;
      cleanliness?: number;
      guests?: number;
      temperature?: number;
    },
  ): boolean {
    const STRONG = 70;
    switch (key) {
      case 'sleep':
        return (breakdown.sleep ?? 0) >= STRONG;
      case 'cleanliness':
        return (breakdown.cleanliness ?? 0) >= STRONG;
      case 'guests':
        return (breakdown.guests ?? 0) >= STRONG;
      // `acTemp` is the value the app's filter chip sends (see MUST_MATCH in
      // discovery.content.ts); the other two are accepted as aliases.
      case 'acTemp':
      case 'temperature':
      case 'ac':
        return (breakdown.temperature ?? 0) >= STRONG;
      case 'study':
        return (
          mine.studyPlace == null ||
          theirs.studyPlace == null ||
          mine.studyPlace === theirs.studyPlace
        );
      case 'quiet':
        return (
          mine.quiet == null ||
          theirs.quiet == null ||
          Math.abs(mine.quiet - theirs.quiet) <= 2
        );
      default:
        // An unknown chip must not silently empty the deck.
        return true;
    }
  }

  private toStoredAnswers(
    rows: { questionId: string; selections: Prisma.JsonValue }[],
  ): StoredAnswers {
    const stored: StoredAnswers = {};
    for (const row of rows) {
      stored[row.questionId] = (
        Array.isArray(row.selections) ? row.selections : []
      ) as string[][];
    }
    return stored;
  }

  private async answersFor(userId: string): Promise<StoredAnswers> {
    const rows = await this.prisma.answer.findMany({
      where: { userId },
      select: { questionId: true, selections: true },
    });
    return this.toStoredAnswers(rows);
  }

  /** Compatibility between two specific students, used by the profile screen. */
  private async scoreBetween(viewerId: string, otherId: string) {
    const [mine, theirs, weights] = await Promise.all([
      this.answersFor(viewerId),
      this.answersFor(otherId),
      this.settings.matchWeights(),
    ]);
    return compareLifestyles(parseAnswers(mine), parseAnswers(theirs), weights);
  }

  /** A single student's public profile, as seen by `viewerId`. */
  async userProfile(viewerId: string, targetId: string) {
    if (targetId === viewerId) return this.me(viewerId);

    const blocked = await this.blockedIds(viewerId);
    if (blocked.has(targetId)) throw new NotFoundException('User not found');

    const user = await this.prisma.user.findFirst({
      where: { id: targetId, suspended: false },
      select: {
        id: true,
        displayName: true,
        createdAt: true,
        profile: true,
        verification: { select: { status: true } },
      },
    });
    if (!user) throw new NotFoundException('User not found');

    const [{ score, breakdown }, match, conversation, theirAnswers] =
      await Promise.all([
        this.scoreBetween(viewerId, targetId),
        this.prisma.match.findFirst({
          where: {
            status: 'ACTIVE',
            OR: [
              { userAId: viewerId, userBId: targetId },
              { userAId: targetId, userBId: viewerId },
            ],
          },
          select: { id: true, createdAt: true },
        }),
        this.prisma.conversation.findFirst({
          where: {
            OR: [
              { userAId: viewerId, userBId: targetId },
              { userAId: targetId, userBId: viewerId },
            ],
          },
          select: { id: true },
        }),
        this.answersFor(targetId),
      ]);

    return {
      ...user,
      score,
      breakdown,
      tags: lifestyleTags(parseAnswers(theirAnswers)),
      matchId: match?.id ?? null,
      matchedAt: match?.createdAt ?? null,
      conversationId: conversation?.id ?? null,
    };
  }

  async swipe(fromId: string, toId: string, decision: SwipeDecision) {
    if (fromId === toId) throw new BadRequestException('Cannot swipe yourself');

    const target = await this.prisma.user.findUnique({
      where: { id: toId },
      select: { id: true, displayName: true, suspended: true },
    });
    if (!target || target.suspended)
      throw new NotFoundException('User not found');

    const blocked = await this.blockedIds(fromId);
    if (blocked.has(toId))
      throw new ForbiddenException('This user is unavailable');

    await this.prisma.swipe.upsert({
      where: { fromId_toId: { fromId, toId } },
      create: { fromId, toId, decision },
      update: { decision },
    });
    if (decision === 'PASS') return { matched: false };

    const me = await this.prisma.user.findUnique({
      where: { id: fromId },
      select: { displayName: true },
    });

    const other = await this.prisma.swipe.findFirst({
      where: { fromId: toId, toId: fromId, decision: 'LIKE' },
    });

    if (!other) {
      await this.notifications.notify({
        userId: toId,
        type: 'like',
        title: 'Someone likes you',
        body: `${me?.displayName ?? 'A student'} liked your profile.`,
        data: { userId: fromId },
      });
      return { matched: false };
    }

    const [userAId, userBId] = [fromId, toId].sort();
    const { score } = await this.scoreBetween(fromId, toId);
    const match = await this.prisma.match.upsert({
      where: { userAId_userBId: { userAId, userBId } },
      create: { userAId, userBId, score: score ?? 0 },
      update: { status: 'ACTIVE', score: score ?? 0 },
    });
    const conversation = await this.prisma.conversation.upsert({
      where: { userAId_userBId: { userAId, userBId } },
      create: { userAId, userBId },
      update: {},
    });

    await this.notifications.notifyMany([
      {
        userId: fromId,
        type: 'match',
        title: "It's a Match!",
        body: `You and ${target.displayName} liked each other. Say hello.`,
        data: {
          matchId: match.id,
          conversationId: conversation.id,
          userId: toId,
        },
      },
      {
        userId: toId,
        type: 'match',
        title: "It's a Match!",
        body: `You and ${me?.displayName ?? 'a student'} liked each other. Say hello.`,
        data: {
          matchId: match.id,
          conversationId: conversation.id,
          userId: fromId,
        },
      },
    ]);

    return {
      matched: true,
      match: { ...match, conversationId: conversation.id },
      conversationId: conversation.id,
    };
  }

  async matches(userId: string) {
    const blocked = await this.blockedIds(userId);
    const matches = await this.prisma.match.findMany({
      where: {
        status: 'ACTIVE',
        OR: [{ userAId: userId }, { userBId: userId }],
      },
      include: {
        userA: { select: { id: true, displayName: true, profile: true } },
        userB: { select: { id: true, displayName: true, profile: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const visible = matches.filter((match) => {
      const otherId = match.userAId === userId ? match.userBId : match.userAId;
      return !blocked.has(otherId);
    });

    const conversations = await this.prisma.conversation.findMany({
      where: { OR: [{ userAId: userId }, { userBId: userId }] },
      select: { id: true, userAId: true, userBId: true },
    });
    const conversationByOther = new Map(
      conversations.map((conversation) => [
        conversation.userAId === userId
          ? conversation.userBId
          : conversation.userAId,
        conversation.id,
      ]),
    );

    return visible.map((match) => {
      const other = match.userAId === userId ? match.userB : match.userA;
      return {
        ...match,
        other,
        conversationId: conversationByOther.get(other.id) ?? null,
      };
    });
  }

  /**
   * People who liked this user and are still waiting for an answer — i.e. the
   * user has not swiped them back yet, in either direction.
   */
  async likes(userId: string) {
    const blocked = await this.blockedIds(userId);
    const rows = await this.prisma.swipe.findMany({
      where: {
        toId: userId,
        decision: 'LIKE',
        from: {
          suspended: false,
          // No swipe from *me* back to them.
          receivedSwipes: { none: { fromId: userId } },
        },
      },
      include: {
        from: { select: { id: true, displayName: true, profile: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.filter((row) => !blocked.has(row.fromId));
  }

  async conversations(userId: string) {
    const blocked = await this.blockedIds(userId);
    const rows = await this.prisma.conversation.findMany({
      where: { OR: [{ userAId: userId }, { userBId: userId }] },
      include: {
        userA: { select: { id: true, displayName: true, profile: true } },
        userB: { select: { id: true, displayName: true, profile: true } },
        messages: { take: 1, orderBy: { createdAt: 'desc' } },
        _count: {
          select: {
            messages: { where: { senderId: { not: userId }, readAt: null } },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    return rows
      .map((conversation) => ({
        ...conversation,
        other:
          conversation.userAId === userId
            ? conversation.userB
            : conversation.userA,
        unread: conversation._count.messages,
      }))
      .filter((conversation) => !blocked.has(conversation.other.id));
  }

  /** Finds or creates the thread for a match, by match id or by the other user. */
  async createConversation(
    userId: string,
    input: { matchId?: string; userId?: string },
  ) {
    let otherId = input.userId;

    if (!otherId && input.matchId) {
      const match = await this.prisma.match.findFirst({
        where: {
          id: input.matchId,
          OR: [{ userAId: userId }, { userBId: userId }],
        },
      });
      if (!match) throw new NotFoundException('Match not found');
      otherId = match.userAId === userId ? match.userBId : match.userAId;
    }

    if (!otherId)
      throw new BadRequestException('matchId or userId is required');
    if (otherId === userId)
      throw new BadRequestException('Cannot open a conversation with yourself');

    const blocked = await this.blockedIds(userId);
    if (blocked.has(otherId))
      throw new ForbiddenException('This user is unavailable');

    const match = await this.prisma.match.findFirst({
      where: {
        status: 'ACTIVE',
        OR: [
          { userAId: userId, userBId: otherId },
          { userAId: otherId, userBId: userId },
        ],
      },
      select: { id: true },
    });
    if (!match)
      throw new ForbiddenException(
        'You can only message people you matched with',
      );

    const [userAId, userBId] = [userId, otherId].sort();
    const conversation = await this.prisma.conversation.upsert({
      where: { userAId_userBId: { userAId, userBId } },
      create: { userAId, userBId },
      update: {},
      include: {
        userA: { select: { id: true, displayName: true, profile: true } },
        userB: { select: { id: true, displayName: true, profile: true } },
      },
    });

    return {
      ...conversation,
      other:
        conversation.userAId === userId
          ? conversation.userB
          : conversation.userA,
    };
  }

  /** Throws unless the conversation exists, belongs to the user and is open. */
  private async assertConversationOpen(userId: string, conversationId: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        id: conversationId,
        OR: [{ userAId: userId }, { userBId: userId }],
      },
    });
    if (!conversation) throw new ForbiddenException();

    const otherId =
      conversation.userAId === userId
        ? conversation.userBId
        : conversation.userAId;

    const blocked = await this.blockedIds(userId);
    if (blocked.has(otherId))
      throw new ForbiddenException('This conversation is no longer available');

    return { conversation, otherId };
  }

  /**
   * Oldest-first page of a thread. `before` takes an ISO timestamp and walks
   * backwards through history, which is what the chat view scrolls into.
   */
  async messages(
    userId: string,
    conversationId: string,
    options: { limit?: number; before?: string } = {},
  ) {
    await this.assertConversationOpen(userId, conversationId);
    const take = Math.min(Math.max(options.limit ?? MESSAGE_PAGE_SIZE, 1), 100);

    const rows = await this.prisma.message.findMany({
      where: {
        conversationId,
        ...(options.before
          ? { createdAt: { lt: new Date(options.before) } }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take,
    });

    return rows.reverse();
  }

  /** Marks everything the other person sent as read. */
  async markConversationRead(userId: string, conversationId: string) {
    await this.assertConversationOpen(userId, conversationId);
    const result = await this.prisma.message.updateMany({
      where: { conversationId, senderId: { not: userId }, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }

  async send(userId: string, conversationId: string, text: string) {
    if (!text?.trim()) throw new BadRequestException('Message is empty');
    const { otherId } = await this.assertConversationOpen(
      userId,
      conversationId,
    );

    const body = text.trim().slice(0, 2000);
    const message = await this.prisma.message.create({
      data: { conversationId, senderId: userId, text: body },
    });
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });

    const sender = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { displayName: true },
    });

    await this.notifications.notify({
      userId: otherId,
      type: 'message',
      title: sender?.displayName ?? 'New message',
      body: body.slice(0, 100),
      data: { conversationId },
    });

    return message;
  }

  listNotifications(userId: string) {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  readNotification(userId: string, id: string) {
    return this.prisma.notification.updateMany({
      where: { id, userId },
      data: { readAt: new Date() },
    });
  }

  readAllNotifications(userId: string) {
    return this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
  }

  async report(
    reporterId: string,
    reportedId: string,
    reason: string,
    details?: string,
  ) {
    if (reporterId === reportedId)
      throw new BadRequestException('You cannot report yourself');

    const reported = await this.prisma.user.findUnique({
      where: { id: reportedId },
      select: { id: true },
    });
    if (!reported) throw new NotFoundException('User not found');

    const open = await this.prisma.report.findFirst({
      where: { reporterId, reportedId, status: 'PENDING' },
    });
    // A second report before the first is reviewed adds nothing.
    if (open) return open;

    return this.prisma.report.create({
      data: { reporterId, reportedId, reason, details },
    });
  }

  /**
   * Blocking is also an unmatch: the pair stop appearing to each other in
   * discover, matches and the inbox.
   */
  async block(blockerId: string, blockedId: string) {
    if (blockerId === blockedId)
      throw new BadRequestException('You cannot block yourself');

    const target = await this.prisma.user.findUnique({
      where: { id: blockedId },
      select: { id: true },
    });
    if (!target) throw new NotFoundException('User not found');

    const block = await this.prisma.block.upsert({
      where: { blockerId_blockedId: { blockerId, blockedId } },
      create: { blockerId, blockedId },
      update: {},
    });

    await this.prisma.match.updateMany({
      where: {
        OR: [
          { userAId: blockerId, userBId: blockedId },
          { userAId: blockedId, userBId: blockerId },
        ],
      },
      data: { status: 'UNMATCHED' },
    });

    return block;
  }

  unblock(blockerId: string, blockedId: string) {
    return this.prisma.block.deleteMany({ where: { blockerId, blockedId } });
  }

  async getBlockedUsers(userId: string) {
    const blocks = await this.prisma.block.findMany({
      where: { blockerId: userId },
      include: {
        blocked: {
          select: { id: true, displayName: true, email: true, profile: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return blocks.map((block) => ({
      ...block.blocked,
      blockedAt: block.createdAt,
    }));
  }

  async uploadAvatar(userId: string, avatarData: string) {
    if (!avatarData) throw new BadRequestException('Avatar data is required');
    if (!/^data:image\/(jpeg|jpg|png|webp|gif);base64,/.test(avatarData)) {
      throw new BadRequestException(
        'Avatar must be a base64 image (jpeg, png, webp or gif)',
      );
    }
    const extension = avatarData.includes(';')
      ? avatarData.split(';')[0].split('/')[1] || 'jpeg'
      : 'jpeg';
    const fileName = `avatars/${userId}/avatar_${Date.now()}.${extension}`;
    let url: string;
    try {
      url = await this.storage.uploadFile(avatarData, fileName);
    } catch (error) {
      this.logger.error(
        `Failed to upload avatar for user ${userId}`,
        error as Error,
      );
      throw new ServiceUnavailableException(
        'Avatar storage is temporarily unavailable. Please try again later.',
      );
    }

    const profile = await this.prisma.profile.findUnique({ where: { userId } });
    const currentPhotos = profile?.photos ?? [];
    const updatedPhotos = [
      url,
      ...currentPhotos.filter((photo) => photo !== url),
    ].slice(0, MAX_PHOTOS);

    await this.prisma.profile.upsert({
      where: { userId },
      create: { userId, photos: updatedPhotos },
      update: { photos: updatedPhotos },
    });

    return { url, photos: updatedPhotos };
  }

  async searchUsers(currentUserId: string, query?: string) {
    const q = query?.trim() ?? '';
    const users = await this.prisma.user.findMany({
      where: {
        id: { not: currentUserId },
        role: 'USER',
        suspended: false,
        ...(q
          ? {
              OR: [
                { displayName: { contains: q, mode: 'insensitive' } },
                { email: { contains: q, mode: 'insensitive' } },
                {
                  profile: {
                    is: { major: { contains: q, mode: 'insensitive' } },
                  },
                },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        displayName: true,
        email: true,
        profile: true,
        verification: { select: { status: true } },
        createdAt: true,
      },
      take: 50,
    });

    const blocks = await this.prisma.block.findMany({
      where: { blockerId: currentUserId },
      select: { blockedId: true },
    });
    const blockedSet = new Set(blocks.map((block) => block.blockedId));

    return users.map((user) => ({
      ...user,
      isBlocked: blockedSet.has(user.id),
    }));
  }

  async unmatch(userId: string, matchId: string) {
    return this.prisma.match.updateMany({
      where: { id: matchId, OR: [{ userAId: userId }, { userBId: userId }] },
      data: { status: 'UNMATCHED' },
    });
  }

  async unmatchUser(userId: string, otherId: string) {
    return this.prisma.match.updateMany({
      where: {
        status: 'ACTIVE',
        OR: [
          { userAId: userId, userBId: otherId },
          { userAId: otherId, userBId: userId },
        ],
      },
      data: { status: 'UNMATCHED' },
    });
  }

  async changePassword(
    userId: string,
    password: string,
    currentPassword?: string,
  ) {
    if (password.length < 8)
      throw new BadRequestException('Password must be at least 8 characters');

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true },
    });
    if (!user) throw new NotFoundException('User not found');

    // Google-only accounts have no password yet, so there is nothing to prove.
    if (user.passwordHash) {
      if (!currentPassword)
        throw new BadRequestException('Current password is required');
      if (!(await compare(currentPassword, user.passwordHash)))
        throw new UnauthorizedException('Current password is incorrect');
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await hash(password, 12) },
      select: { id: true },
    });
  }

  async deleteMe(userId: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true },
    });
    if (!user) throw new NotFoundException('User not found');
    if (user.passwordHash) {
      if (!password || !(await compare(password, user.passwordHash)))
        throw new UnauthorizedException('Incorrect password');
    }
    await this.prisma.user.delete({ where: { id: userId } });
    return { success: true };
  }

  ensureAdmin(user: { role: Role }) {
    if (user.role !== Role.ADMIN) throw new ForbiddenException('Admin only');
  }

  dashboard() {
    return Promise.all([
      this.prisma.user.count({ where: { role: 'USER' } }),
      this.prisma.user.count({ where: { role: 'USER', suspended: false } }),
      this.prisma.match.count({ where: { status: 'ACTIVE' } }),
      this.prisma.message.count(),
      this.prisma.report.count({ where: { status: 'PENDING' } }),
    ]).then(([members, active, matches, messages, reports]) => ({
      members,
      active,
      matches,
      messages,
      reports,
    }));
  }

  adminUsers() {
    return this.prisma.user.findMany({
      include: {
        _count: { select: { reportsReceived: true } },
        verification: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async suspend(id: string, suspended: boolean) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const updated = await this.prisma.user.update({
      where: { id },
      data: { suspended },
      select: { id: true, suspended: true },
    });

    await this.notifications.notify({
      userId: id,
      type: 'system',
      title: suspended ? 'Account suspended' : 'Account reinstated',
      body: suspended
        ? 'Your account has been suspended. Contact support if you think this is a mistake.'
        : 'Your account is active again. Welcome back.',
    });

    return updated;
  }

  /** Approves or rejects a student's verification and tells them the outcome. */
  async verify(id: string, status: 'VERIFIED' | 'REJECTED', note?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const existing = await this.prisma.verification.findUnique({
      where: { userId: id },
      select: { documentUrl: true },
    });

    const verification = await this.prisma.verification.upsert({
      where: { userId: id },
      create: { userId: id, status, note, documentUrl: null },
      update: { status, note, documentUrl: null },
    });

    // The document has served its purpose; holding student ID scans after a
    // decision is data we do not need.
    if (existing?.documentUrl) {
      await this.storage.deleteFile(existing.documentUrl);
    }

    await this.notifications.notify({
      userId: id,
      type: 'system',
      title:
        status === 'VERIFIED' ? 'You are verified' : 'Verification rejected',
      body:
        note ??
        (status === 'VERIFIED'
          ? 'Your student status has been confirmed.'
          : 'We could not confirm your student status. You can submit a new document.'),
    });

    return verification;
  }

  reports() {
    return this.prisma.report.findMany({
      include: {
        reporter: { select: { id: true, displayName: true } },
        reported: { select: { id: true, displayName: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async resolveReport(id: string, status: 'RESOLVED' | 'DISMISSED') {
    const report = await this.prisma.report.findUnique({ where: { id } });
    if (!report) throw new NotFoundException('Report not found');
    return this.prisma.report.update({ where: { id }, data: { status } });
  }

  /**
   * Settings as one object, which is the shape the admin screen edits. Stored
   * per key in `AppConfig` so a single setting can be changed on its own.
   */
  async config() {
    const [emailDomains, weights] = await Promise.all([
      this.settings.allowedEmailDomains(),
      this.settings.matchWeights(),
    ]);
    return { emailDomains: emailDomains.join(', '), weights };
  }

  async setConfig(values: {
    emailDomains?: string | string[];
    weights?: Partial<MatchWeights>;
  }) {
    if (values.emailDomains !== undefined) {
      const domains = (
        Array.isArray(values.emailDomains)
          ? values.emailDomains
          : values.emailDomains.split(',')
      )
        .map((domain) => domain.trim().toLowerCase().replace(/^@/, ''))
        .filter(Boolean);
      if (!domains.length)
        throw new BadRequestException('At least one email domain is required');
      await this.settings.write('emailDomains', domains);
    }

    if (values.weights !== undefined) {
      const weights = values.weights;
      const total = Object.values(weights).reduce(
        (sum, value) => sum + (Number(value) || 0),
        0,
      );
      if (total <= 0)
        throw new BadRequestException(
          'Match weights must add up to more than 0',
        );
      await this.settings.write('weights', weights);
    }

    return this.config();
  }

  async setConfigKey(key: string, value: unknown) {
    await this.settings.write(key, value);
    return { key, value };
  }

  private questionsSeeded = false;

  private async ensureQuestionsSeeded() {
    if (this.questionsSeeded) return;
    await this.prisma.$transaction(
      QUESTION_DEFINITIONS.map((question) =>
        this.prisma.question.upsert({
          where: { id: question.id },
          create: {
            id: question.id,
            key: question.key,
            step: question.step,
            title: question.title,
            sub: question.sub,
            note: question.note,
            groups: {
              create: question.groups.map((group, order) => ({
                label: group.label,
                items: group.items,
                active: group.active,
                order,
              })),
            },
          },
          update: {
            key: question.key,
            step: question.step,
            title: question.title,
            sub: question.sub,
            note: question.note,
          },
        }),
      ),
    );
    this.questionsSeeded = true;
  }

  private async getAnswers(userId: string) {
    const stored = await this.answersFor(userId);
    return QUESTION_KEYS.map((key) => ({
      questionId: key,
      selections: stored[key] ?? [],
    }));
  }
}
