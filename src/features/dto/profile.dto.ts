import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

/** Rejects a budget window whose floor is above its ceiling. */
@ValidatorConstraint({ name: 'budgetOrder', async: false })
export class BudgetOrderConstraint implements ValidatorConstraintInterface {
  validate(budgetMax: unknown, args: ValidationArguments) {
    const { budgetMin } = args.object as ProfileDto;
    if (budgetMin == null || budgetMax == null) return true;
    return Number(budgetMax) >= Number(budgetMin);
  }

  defaultMessage() {
    return 'budgetMax must be greater than or equal to budgetMin';
  }
}

const toNumber = ({ value }: { value: unknown }) =>
  value === '' || value === null ? undefined : value;

export class ProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  displayName?: string;

  @IsOptional()
  @Transform(toNumber)
  @Type(() => Number)
  @IsInt()
  @Min(16, { message: 'age must be at least 16' })
  @Max(99)
  age?: number;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  major?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  gender?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'bio must not exceed 500 characters' })
  bio?: string;

  @IsOptional()
  @Transform(toNumber)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(8)
  year?: number;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  roomType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  propertyType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  roommateGender?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  zone?: string;

  @IsOptional()
  @Transform(toNumber)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  budgetMin?: number;

  @IsOptional()
  @Transform(toNumber)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  @Validate(BudgetOrderConstraint)
  budgetMax?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6, { message: 'a profile can hold at most 6 photos' })
  @IsString({ each: true })
  photos?: string[];

  @IsOptional()
  @IsBoolean()
  completed?: boolean;
}
