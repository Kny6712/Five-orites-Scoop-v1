// payment-server/src/auth.ts
// Five-orites Scoop — Firebase ID-token verification for /payment/session.
//
// WHY THIS EXISTS. The session endpoint creates a payment request against an
// order and tells us how much to charge. If it were open, anyone who could
// reach it could mint checkout URLs against other people's orders and learn
// order totals. So the caller must be the order's own customer, and the only
// portable proof of that is a Firebase ID token.
//
// The webhook does NOT use this. It uses the Xendit callback token instead —
// Xendit is the caller there, and it has no Firebase identity.

import type { Request, Response, NextFunction } from 'express';
import type { Auth } from 'firebase-admin/auth';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Verified Firebase UID, present only after `requireAuth` runs. */
      uid?: string;
      /** The token's email, for the audit trail on the order document. */
      email?: string;
    }
  }
}

/**
 * Express middleware verifying `Authorization: Bearer <idToken>`.
 *
 * 401 rather than 403 on failure: the caller's credential is missing, expired
 * or forged, and the Angular side treats both the same way — "sign in again".
 * A 403 would imply the caller is authenticated but not permitted, which is
 * not the situation any of these failures describe.
 */
export function requireAuth(auth: Auth) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const header = req.header('authorization') ?? '';
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (!match?.[1]) {
      res.status(401).json({ error: 'missing_token', message: 'Sign in again to continue.' });
      return;
    }

    try {
      const decoded = await auth.verifyIdToken(match[1]);
      req.uid = decoded.uid;
      req.email = decoded.email;
      next();
    } catch (err) {
      // The token itself is never logged — it is a bearer credential, and an
      // expired token in a log line is a live credential for its remaining
      // seconds. Only the reason is logged.
      console.warn('[payment-server] Rejected ID token:', err instanceof Error ? err.message : err);
      res.status(401).json({ error: 'invalid_token', message: 'Sign in again to continue.' });
    }
  };
}
