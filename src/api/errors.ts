export class AppError extends Error {
  constructor(
    public status: 400 | 404 | 409 | 413,
    public code: string,
    message: string,
    public details: unknown = null,
  ) {
    super(message);
  }
}
