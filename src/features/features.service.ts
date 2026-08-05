import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma, Role, SwipeDecision } from '@prisma/client';
import { compare, hash } from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { MinioService } from './minio.service';

type QuestionDefinition = {
  id: string;
  key: string;
  step: number;
  title: string;
  sub: string;
  note?: string;
  groups: { label: string; items: string[]; active: number[] }[];
};

const QUESTION_DEFINITIONS: QuestionDefinition[] = [
  {
    id: 'q1',
    key: 'q1',
    step: 1,
    title: 'Sleep & wake rhythm',
    sub: 'Tell us when you usually sleep and start your day.',
    note: 'These habits help us match students with similar daily rhythms.',
    groups: [
      {
        label: 'Usual bedtime',
        items: ['21:00 – 22:30', '23:00 – 00:30', '01:00+'],
        active: [],
      },
      {
        label: 'Usual wake-up time',
        items: ['06:00 – 07:00', '07:00 – 08:00', '09:00+'],
        active: [],
      },
    ],
  },
  {
    id: 'q2',
    key: 'q2',
    step: 2,
    title: 'Cleanliness & routines',
    sub: 'Choose the habits that matter most in a shared room.',
    groups: [
      {
        label: 'Non-negotiables',
        items: [
          'Spotless',
          'Dishes same day',
          'Shoes off inside',
          'Make the bed',
          'Shared cleaning schedule',
        ],
        active: [],
      },
      {
        label: 'How tidy are you?',
        items: ['1/5', '2/5', '3/5', '4/5', '5/5'],
        active: [2],
      },
    ],
  },
  {
    id: 'q3',
    key: 'q3',
    step: 3,
    title: 'Guests & social energy',
    sub: 'Set expectations for visitors and shared social time.',
    groups: [
      {
        label: 'Guests in the room',
        items: ['Rarely', 'Sometimes', 'Often'],
        active: [1],
      },
      {
        label: 'Who might visit?',
        items: ['Close friends', 'Study group', 'Family', 'Partner'],
        active: [],
      },
      {
        label: 'Social energy',
        items: ['Quiet', 'Balanced', 'Very social'],
        active: [1],
      },
    ],
  },
  {
    id: 'q4',
    key: 'q4',
    step: 4,
    title: 'Temperature & study setup',
    sub: 'Help us understand how you work best in your room.',
    groups: [
      {
        label: 'Preferred AC temperature',
        items: ['22–24°', '25–26°', '27°+'],
        active: [1],
      },
      {
        label: 'Need for quiet while studying',
        items: ['1/5', '2/5', '3/5', '4/5', '5/5'],
        active: [2],
      },
      {
        label: 'Best study location',
        items: ['In room', 'Library', 'Cafe / outside room'],
        active: [],
      },
    ],
  },
  {
    id: 'q5',
    key: 'q5',
    step: 5,
    title: 'Lifestyle boundaries',
    sub: 'A few practical preferences before we finish.',
    groups: [
      {
        label: 'Smoking in your living environment',
        items: ['No', 'Okay outdoors only', 'Okay indoors'],
        active: [0],
      },
      {
        label: 'Alcohol',
        items: ['Never', 'Socially', 'Often'],
        active: [1],
      },
      {
        label: 'Pets',
        items: ['No pets', 'Okay with some', 'Love them'],
        active: [1],
      },
    ],
  },
  {
    id: 'q6',
    key: 'q6',
    step: 6,
    title: 'Money & shared expectations',
    sub: 'Last step. Align on spending and compromise.',
    groups: [
      {
        label: 'How should shared costs work?',
        items: ['Split equally', 'Pay by usage', 'Flexible / discuss'],
        active: [0],
      },
      {
        label: 'How flexible are you?',
        items: ['Low', 'Moderate', 'High'],
        active: [1],
      },
    ],
  },
];

@Injectable()
export class FeaturesService {
  constructor(
    private prisma: PrismaService,
    private minioService: MinioService,
  ) {}

  private async processPhotos(userId: string, photos: string[]): Promise<string[]> {
    const processed: string[] = [];
    for (let i = 0; i < photos.length; i++) {
      const photo = photos[i];
      if (photo && photo.startsWith('data:')) {
        try {
          const extension = photo.split(';')[0].split('/')[1] || 'jpeg';
          const fileName = `profiles/${userId}/photo_${i}_${Date.now()}.${extension}`;
          const url = await this.minioService.uploadFile(photo, fileName);
          processed.push(url);
        } catch (err) {
          console.error(`Failed to upload profile photo ${i} for user ${userId}`, err);
          processed.push(photo);
        }
      } else {
        processed.push(photo);
      }
    }
    return processed;
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
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
    if (data.discoverable !== undefined) update.discoverable = data.discoverable;
    if (data.notificationPrefs !== undefined)
      update.notificationPrefs = data.notificationPrefs as Prisma.InputJsonValue;

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

  async profile(userId: string, data: Record<string, any>) {
    const photos = await this.processPhotos(userId, data.photos ?? []);
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
      photos,
      completed: Boolean(data.completed),
    };
    return this.prisma.profile.upsert({
      where: { userId },
      create: { userId, ...clean },
      update: clean,
    });
  }

  getQuestionnaire() {
    return QUESTION_DEFINITIONS;
  }

  async questionnaire(
    userId: string,
    answers: Record<string, unknown>,
    completed = true,
  ) {
    await this.ensureQuestionsSeeded();

    await this.prisma.$transaction(
      QUESTION_DEFINITIONS.map((question) =>
        this.prisma.answer.upsert({
          where: { userId_questionId: { userId, questionId: question.id } },
          create: {
            userId,
            questionId: question.id,
            selections: (Array.isArray(answers[question.key])
              ? answers[question.key]
              : []) as Prisma.InputJsonValue,
          },
          update: {
            selections: (Array.isArray(answers[question.key])
              ? answers[question.key]
              : []) as Prisma.InputJsonValue,
          },
        }),
      ),
    );

    if (completed)
      await this.prisma.profile.updateMany({
        where: { userId },
        data: { completed: true },
      });
    return { success: true };
  }

  async verification(userId: string, documentUrl: string) {
    let finalUrl = documentUrl;
    if (documentUrl && documentUrl.startsWith('data:')) {
      try {
        const extension = documentUrl.split(';')[0].split('/')[1] || 'jpeg';
        const fileName = `verifications/${userId}/document_${Date.now()}.${extension}`;
        finalUrl = await this.minioService.uploadFile(documentUrl, fileName);
      } catch (err) {
        console.error(`Failed to upload verification document for user ${userId}`, err);
      }
    }
    return this.prisma.verification.upsert({
      where: { userId },
      create: { userId, documentUrl: finalUrl },
      update: { documentUrl: finalUrl, status: 'PENDING' },
    });
  }

  async discover(userId: string, page?: string) {
    const pageNum = Math.max(1, parseInt(page as string) || 1);
    const limit = 30;
    const offset = (pageNum - 1) * limit;

    const [blockedByMe, blockedMe, swipedIds, users, answerRows] =
      await Promise.all([
        this.prisma.block.findMany({
          where: { blockerId: userId },
          select: { blockedId: true },
        }),
        this.prisma.block.findMany({
          where: { blockedId: userId },
          select: { blockerId: true },
        }),
        this.prisma.swipe.findMany({
          where: { fromId: userId },
          select: { toId: true },
        }),
        this.prisma.user.findMany({
          where: {
            id: { not: userId },
            role: 'USER',
            suspended: false,
            discoverable: true,
            profile: { is: { completed: true } },
          },
          include: { profile: true, verification: true },
        }),
        this.prisma.answer.findMany({
          select: { userId: true, questionId: true, selections: true },
        }),
      ]);

    const excludedIds = new Set([
      ...blockedByMe.map((row) => row.blockedId),
      ...blockedMe.map((row) => row.blockerId),
      ...swipedIds.map((row) => row.toId),
    ]);
    const questionnaireMap = new Map<
      string,
      { questionId: string; selections: unknown }[]
    >();
    for (const row of answerRows) {
      const entries = questionnaireMap.get(row.userId) ?? [];
      entries.push({ questionId: row.questionId, selections: row.selections });
      questionnaireMap.set(row.userId, entries);
    }
    const currentUserAnswers = questionnaireMap.get(userId) ?? [];

    return users
      .filter((user) => !excludedIds.has(user.id))
      .map((user) => ({
        ...user,
        passwordHash: undefined,
        googleId: undefined,
        score: this.score(
          currentUserAnswers,
          questionnaireMap.get(user.id) ?? [],
        ),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(offset, offset + limit);
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
    return blocks.map((b) => ({ ...b.blocked, blockedAt: b.createdAt }));
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
      url = await this.minioService.uploadFile(avatarData, fileName);
    } catch (err) {
      console.error(`Failed to upload avatar for user ${userId}`, err);
      throw new ServiceUnavailableException(
        'Avatar storage is temporarily unavailable. Please try again later.',
      );
    }

    const profile = await this.prisma.profile.findUnique({ where: { userId } });
    const currentPhotos = profile?.photos ?? [];
    const updatedPhotos = [url, ...currentPhotos.filter((p) => p !== url)].slice(
      0,
      6,
    );

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
                { profile: { is: { major: { contains: q, mode: 'insensitive' } } } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        displayName: true,
        email: true,
        profile: true,
        verification: true,
        createdAt: true,
      },
      take: 50,
    });

    const blocks = await this.prisma.block.findMany({
      where: { blockerId: currentUserId },
      select: { blockedId: true },
    });
    const blockedSet = new Set(blocks.map((b) => b.blockedId));

    return users.map((u) => ({
      ...u,
      isBlocked: blockedSet.has(u.id),
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

  async changePassword(userId: string, password: string) {
    if (password.length < 8)
      throw new BadRequestException('Password must be at least 8 characters');
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
    const rows = await this.prisma.answer.findMany({
      where: { userId },
      select: { questionId: true, selections: true },
    });
    const byQuestionId = new Map(
      rows.map((row) => [row.questionId, row.selections]),
    );
    return QUESTION_DEFINITIONS.map((question) => ({
      questionId: question.id,
      selections: byQuestionId.get(question.id) ?? [],
    }));
  }
}
