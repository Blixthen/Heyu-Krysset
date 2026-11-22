/** A failure whose message is safe to show to the user. */
export type UserFailure = { message: string; status: number };

/** An expected outcome of a pure check: a value, or a failure to show. */
export type Result<T> = { ok: true; value: T } | { ok: false; error: UserFailure };
