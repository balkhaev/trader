"use client";

import {
  Activity,
  ArrowRight,
  Bot,
  CheckCircle2,
  KeyRound,
  Play,
  ShieldCheck,
  Square,
  WalletCards,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { PageLoading } from "@/components/layout";
import { OpenPositionsTable } from "@/components/trading/open-positions-table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import {
  type ExecutionMode,
  useAutoTradingConfig,
  useAutoTradingDashboard,
  useAutoTradingLogs,
  useExecutionPreflight,
  useStartAutoTrading,
  useStopAutoTrading,
} from "@/hooks/use-auto-trading";
import {
  useAddExchangeAccount,
  useExchangeAccounts,
} from "@/hooks/use-exchange";
import { cn } from "@/lib/utils";

const EquityCurveChart = dynamic(
  () =>
    import("@/components/trading/equity-curve-chart").then(
      (module) => module.EquityCurveChart
    ),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[280px] w-full" />,
  }
);

const moneyFormatter = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

const percentFormatter = new Intl.NumberFormat("ru-RU", {
  maximumFractionDigits: 2,
});

const signedPercentFormatter = new Intl.NumberFormat("ru-RU", {
  signDisplay: "exceptZero",
  maximumFractionDigits: 2,
});

const LOG_LABELS: Record<string, string> = {
  executed: "Сделка открыта",
  closed: "Сделка закрыта",
  skipped: "Сигнал пропущен",
  error: "Ошибка",
};

function money(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  return moneyFormatter.format(value);
}

function percent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  return `${percentFormatter.format(value)}%`;
}

function signedPercent(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  return `${signedPercentFormatter.format(value)}%`;
}

function PendingLabel({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Spinner data-icon="inline-start" />
      {children}
    </>
  );
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: The home page intentionally owns the two exclusive launch and running states.
export default function TradingHomePage() {
  const config = useAutoTradingConfig();
  const preflight = useExecutionPreflight();
  const dashboard = useAutoTradingDashboard(Boolean(config.data?.enabled));
  const logs = useAutoTradingLogs(5);
  const accounts = useExchangeAccounts();
  const addAccount = useAddExchangeAccount();
  const start = useStartAutoTrading();
  const stop = useStopAutoTrading();
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [testnet, setTestnet] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);

  const launch = async (mode: ExecutionMode, exchangeAccountId?: string) => {
    setFormError(null);
    try {
      await start.mutateAsync({ mode, exchangeAccountId });
      toast.success(
        mode === "paper" ? "Paper-торговля запущена" : "Binance подключён"
      );
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "Не удалось запустить"
      );
    }
  };

  const connectAndLaunch = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    try {
      const account = await addAccount.mutateAsync({
        exchange: "binance",
        name: testnet ? "Binance Testnet" : "Binance Live",
        apiKey: apiKey.trim(),
        apiSecret: apiSecret.trim(),
        testnet,
      });
      await start.mutateAsync({
        mode: "exchange",
        exchangeAccountId: account.id,
      });
      setApiKey("");
      setApiSecret("");
      toast.success("Binance подключён, торговля запущена");
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "Не удалось подключить Binance"
      );
    }
  };

  if (config.isLoading || accounts.isLoading || !config.data) {
    return (
      <div className="p-4 sm:p-6">
        <PageLoading count={2} variant="cards" />
      </div>
    );
  }

  if (config.data.enabled) {
    const mode =
      preflight.data?.mode ??
      (config.data.exchangeAccountId ? "exchange" : "paper");
    const isPaper = mode === "paper";
    return (
      <div className="mx-auto max-w-5xl p-4 sm:p-6 lg:py-10">
        <section aria-labelledby="running-title" className="space-y-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <Badge variant="secondary">
                <Activity data-icon="inline-start" />
                {isPaper
                  ? "Paper"
                  : (preflight.data?.account?.name ?? "Binance")}
              </Badge>
              <h1
                className="mt-3 font-semibold text-2xl tracking-tight"
                id="running-title"
              >
                Торговля запущена
              </h1>
              <p className="mt-2 max-w-2xl text-muted-foreground text-sm">
                Бот проверяет WIF и DOT каждые 15 минут и сам управляет
                сделками.
                {isPaper
                  ? " Реальные деньги не используются."
                  : " Ордера отправляются в Binance."}
              </p>
            </div>
            <Button
              disabled={stop.isPending}
              onClick={async () => {
                await stop.mutateAsync();
                toast.success("Новые сделки остановлены");
              }}
              variant="outline"
            >
              {stop.isPending ? (
                <PendingLabel>Останавливаем…</PendingLabel>
              ) : (
                <>
                  <Square data-icon="inline-start" />
                  Остановить
                </>
              )}
            </Button>
          </div>

          <div className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-4">
            <div className="bg-card p-4">
              <p className="text-muted-foreground text-xs">Капитал</p>
              <p className="mt-1 font-mono font-semibold text-xl">
                {money(dashboard.data?.equity ?? preflight.data?.equity)}
              </p>
            </div>
            <div className="bg-card p-4">
              <p className="text-muted-foreground text-xs">Общий результат</p>
              <p className="mt-1 font-mono font-semibold text-xl">
                {money(dashboard.data?.totalPnl)}
              </p>
              <p className="mt-1 font-mono text-muted-foreground text-xs tabular-nums">
                {signedPercent(dashboard.data?.totalPnlPercent)}
              </p>
            </div>
            <div className="bg-card p-4">
              <p className="text-muted-foreground text-xs">Открыто позиций</p>
              <p className="mt-1 font-mono font-semibold text-xl">
                {dashboard.data?.positions.length ??
                  preflight.data?.positions ??
                  0}
              </p>
            </div>
            <div className="bg-card p-4">
              <p className="text-muted-foreground text-xs">Успешных сделок</p>
              <p className="mt-1 font-mono font-semibold text-xl">
                {percent(dashboard.data?.winRate)}
              </p>
              <p className="mt-1 text-muted-foreground text-xs">
                Закрыто: {dashboard.data?.closedTrades ?? 0}
              </p>
            </div>
          </div>

          {dashboard.isError ? (
            <Alert>
              <AlertTitle>Статистика временно не обновилась</AlertTitle>
              <AlertDescription>
                {dashboard.error.message}. Бот продолжает работать; следующая
                попытка будет через 30 секунд.
              </AlertDescription>
            </Alert>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Капитал</CardTitle>
              <CardDescription>
                Закрытые сделки и текущий плавающий результат.
              </CardDescription>
              {dashboard.data ? (
                <CardAction>
                  <Badge
                    variant={
                      dashboard.data.totalPnl < 0 ? "destructive" : "secondary"
                    }
                  >
                    {signedPercent(dashboard.data.totalPnlPercent)}
                  </Badge>
                </CardAction>
              ) : null}
            </CardHeader>
            <CardContent>
              {dashboard.data ? (
                <div className="flex flex-col gap-4">
                  <EquityCurveChart data={dashboard.data.equityCurve} />
                  <div className="flex flex-wrap gap-x-6 gap-y-2 border-t pt-4 text-xs">
                    <p className="text-muted-foreground">
                      Реализовано:{" "}
                      <span className="font-mono text-foreground tabular-nums">
                        {money(dashboard.data.realizedPnl)}
                      </span>
                    </p>
                    <p className="text-muted-foreground">
                      В открытых позициях:{" "}
                      <span className="font-mono text-foreground tabular-nums">
                        {money(dashboard.data.unrealizedPnl)}
                      </span>
                    </p>
                  </div>
                </div>
              ) : (
                <Skeleton className="h-[328px] w-full" />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Открытые позиции</CardTitle>
              <CardDescription>
                Цена входа, текущая котировка, P&amp;L и защитные уровни.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              {dashboard.data ? (
                <OpenPositionsTable positions={dashboard.data.positions} />
              ) : (
                <Skeleton className="mx-6 h-48 w-auto" />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Последние события</CardTitle>
              <CardDescription>
                Здесь появятся открытия, закрытия и ошибки.
              </CardDescription>
              <CardAction>
                <Link
                  className={buttonVariants({ size: "sm", variant: "ghost" })}
                  href="/auto-trading"
                >
                  Настройки
                  <ArrowRight data-icon="inline-end" />
                </Link>
              </CardAction>
            </CardHeader>
            <CardContent>
              {logs.data?.logs.length ? (
                <div className="divide-y">
                  {logs.data.logs.map((log) => (
                    <div
                      className="flex items-start justify-between gap-4 py-3"
                      key={log.id}
                    >
                      <div>
                        <p className="font-medium">{LOG_LABELS[log.action]}</p>
                        <p className="mt-0.5 text-muted-foreground">
                          {log.reason}
                        </p>
                      </div>
                      <time className="shrink-0 font-mono text-muted-foreground text-xs">
                        {new Date(log.createdAt).toLocaleTimeString("ru-RU", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </time>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-8 text-center text-muted-foreground">
                  Первый сигнал появится здесь автоматически.
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      </div>
    );
  }

  const enabledAccounts = (accounts.data ?? []).filter(
    (account) => account.enabled
  );
  const busy = start.isPending || addAccount.isPending;

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6 lg:py-10">
      <section aria-labelledby="start-title">
        <div className="max-w-2xl">
          <Badge variant="outline">
            <Bot data-icon="inline-start" />
            Автоторговля
          </Badge>
          <h1
            className="mt-3 font-semibold text-2xl tracking-tight sm:text-3xl"
            id="start-title"
          >
            Как будем торговать?
          </h1>
          <p className="mt-2 text-muted-foreground text-sm sm:text-base">
            Начните без риска в Paper или подключите Binance. Стратегия и
            ограничения уже настроены.
          </p>
        </div>

        {formError ? (
          <Alert className="mt-6" variant="destructive">
            <AlertTitle>Не удалось запустить</AlertTitle>
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}

        <div className="mt-6 grid items-start gap-4 lg:grid-cols-2">
          <Card className="min-h-full">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <WalletCards className="size-4 text-primary" />
                Paper
              </CardTitle>
              <CardDescription>
                Без ключей, без пополнения и без риска.
              </CardDescription>
              <CardAction>
                <Badge variant="secondary">Рекомендуется</Badge>
              </CardAction>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="border bg-muted/30 p-4">
                <p className="text-muted-foreground text-xs">
                  Виртуальный баланс
                </p>
                <p className="mt-1 font-mono font-semibold text-2xl">$10 000</p>
              </div>
              <ul className="space-y-3 text-sm">
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
                  Реальные котировки WIF и DOT
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
                  Виртуальные позиции и честный P&amp;L с комиссиями
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
                  Можно остановить в любой момент
                </li>
              </ul>
            </CardContent>
            <CardFooter>
              <Button
                className="w-full"
                disabled={busy}
                onClick={() => launch("paper")}
                size="lg"
              >
                {start.isPending ? (
                  <PendingLabel>Запускаем…</PendingLabel>
                ) : (
                  <>
                    <Play data-icon="inline-start" />
                    Запустить Paper
                  </>
                )}
              </Button>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <KeyRound className="size-4 text-primary" />
                Binance
              </CardTitle>
              <CardDescription>
                Бот проверит ключи и только потом включит торговлю.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {enabledAccounts.length > 0 ? (
                <div className="space-y-3">
                  <p className="font-medium">Уже подключено</p>
                  {enabledAccounts.map((account) => (
                    <Button
                      className="w-full justify-between"
                      disabled={busy}
                      key={account.id}
                      onClick={() => launch("exchange", account.id)}
                      variant="outline"
                    >
                      <span>{account.name}</span>
                      <span className="text-muted-foreground">
                        {account.testnet ? "Testnet" : "Live"}
                      </span>
                    </Button>
                  ))}
                  <Separator className="my-5" />
                  <p className="font-medium">Другой аккаунт</p>
                </div>
              ) : null}

              <form className="mt-4" onSubmit={connectAndLaunch}>
                <FieldGroup>
                  <Field data-invalid={Boolean(formError)}>
                    <FieldLabel htmlFor="binance-api-key">API key</FieldLabel>
                    <Input
                      autoCapitalize="none"
                      autoComplete="off"
                      id="binance-api-key"
                      name="apiKey"
                      onChange={(event) => setApiKey(event.target.value)}
                      required
                      spellCheck={false}
                      value={apiKey}
                    />
                  </Field>
                  <Field data-invalid={Boolean(formError)}>
                    <FieldLabel htmlFor="binance-api-secret">
                      Secret key
                    </FieldLabel>
                    <Input
                      autoCapitalize="none"
                      autoComplete="new-password"
                      id="binance-api-secret"
                      name="apiSecret"
                      onChange={(event) => setApiSecret(event.target.value)}
                      required
                      spellCheck={false}
                      type="password"
                      value={apiSecret}
                    />
                    <FieldError>{formError}</FieldError>
                  </Field>
                  <Field orientation="horizontal">
                    <FieldLabel htmlFor="binance-testnet">
                      <span>
                        Testnet
                        <FieldDescription>
                          Тестовый аккаунт Binance Futures.
                        </FieldDescription>
                      </span>
                    </FieldLabel>
                    <Switch
                      checked={testnet}
                      id="binance-testnet"
                      onCheckedChange={setTestnet}
                    />
                  </Field>
                </FieldGroup>

                <Alert className="mt-5">
                  <ShieldCheck />
                  <AlertTitle>Ключи зашифрованы</AlertTitle>
                  <AlertDescription>
                    Нужны только Futures и Trading. Никогда не включайте вывод
                    средств.
                  </AlertDescription>
                </Alert>

                <Button
                  className="mt-5 w-full"
                  disabled={busy}
                  size="lg"
                  type="submit"
                >
                  {busy ? (
                    <PendingLabel>Проверяем ключи…</PendingLabel>
                  ) : (
                    <>
                      <Play data-icon="inline-start" />
                      Подключить и запустить
                    </>
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>

        <p className="mt-5 text-center text-muted-foreground text-xs">
          Расширенные лимиты и диагностика доступны в{" "}
          <Link
            className={cn(
              "underline underline-offset-4",
              "hover:text-foreground"
            )}
            href="/auto-trading"
          >
            настройках
          </Link>
          .
        </p>
      </section>
    </div>
  );
}
