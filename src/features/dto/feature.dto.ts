import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class QuestionnaireDto {
  /** `{ q1: [["22:00-23:00"], ["07:00-09:00"]], ... }` — see scoring.ts. */
  @IsObject()
  answers: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  completed?: boolean;
}

export class SwipeDto {
  @IsIn(['LIKE', 'PASS'])
  decision: 'LIKE' | 'PASS';
}

export class SendMessageDto {
  @IsString()
  @IsNotEmpty({ message: 'Message is empty' })
  @MaxLength(2000)
  text: string;
}

export class CreateConversationDto {
  @IsOptional()
  @IsUUID()
  matchId?: string;

  @IsOptional()
  @IsUUID()
  userId?: string;
}

export class MessagesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  /** ISO timestamp: return messages older than this. */
  @IsOptional()
  @IsString()
  before?: string;
}

export class ReportDto {
  @IsString()
  @IsNotEmpty({ message: 'A reason is required' })
  @MaxLength(120)
  reason: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  details?: string;
}

export class BlockUserDto {
  @IsUUID()
  userId: string;
}

export class AvatarDto {
  @IsOptional()
  @IsString()
  avatar?: string;

  @IsOptional()
  @IsString()
  photo?: string;

  @IsOptional()
  @IsString()
  file?: string;
}

export class VerificationDto {
  @IsString()
  @IsNotEmpty()
  documentUrl: string;
}

export class ChangePasswordDto {
  @IsOptional()
  @IsString()
  @MaxLength(72)
  currentPassword?: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @MaxLength(72)
  password: string;
}

export class DeleteMeDto {
  @IsOptional()
  @IsString()
  @MaxLength(72)
  password?: string;
}

export class SuspendDto {
  @IsBoolean()
  suspended: boolean;
}

export class VerifyUserDto {
  @IsIn(['VERIFIED', 'REJECTED'])
  status: 'VERIFIED' | 'REJECTED';

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class ResolveReportDto {
  @IsIn(['RESOLVED', 'DISMISSED'])
  status: 'RESOLVED' | 'DISMISSED';
}

export class MatchWeightsDto {
  @IsNumber()
  @Min(0)
  @Max(100)
  sleep: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  cleanliness: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  guests: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  temperature: number;
}

export class AdminConfigDto {
  /** Either "a.com, b.com" or ["a.com", "b.com"]. */
  @IsOptional()
  emailDomains?: string | string[];

  @IsOptional()
  @IsObject()
  weights?: MatchWeightsDto;
}

export class SetConfigKeyDto {
  @IsOptional()
  value?: unknown;
}
