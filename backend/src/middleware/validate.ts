import { NextFunction, Request, Response } from 'express';
import { ZodSchema } from 'zod';
import { Errors } from '../utils/errors';

type Source = 'body' | 'query' | 'params';

export function validate(schema: ZodSchema, source: Source = 'body') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const flat = result.error.flatten();
      return next(
        Errors.invalidRequest('Request validation failed', {
          fields: flat.fieldErrors,
          form: flat.formErrors,
        })
      );
    }
    // Replace with parsed/coerced values.
    (req as any)[source] = result.data;
    next();
  };
}
