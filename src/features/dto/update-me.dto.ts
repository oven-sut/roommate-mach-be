import {
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateMeDto {
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'displayName must be at least 2 characters' })
  @MaxLength(60, { message: 'displayName must not exceed 60 characters' })
  displayName?: string;

  @IsOptional()
  @IsBoolean()
  discoverable?: boolean;

  @IsOptional()
  @IsObject()
  notificationPrefs?: Record<string, boolean>;
}
