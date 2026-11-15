import type { z } from "zod";

export interface Issue {
  path: string;
  message: string;
}

/** A problem the user can fix. Shown next to the relevant field. */
export class ValidationError extends Error {
  constructor(readonly issues: Issue[]) {
    super(issues.map((i) => i.message).join("; "));
    this.name = "ValidationError";
  }
  static one(path: string, message: string) {
    return new ValidationError([{ path, message }]);
  }
}

export function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const r = schema.safeParse(input);
  if (!r.success) {
    throw new ValidationError(r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  }
  return r.data;
}
