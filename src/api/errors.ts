export class AppError extends Error {
  constructor(
    public status: 400 | 401 | 404 | 409 | 413 | 429,
    public code: string,
    message: string,
    public details: unknown = null,
  ) {
    super(message);
  }
}
