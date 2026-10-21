import 'express';

declare module 'express-serve-static-core' {
  interface Request {
    requestId: string;
    /** Present after the requireSession middleware. */
    session?: { id: string; ownerId: string };
  }
}
