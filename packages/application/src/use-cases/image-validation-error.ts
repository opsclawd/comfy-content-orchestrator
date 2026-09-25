export class ImageValidationError extends Error {
  override readonly name = "ImageValidationError";

  constructor(message: string) {
    super(message);
  }
}
