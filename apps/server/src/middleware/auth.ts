import { auth } from "@trader/auth";
import type { Context, Next } from "hono";
import { UnauthorizedError } from "./error-handler";

export type User = {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  image?: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Get current user from session (optional)
 * Returns null if not authenticated
 */
export async function getUser(c: Context): Promise<User | null> {
  try {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    return session?.user ?? null;
  } catch {
    return null;
  }
}

/**
 * Middleware that requires authentication
 * Throws UnauthorizedError if user is not authenticated
 */
export async function requireAuth(c: Context, next: Next): Promise<void> {
  const user = await getUser(c);

  if (!user) {
    throw new UnauthorizedError("Authentication required");
  }

  // Store user in context for handlers
  c.set("user", user);

  await next();
}

/**
 * Middleware that optionally loads user
 * Does not throw if not authenticated, just sets user to null
 */
export async function optionalAuth(c: Context, next: Next): Promise<void> {
  const user = await getUser(c);
  c.set("user", user);
  await next();
}

/**
 * Get user from context (set by requireAuth middleware)
 * Throws if user is not set (should only be called after requireAuth)
 */
export function getUserFromContext(c: Context): User {
  const user = c.get("user") as User | undefined;

  if (!user) {
    throw new UnauthorizedError("User not found in context");
  }

  return user;
}

/**
 * Type guard to check if user is authenticated
 */
export function isAuthenticated(c: Context): boolean {
  return c.get("user") != null;
}
