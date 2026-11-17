import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Validate,
} from 'class-validator';
import { IsValidDestinationUrlConstraint } from '../validators/url.validator';

export class UpdateLinkDto {
  @IsNotEmpty({ message: 'long_url is required' })
  @IsString({ message: 'long_url must be a string' })
  @Validate(IsValidDestinationUrlConstraint)
  long_url: string;

  @IsOptional()
  @IsArray({ message: 'tags must be an array of strings' })
  @ArrayMaxSize(10, { message: 'tags array must have at most 10 items' })
  @IsString({ each: true, message: 'each tag must be a string' })
  @MaxLength(50, { each: true, message: 'each tag must be at most 50 characters' })
  tags?: string[];
}

