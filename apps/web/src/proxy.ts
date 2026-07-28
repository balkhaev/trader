import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const FORWARD_PREFIXES = ["/backtests"];

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (path === "/exchanges") return NextResponse.next();
  const destination = FORWARD_PREFIXES.some((prefix) => path.startsWith(prefix))
    ? "/validation"
    : path.startsWith("/exchanges/")
      ? "/exchanges"
      : "/research";
  return NextResponse.redirect(new URL(destination, request.url));
}

export const config = {
  matcher: [
    "/agents/:path*",
    "/markets/:path*",
    "/market/:path*",
    "/prediction-markets/:path*",
    "/polymarket/:path*",
    "/news/:path*",
    "/trends/:path*",
    "/transport/:path*",
    "/intelligence/:path*",
    "/backtests/:path*",
    "/data/:path*",
    "/my/:path*",
    "/exchanges/:path*",
  ],
};
