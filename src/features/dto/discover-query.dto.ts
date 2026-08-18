import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** Which year groups relative to the viewer's own year to show. */
export const YEAR_BANDS = ['under', 'peer', 'upper', 'everyone'] as const;
export type YearBand = (typeof YEAR_BANDS)[number];

export class DiscoverQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @IsIn(YEAR_BANDS)
  yearBand?: YearBand;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  major?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  budgetMin?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  budgetMax?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  minScore?: number;

  /** Comma-separated category keys, e.g. `sleep,cleanliness`. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Matches(/^[a-zA-Z,\s]*$/, {
    message: 'mustMatch must be a comma-separated list',
  })
  mustMatch?: string;
}
