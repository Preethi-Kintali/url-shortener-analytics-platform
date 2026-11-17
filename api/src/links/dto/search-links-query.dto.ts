import { IsOptional, IsString, MaxLength, Matches, ValidatorConstraint, ValidatorConstraintInterface, ValidationArguments, Validate } from 'class-validator';
import {
  CONTROL_CHAR_REGEX,
  MAX_SEARCH_PAGE,
  MAX_SEARCH_PAGE_SIZE,
  MAX_SEARCH_QUERY_LENGTH,
  MAX_TAG_LENGTH,
} from '../validators/tag.util';

@ValidatorConstraint({ name: 'noControlChars', async: false })
class NoControlCharsConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (value === undefined) return true;
    return typeof value === 'string' && !CONTROL_CHAR_REGEX.test(value);
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} must not contain control characters`;
  }
}

@ValidatorConstraint({ name: 'strictPositiveIntRange', async: false })
class StrictPositiveIntRangeConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    if (value === undefined) return true;
    if (typeof value !== 'string') return false;
    const trimmed = value.trim();
    if (!/^[1-9]\d*$/.test(trimmed)) return false;
    const parsed = Number.parseInt(trimmed, 10);
    const max = Number(args.constraints[0]);
    return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= max;
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} must be an integer between 1 and ${args.constraints[0]}`;
  }
}

export class SearchLinksQueryDto {
  @IsOptional()
  @IsString({ message: 'q must be a string' })
  @MaxLength(MAX_SEARCH_QUERY_LENGTH, {
    message: `q must be at most ${MAX_SEARCH_QUERY_LENGTH} characters`,
  })
  @Validate(NoControlCharsConstraint)
  q?: string;

  @IsOptional()
  @IsString({ message: 'tag must be a string' })
  @MaxLength(MAX_TAG_LENGTH, {
    message: `tag must be at most ${MAX_TAG_LENGTH} characters`,
  })
  @Validate(NoControlCharsConstraint)
  tag?: string;

  @IsOptional()
  @IsString({ message: 'page must be a positive integer' })
  @Matches(/^[1-9]\d*$/, { message: 'page must be a positive integer' })
  @Validate(StrictPositiveIntRangeConstraint, [MAX_SEARCH_PAGE])
  page?: string;

  @IsOptional()
  @IsString({ message: 'page_size must be a positive integer' })
  @Matches(/^[1-9]\d*$/, { message: 'page_size must be a positive integer' })
  @Validate(StrictPositiveIntRangeConstraint, [MAX_SEARCH_PAGE_SIZE])
  page_size?: string;
}

