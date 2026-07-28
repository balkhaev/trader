import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const FORWARD_PREFIXES = ["/backtests"];

export function proxy(request: NextRequest) {
  const destination = FORWARD_PREFIXES.some((prefix) =>
    request.nextUrl.pathname.startsWith(prefix)
  )
    ? "/validation"
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
  ],
};
