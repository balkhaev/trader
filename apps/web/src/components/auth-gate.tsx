"use client";

import { LogIn, RefreshCw } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PageLoading } from "@/components/layout";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { authClient } from "@/lib/auth-client";

const PUBLIC_ROUTE_PREFIXES = ["/research"] as const;

function isPublicRoute(pathname: string): boolean {
  if (pathname === "/login") {
    return true;
  }

  return PUBLIC_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

function SessionError() {
  return (
    <div className="p-3 sm:p-4">
      <Empty className="min-h-[calc(100svh-5.5rem)]">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <RefreshCw />
          </EmptyMedia>
          <EmptyTitle>Не удалось проверить сессию</EmptyTitle>
          <EmptyDescription>
            Сервер авторизации временно не ответил. Повторите запрос.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={() => window.location.reload()} variant="outline">
            <RefreshCw data-icon="inline-start" />
            Повторить
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  );
}

function SignInRequired() {
  return (
    <div className="p-3 sm:p-4">
      <Empty className="min-h-[calc(100svh-5.5rem)]">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <LogIn />
          </EmptyMedia>
          <EmptyTitle>Войдите в торговый терминал</EmptyTitle>
          <EmptyDescription>
            Стратегия, сигналы и исполнение доступны после авторизации.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button asChild>
            <Link href="/login">
              <LogIn data-icon="inline-start" />
              Войти
            </Link>
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  );
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { data: session, error, isPending } = authClient.useSession();

  if (isPublicRoute(pathname)) {
    return children;
  }

  if (isPending) {
    return (
      <div className="p-3 sm:p-4">
        <PageLoading count={6} variant="cards" />
      </div>
    );
  }

  if (error) {
    return <SessionError />;
  }

  if (!session) {
    return <SignInRequired />;
  }

  return children;
}
