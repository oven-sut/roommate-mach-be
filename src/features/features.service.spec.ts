import { Test, TestingModule } from '@nestjs/testing';
import { FeaturesService } from './features.service';
import { PrismaService } from '../prisma/prisma.service';

describe('FeaturesService - score calculation', () => {
  let service: FeaturesService | unknown;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [FeaturesService, { provide: PrismaService, useValue: {} }],
    }).compile();

    service = module.get<FeaturesService>(FeaturesService);
  });

  it('should return 70 if answers are missing', () => {
    const s = service as any;
    expect(s.score(null, null)).toBe(70);
    expect(s.score([], [])).toBe(70);
  });

  it('should calculate score correctly for exact matches', () => {
    const userA = [
      { questionId: 'q1', selections: [[0]] },
      { questionId: 'q2', selections: [[1]] },
    ];
    const userB = [
      { questionId: 'q1', selections: [[0]] },
      { questionId: 'q2', selections: [[1]] },
    ];
    // 2 matching keys out of 2 shared keys -> 55 + 40 * (2/2) = 95
    expect((service as any).score(userA, userB)).toBe(95);
  });

  it('should calculate score correctly for partial matches', () => {
    const userA = [
      { questionId: 'q1', selections: [[0]] },
      { questionId: 'q2', selections: [[1]] },
      { questionId: 'q3', selections: [[0]] },
      { questionId: 'q4', selections: [[0]] },
    ];
    const userB = [
      { questionId: 'q1', selections: [[0]] }, // match
      { questionId: 'q2', selections: [[0]] }, // mismatch
      { questionId: 'q3', selections: [[0]] }, // match
      { questionId: 'q4', selections: [[1]] }, // mismatch
    ];
    // 2 matching out of 4 shared keys -> 55 + 40 * (2/4) = 75
    expect((service as any).score(userA, userB)).toBe(75);
  });

  it('should return 70 if there are no shared questions', () => {
    const userA = [{ questionId: 'q1', selections: [[0]] }];
    const userB = [{ questionId: 'q2', selections: [[1]] }];
    expect((service as any).score(userA, userB)).toBe(70);
  });
});
