import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role, SwipeDecision } from '@prisma/client';
import { hash } from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class FeaturesService {
  constructor(private prisma: PrismaService) {}

  me(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        displayName: true,
        email: true,
        role: true,
        discoverable: true,
        notificationPrefs: true,
        createdAt: true,
        profile: true,
        answers: true,
        verification: true,
      },
    });
  }
  updateMe(
    userId: string,
    data: {
      displayName?: string;
      discoverable?: boolean;
      notificationPrefs?: Record<string, boolean>;
    },
  ) {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        ...data,
        notificationPrefs: data.notificationPrefs as Prisma.InputJsonValue,
      },
      select: {
        id: true,
        displayName: true,
        email: true,
        discoverable: true,
        notificationPrefs: true,
      },
    });
  }
  profile(userId: string, data: any) {
    const clean = {
      age: data.age,
      major: data.major,
      gender: data.gender,
      bio: data.bio,
      year: data.year,
      roomType: data.roomType,
      roommateGender: data.roommateGender,
      zone: data.zone,
      budgetMin: data.budgetMin,
      budgetMax: data.budgetMax,
      photos: data.photos ?? [],
      completed: Boolean(data.completed),
    };
    return this.prisma.profile.upsert({
      where: { userId },
      create: { userId, ...clean },
      update: clean,
    });
  }
  getQuestionnaire() {
    return this.prisma.question.findMany({
      include: { groups: { orderBy: { order: 'asc' } } },
      orderBy: { step: 'asc' },
    });
  }
  async questionnaire(
    userId: string,
    answers: Record<string, unknown>,
    completed = true,
  ) {
    const questions = await this.prisma.question.findMany();
    for (const q of questions) {
      if (answers[q.key] !== undefined) {
        await this.prisma.answer.upsert({
          where: { userId_questionId: { userId, questionId: q.id } },
          create: {
            userId,
            questionId: q.id,
            selections: answers[q.key] as Prisma.InputJsonValue,
          },
          update: { selections: answers[q.key] as Prisma.InputJsonValue },
        });
      }
    }
    if (completed)
      await this.prisma.profile.updateMany({
        where: { userId },
        data: { completed: true },
      });
    return { success: true };
  }
  verification(userId: string, documentUrl: string) {
    return this.prisma.verification.upsert({
      where: { userId },
      create: { userId, documentUrl },
      update: { documentUrl, status: 'PENDING' },
    });
  }
  async discover(userId: string) {
    const me = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        answers: true,
        blocksMade: true,
        blocksReceived: true,
        sentSwipes: true,
      },
    });
    if (!me) throw new NotFoundException();
    const excluded = [
      userId,
      ...me.blocksMade.map((x) => x.blockedId),
      ...me.blocksReceived.map((x) => x.blockerId),
      ...me.sentSwipes.map((x) => x.toId),
    ];
    const users = await this.prisma.user.findMany({
      where: {
        id: { notIn: excluded },
        role: 'USER',
        suspended: false,
        discoverable: true,
        profile: { completed: true },
      },
      include: { profile: true, answers: true, verification: true },
      take: 30,
    });
    return users
      .map((user) => ({
        ...user,
        passwordHash: undefined,
        googleId: undefined,
        score: this.score(me.answers, user.answers),
      }))
      .sort((a, b) => b.score - a.score);
  }
  private score(a: unknown, b: unknown) {
    if (!a || !b) return 70;
    const aa = a as { questionId: string; selections: unknown }[],
      bb = b as { questionId: string; selections: unknown }[];
    if (!aa.length || !bb.length) return 70;
    const shared = aa.filter((x) =>
      bb.some((y) => y.questionId === x.questionId),
    );
    if (!shared.length) return 70;
    const matches = shared.filter(
      (x) =>
        JSON.stringify(x.selections) ===
        JSON.stringify(
          bb.find((y) => y.questionId === x.questionId)?.selections,
        ),
    );
    return Math.round(55 + (40 * matches.length) / shared.length);
  }
  async swipe(fromId: string, toId: string, decision: SwipeDecision) {
    if (fromId === toId) throw new BadRequestException('Cannot swipe yourself');
    await this.prisma.swipe.upsert({
      where: { fromId_toId: { fromId, toId } },
      create: { fromId, toId, decision },
      update: { decision },
    });
    if (decision === 'PASS') return { matched: false };
    const other = await this.prisma.swipe.findFirst({
      where: { fromId: toId, toId: fromId, decision: 'LIKE' },
    });
    if (!other) return { matched: false };
    const [userAId, userBId] = [fromId, toId].sort();
    const match = await this.prisma.match.upsert({
      where: { userAId_userBId: { userAId, userBId } },
      create: { userAId, userBId, score: 88 },
      update: { status: 'ACTIVE' },
    });
    await this.prisma.conversation.upsert({
      where: { userAId_userBId: { userAId, userBId } },
      create: { userAId, userBId },
      update: {},
    });
    await this.prisma.notification.createMany({
      data: [
        {
          userId: fromId,
          type: 'match',
          title: "It's a Match!",
          body: 'You can now start chatting.',
        },
        {
          userId: toId,
          type: 'match',
          title: "It's a Match!",
          body: 'You can now start chatting.',
        },
      ],
    });
    return { matched: true, match };
  }
  async matches(userId: string) {
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
    return matches.map((m) => ({
      ...m,
      other: m.userAId === userId ? m.userB : m.userA,
    }));
  }
  likes(userId: string) {
    return this.prisma.swipe.findMany({
      where: {
        toId: userId,
        decision: 'LIKE',
        from: { sentSwipes: { none: { toId: userId } } },
      },
      include: {
        from: { select: { id: true, displayName: true, profile: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
  async conversations(userId: string) {
    const rows = await this.prisma.conversation.findMany({
      where: { OR: [{ userAId: userId }, { userBId: userId }] },
      include: {
        userA: { select: { id: true, displayName: true, profile: true } },
        userB: { select: { id: true, displayName: true, profile: true } },
        messages: { take: 1, orderBy: { createdAt: 'desc' } },
      },
      orderBy: { updatedAt: 'desc' },
    });
    return rows.map((c) => ({
      ...c,
      other: c.userAId === userId ? c.userB : c.userA,
    }));
  }
  async messages(userId: string, conversationId: string) {
    const c = await this.prisma.conversation.findFirst({
      where: {
        id: conversationId,
        OR: [{ userAId: userId }, { userBId: userId }],
      },
    });
    if (!c) throw new ForbiddenException();
    return this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
    });
  }
  async send(userId: string, conversationId: string, text: string) {
    if (!text?.trim()) throw new BadRequestException('Message is empty');
    const c = await this.prisma.conversation.findFirst({
      where: {
        id: conversationId,
        OR: [{ userAId: userId }, { userBId: userId }],
      },
    });
    if (!c) throw new ForbiddenException();
    const message = await this.prisma.message.create({
      data: { conversationId, senderId: userId, text: text.trim() },
    });
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });
    const recipient = c.userAId === userId ? c.userBId : c.userAId;
    await this.prisma.notification.create({
      data: {
        userId: recipient,
        type: 'message',
        title: 'New Message',
        body: text.trim().slice(0, 100),
        data: { conversationId },
      },
    });
    return message;
  }
  notifications(userId: string) {
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
  report(
    reporterId: string,
    reportedId: string,
    reason: string,
    details?: string,
  ) {
    return this.prisma.report.create({
      data: { reporterId, reportedId, reason, details },
    });
  }
  block(blockerId: string, blockedId: string) {
    return this.prisma.block.upsert({
      where: { blockerId_blockedId: { blockerId, blockedId } },
      create: { blockerId, blockedId },
      update: {},
    });
  }
  unblock(blockerId: string, blockedId: string) {
    return this.prisma.block.deleteMany({ where: { blockerId, blockedId } });
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
  async changePassword(userId: string, password: string) {
    if (password.length < 8)
      throw new BadRequestException('Password must be at least 8 characters');
    return this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await hash(password, 12) },
      select: { id: true },
    });
  }
  ensureAdmin(user: any) {
    if (user.role !== Role.ADMIN) throw new ForbiddenException('Admin only');
  }
  dashboard() {
    return Promise.all([
      this.prisma.user.count({ where: { role: 'USER' } }),
      this.prisma.user.count({ where: { role: 'USER', suspended: false } }),
      this.prisma.match.count(),
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
  suspend(id: string, suspended: boolean) {
    return this.prisma.user.update({
      where: { id },
      data: { suspended },
      select: { id: true, suspended: true },
    });
  }
  verify(id: string, status: 'VERIFIED' | 'REJECTED') {
    return this.prisma.verification.update({
      where: { userId: id },
      data: { status, documentUrl: null },
    });
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
  config() {
    return this.prisma.appConfig.findMany();
  }
  setConfig(key: string, value: unknown) {
    return this.prisma.appConfig.upsert({
      where: { key },
      create: { key, value: value as Prisma.InputJsonValue },
      update: { value: value as Prisma.InputJsonValue },
    });
  }
}
