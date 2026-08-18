import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { hash } from 'bcryptjs';
import { FeaturesService } from './features.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import {
  AppSettingsService,
  DEFAULT_MATCH_WEIGHTS,
} from '../config/app-settings.service';
import { NotificationsService } from '../notifications/notifications.service';

type Mock = Record<string, jest.Mock>;

/** A Prisma double with every delegate this service touches. */
function prismaMock() {
  const model = () => ({
    findMany: jest.fn().mockResolvedValue([]),
    findFirst: jest.fn().mockResolvedValue(null),
    findUnique: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({}),
    createMany: jest.fn().mockResolvedValue({ count: 0 }),
    update: jest.fn().mockResolvedValue({}),
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    upsert: jest.fn().mockResolvedValue({}),
    delete: jest.fn().mockResolvedValue({}),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    count: jest.fn().mockResolvedValue(0),
  });

  return {
    user: model(),
    profile: model(),
    answer: model(),
    question: model(),
    swipe: model(),
    match: model(),
    conversation: model(),
    message: model(),
    notification: model(),
    report: model(),
    block: model(),
    verification: model(),
    appConfig: model(),
    $transaction: jest.fn((operations: unknown) =>
      Array.isArray(operations) ? Promise.all(operations) : Promise.resolve([]),
    ),
  };
}

describe('FeaturesService', () => {
  let service: FeaturesService;
  let prisma: ReturnType<typeof prismaMock>;
  let notifications: Mock;
  let storage: Mock;

  const ME = '11111111-1111-4111-8111-111111111111';
  const OTHER = '22222222-2222-4222-8222-222222222222';

  beforeEach(async () => {
    prisma = prismaMock();
    notifications = { notify: jest.fn(), notifyMany: jest.fn() };
    storage = { uploadFile: jest.fn(), deleteFile: jest.fn(), ping: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeaturesService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: storage },
        {
          provide: AppSettingsService,
          useValue: {
            matchWeights: jest.fn().mockResolvedValue(DEFAULT_MATCH_WEIGHTS),
            allowedEmailDomains: jest.fn().mockResolvedValue(['g.sut.ac.th']),
            write: jest.fn().mockResolvedValue({}),
          },
        },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();

    service = module.get(FeaturesService);
  });

  describe('likes', () => {
    it('asks for people I have not swiped back, not people who never swiped me', async () => {
      await service.likes(ME);

      const where = prisma.swipe.findMany.mock.calls[0][0].where;
      expect(where.toId).toBe(ME);
      expect(where.decision).toBe('LIKE');
      // The bug this replaces filtered on `sentSwipes`, which is the very row
      // being selected, so the query could never return anything.
      expect(where.from.receivedSwipes).toEqual({ none: { fromId: ME } });
    });

    it('drops anyone the two of us have blocked', async () => {
      prisma.block.findMany.mockResolvedValue([
        { blockerId: ME, blockedId: OTHER },
      ]);
      prisma.swipe.findMany.mockResolvedValue([
        { fromId: OTHER, from: { id: OTHER } },
        { fromId: 'other-2', from: { id: 'other-2' } },
      ]);

      const result = await service.likes(ME);
      expect(result.map((row) => row.fromId)).toEqual(['other-2']);
    });
  });

  describe('block', () => {
    it('refuses to block yourself', async () => {
      await expect(service.block(ME, ME)).rejects.toThrow(BadRequestException);
    });

    it('404s on a user who does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.block(ME, OTHER)).rejects.toThrow(NotFoundException);
    });

    it('unmatches the pair so they cannot keep chatting', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: OTHER });
      await service.block(ME, OTHER);

      expect(prisma.match.updateMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { userAId: ME, userBId: OTHER },
            { userAId: OTHER, userBId: ME },
          ],
        },
        data: { status: 'UNMATCHED' },
      });
    });
  });

  describe('report', () => {
    it('refuses a self-report', async () => {
      await expect(service.report(ME, ME, 'spam')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('404s when the reported user is gone', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.report(ME, OTHER, 'spam')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns the open report instead of stacking duplicates', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: OTHER });
      prisma.report.findFirst.mockResolvedValue({ id: 'report-1' });

      await expect(service.report(ME, OTHER, 'spam')).resolves.toEqual({
        id: 'report-1',
      });
      expect(prisma.report.create).not.toHaveBeenCalled();
    });
  });

  describe('changePassword', () => {
    it('requires the current password', async () => {
      prisma.user.findUnique.mockResolvedValue({ passwordHash: 'stored' });
      await expect(service.changePassword(ME, 'newpassword')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects a wrong current password', async () => {
      prisma.user.findUnique.mockResolvedValue({
        passwordHash: await hash('correct-horse', 12),
      });
      await expect(
        service.changePassword(ME, 'newpassword', 'wrong-one'),
      ).rejects.toThrow(UnauthorizedException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('changes the password when the current one checks out', async () => {
      prisma.user.findUnique.mockResolvedValue({
        passwordHash: await hash('correct-horse', 12),
      });
      await service.changePassword(ME, 'newpassword', 'correct-horse');
      expect(prisma.user.update).toHaveBeenCalled();
    });

    it('lets a Google-only account set its first password', async () => {
      prisma.user.findUnique.mockResolvedValue({ passwordHash: null });
      await service.changePassword(ME, 'newpassword');
      expect(prisma.user.update).toHaveBeenCalled();
    });

    it('still enforces a minimum length', async () => {
      await expect(service.changePassword(ME, 'short')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('swipe', () => {
    beforeEach(() => {
      prisma.user.findUnique.mockResolvedValue({
        id: OTHER,
        displayName: 'Other',
        suspended: false,
      });
    });

    it('refuses to swipe yourself', async () => {
      await expect(service.swipe(ME, ME, 'LIKE')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('refuses a swipe on someone blocked', async () => {
      prisma.block.findMany.mockResolvedValue([
        { blockerId: OTHER, blockedId: ME },
      ]);
      await expect(service.swipe(ME, OTHER, 'LIKE')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('notifies the other person on a one-sided like', async () => {
      prisma.swipe.findFirst.mockResolvedValue(null);

      await expect(service.swipe(ME, OTHER, 'LIKE')).resolves.toEqual({
        matched: false,
      });
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({ userId: OTHER, type: 'like' }),
      );
    });

    it('creates the match and hands back the conversation id', async () => {
      prisma.swipe.findFirst.mockResolvedValue({ fromId: OTHER, toId: ME });
      prisma.match.upsert.mockResolvedValue({ id: 'match-1' });
      prisma.conversation.upsert.mockResolvedValue({ id: 'conversation-1' });

      const result = await service.swipe(ME, OTHER, 'LIKE');

      expect(result.matched).toBe(true);
      expect(result.conversationId).toBe('conversation-1');
      expect(notifications.notifyMany).toHaveBeenCalledWith([
        expect.objectContaining({ userId: ME, type: 'match' }),
        expect.objectContaining({ userId: OTHER, type: 'match' }),
      ]);
    });

    it('does not notify on a pass', async () => {
      await service.swipe(ME, OTHER, 'PASS');
      expect(notifications.notify).not.toHaveBeenCalled();
    });
  });

  describe('createConversation', () => {
    it('will not open a thread with someone you have not matched', async () => {
      prisma.match.findFirst.mockResolvedValue(null);
      await expect(
        service.createConversation(ME, { userId: OTHER }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('reuses the existing thread for a match', async () => {
      prisma.match.findFirst.mockResolvedValue({ id: 'match-1' });
      prisma.conversation.upsert.mockResolvedValue({
        id: 'conversation-1',
        userAId: ME,
        userBId: OTHER,
        userA: { id: ME },
        userB: { id: OTHER },
      });

      const result = await service.createConversation(ME, { userId: OTHER });
      expect(result.id).toBe('conversation-1');
      expect(result.other).toEqual({ id: OTHER });
    });
  });

  describe('discover', () => {
    it('excludes the viewer, everyone swiped and everyone blocked', async () => {
      prisma.swipe.findMany.mockResolvedValue([{ toId: 'swiped-1' }]);
      prisma.block.findMany.mockResolvedValue([
        { blockerId: ME, blockedId: 'blocked-1' },
      ]);

      await service.discover(ME, {});

      const where = prisma.user.findMany.mock.calls[0][0].where;
      expect(where.id.notIn).toEqual([ME, 'swiped-1', 'blocked-1']);
      expect(where.discoverable).toBe(true);
      expect(where.suspended).toBe(false);
    });

    it('caps how many candidates one request scores', async () => {
      await service.discover(ME, {});
      expect(prisma.user.findMany.mock.calls[0][0].take).toBe(500);
    });

    it('turns a budget window into an overlap filter', async () => {
      await service.discover(ME, { budgetMin: 3000, budgetMax: 6000 });

      const profile = prisma.user.findMany.mock.calls[0][0].where.profile.is;
      expect(profile.budgetMax).toEqual({ gte: 3000 });
      expect(profile.budgetMin).toEqual({ lte: 6000 });
    });

    it('reads year bands relative to the viewer', async () => {
      prisma.user.findUnique.mockResolvedValue({ profile: { year: 3 } });
      await service.discover(ME, { yearBand: 'under' });

      const profile = prisma.user.findMany.mock.calls[0][0].where.profile.is;
      expect(profile.year).toEqual({ lt: 3 });
    });

    it('drops candidates below the requested score', async () => {
      const answers = [
        { questionId: 'q1', selections: [['22:00–23:00'], ['07:00–09:00']] },
      ];
      prisma.answer.findMany.mockResolvedValue(answers);
      prisma.user.findMany.mockResolvedValue([
        {
          id: 'twin',
          displayName: 'Twin',
          profile: {},
          verification: null,
          answers,
        },
        {
          id: 'opposite',
          displayName: 'Opposite',
          profile: {},
          verification: null,
          answers: [
            {
              questionId: 'q1',
              selections: [['01:00–02:00'], ['11:00–11:30+']],
            },
          ],
        },
      ]);

      const result = await service.discover(ME, { minScore: 90 });
      expect(result.map((person) => person.id)).toEqual(['twin']);
    });

    it('attaches the score, breakdown and tags each card needs', async () => {
      const answers = [
        { questionId: 'q1', selections: [['22:00–23:00'], ['07:00–09:00']] },
      ];
      prisma.answer.findMany.mockResolvedValue(answers);
      prisma.user.findMany.mockResolvedValue([
        {
          id: 'twin',
          displayName: 'Twin',
          profile: {},
          verification: null,
          answers,
        },
      ]);

      const [person] = await service.discover(ME, {});
      expect(person.score).toBe(100);
      expect(person.breakdown.sleep).toBe(100);
      expect(person.tags[0]).toContain('Early Bird');
      // The raw answer rows are an implementation detail, not part of a card.
      expect(person).not.toHaveProperty('answers');
      expect(person).not.toHaveProperty('lifestyle');
    });

    it.each(['sleep', 'cleanliness', 'guests', 'acTemp'])(
      'honours the "%s" must-match chip the app sends',
      async (key) => {
        const mine = [
          { questionId: 'q1', selections: [['22:00–23:00'], ['07:00–09:00']] },
          { questionId: 'q2', selections: [['Spotless'], ['5/5']] },
          {
            questionId: 'q3',
            selections: [['no'], ['Never'], ['0/month'], []],
          },
          {
            questionId: 'q4',
            selections: [['Anytime'], ['25°'], ['8/8'], ['Library']],
          },
        ];
        const theirs = [
          { questionId: 'q1', selections: [['01:00–02:00'], ['11:00–11:30+']] },
          { questionId: 'q2', selections: [['Laundry piles up'], ['0/5']] },
          {
            questionId: 'q3',
            selections: [['yes'], ['Anytime'], ['10/month'], []],
          },
          {
            questionId: 'q4',
            selections: [['Just day'], ['30°'], ['0/8'], ['In room']],
          },
        ];
        prisma.answer.findMany.mockResolvedValue(mine);
        prisma.user.findMany.mockResolvedValue([
          {
            id: 'twin',
            displayName: 'Twin',
            profile: {},
            verification: null,
            answers: mine,
          },
          {
            id: 'opposite',
            displayName: 'Opposite',
            profile: {},
            verification: null,
            answers: theirs,
          },
        ]);

        const result = await service.discover(ME, { mustMatch: key });
        expect(result.map((person) => person.id)).toEqual(['twin']);
      },
    );

    it('ignores a must-match key it does not recognise rather than emptying the deck', async () => {
      const answers = [
        { questionId: 'q1', selections: [['22:00–23:00'], ['07:00–09:00']] },
      ];
      prisma.answer.findMany.mockResolvedValue(answers);
      prisma.user.findMany.mockResolvedValue([
        {
          id: 'twin',
          displayName: 'Twin',
          profile: {},
          verification: null,
          answers,
        },
      ]);

      const result = await service.discover(ME, {
        mustMatch: 'not-a-category',
      });
      expect(result).toHaveLength(1);
    });
  });

  describe('conversations', () => {
    it('reports how many messages are still unread', async () => {
      prisma.conversation.findMany.mockResolvedValue([
        {
          id: 'conversation-1',
          userAId: ME,
          userBId: OTHER,
          userA: { id: ME },
          userB: { id: OTHER },
          messages: [],
          _count: { messages: 3 },
        },
      ]);

      const [conversation] = await service.conversations(ME);
      expect(conversation.unread).toBe(3);
      expect(conversation.other).toEqual({ id: OTHER });
    });

    it('hides a thread with someone blocked', async () => {
      prisma.block.findMany.mockResolvedValue([
        { blockerId: ME, blockedId: OTHER },
      ]);
      prisma.conversation.findMany.mockResolvedValue([
        {
          id: 'conversation-1',
          userAId: ME,
          userBId: OTHER,
          userA: { id: ME },
          userB: { id: OTHER },
          messages: [],
          _count: { messages: 0 },
        },
      ]);

      await expect(service.conversations(ME)).resolves.toEqual([]);
    });
  });

  describe('markConversationRead', () => {
    it('only marks what the other person sent', async () => {
      prisma.conversation.findFirst.mockResolvedValue({
        id: 'conversation-1',
        userAId: ME,
        userBId: OTHER,
      });
      prisma.message.updateMany.mockResolvedValue({ count: 2 });

      await expect(
        service.markConversationRead(ME, 'conversation-1'),
      ).resolves.toEqual({ updated: 2 });

      expect(prisma.message.updateMany).toHaveBeenCalledWith({
        where: {
          conversationId: 'conversation-1',
          senderId: { not: ME },
          readAt: null,
        },
        data: { readAt: expect.any(Date) },
      });
    });

    it('refuses a conversation that is not mine', async () => {
      prisma.conversation.findFirst.mockResolvedValue(null);
      await expect(
        service.markConversationRead(ME, 'conversation-1'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('messages', () => {
    it('returns a page oldest-first', async () => {
      prisma.conversation.findFirst.mockResolvedValue({
        id: 'conversation-1',
        userAId: ME,
        userBId: OTHER,
      });
      prisma.message.findMany.mockResolvedValue([
        { id: 'newer' },
        { id: 'older' },
      ]);

      const result = await service.messages(ME, 'conversation-1', { limit: 2 });
      expect(result.map((message) => message.id)).toEqual(['older', 'newer']);
      expect(prisma.message.findMany.mock.calls[0][0].take).toBe(2);
    });

    it('caps an oversized page request', async () => {
      prisma.conversation.findFirst.mockResolvedValue({
        id: 'conversation-1',
        userAId: ME,
        userBId: OTHER,
      });
      await service.messages(ME, 'conversation-1', { limit: 5000 });
      expect(prisma.message.findMany.mock.calls[0][0].take).toBe(100);
    });
  });

  describe('admin verify', () => {
    it('upserts instead of exploding when no document was ever sent', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: OTHER });
      prisma.verification.findUnique.mockResolvedValue(null);

      await service.verify(OTHER, 'VERIFIED');

      expect(prisma.verification.upsert).toHaveBeenCalled();
      expect(storage.deleteFile).not.toHaveBeenCalled();
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({ userId: OTHER, type: 'system' }),
      );
    });

    it('deletes the stored document once a decision is made', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: OTHER });
      prisma.verification.findUnique.mockResolvedValue({
        documentUrl: 'http://minio/roommate-match/verifications/a.jpg',
      });

      await service.verify(OTHER, 'REJECTED', 'Unreadable photo');
      expect(storage.deleteFile).toHaveBeenCalledWith(
        'http://minio/roommate-match/verifications/a.jpg',
      );
    });

    it('404s for a user who does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.verify(OTHER, 'VERIFIED')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('userProfile', () => {
    it('hides a blocked user behind a 404', async () => {
      prisma.block.findMany.mockResolvedValue([
        { blockerId: OTHER, blockedId: ME },
      ]);
      await expect(service.userProfile(ME, OTHER)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('includes the match and conversation so the screen can offer Message', async () => {
      prisma.user.findFirst.mockResolvedValue({
        id: OTHER,
        displayName: 'Other',
        profile: {},
        verification: null,
      });
      prisma.match.findFirst.mockResolvedValue({
        id: 'match-1',
        createdAt: new Date('2026-01-01'),
      });
      prisma.conversation.findFirst.mockResolvedValue({ id: 'conversation-1' });

      const result = await service.userProfile(ME, OTHER);
      expect(result).toMatchObject({
        matchId: 'match-1',
        conversationId: 'conversation-1',
      });
    });
  });

  describe('setConfig', () => {
    it('normalises the domain list an admin types', async () => {
      const settings = (service as unknown as { settings: Mock }).settings;
      await service.setConfig({ emailDomains: ' @G.SUT.ac.th , sut.ac.th ' });

      expect(settings.write).toHaveBeenCalledWith('emailDomains', [
        'g.sut.ac.th',
        'sut.ac.th',
      ]);
    });

    it('rejects an empty domain list', async () => {
      await expect(service.setConfig({ emailDomains: ' , ' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects weights that add up to nothing', async () => {
      await expect(
        service.setConfig({
          weights: { sleep: 0, cleanliness: 0, guests: 0, temperature: 0 },
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('uploadAvatar', () => {
    it('rejects anything that is not a base64 image', async () => {
      await expect(
        service.uploadAvatar(ME, 'https://example.com/a.jpg'),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
