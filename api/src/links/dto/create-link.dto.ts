import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsArray,
  ArrayMaxSize,
  MaxLength,
  Validate,
} from 'class-validator';
import {
  IsValidDestinationUrlConstraint,
  IsFutureDateConstraint,
} from '../validators/url.validator';

export class CreateLinkDto {
  @IsNotEmpty({ message: 'long_url is required' })
  @IsString({ message: 'long_url must be a string' })
  @Validate(IsValidDestinationUrlConstraint)
  long_url: string;

  @IsOptional()
  @IsString({ message: 'expires_at must be an ISO date string' })
  @Validate(IsFutureDateConstraint)
  expires_at?: string;

  @IsOptional()
  @IsArray({ message: 'tags must be an array of strings' })
  @ArrayMaxSize(10, { message: 'tags array must have at most 10 items' })
  @IsString({ each: true, message: 'each tag must be a string' })
  @MaxLength(50, { each: true, message: 'each tag must be at most 50 characters' })
  tags?: string[];
}

