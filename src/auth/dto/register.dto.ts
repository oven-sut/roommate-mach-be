import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @IsString()
  @MinLength(2, { message: 'displayName must be at least 2 characters' })
  @MaxLength(60, { message: 'displayName must not exceed 60 characters' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  displayName: string;

  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(254)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  email: string;

  @IsOptional()
  @IsString()
  @Matches(/^b\d{7,8}$/i, {
    message: 'sutId must be a valid SUT student ID',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  sutId?: string;

  @IsString()
  @MinLength(8, { message: 'password must be at least 8 characters' })
  @MaxLength(72, { message: 'password must not exceed 72 characters' })
  password: string;
}
