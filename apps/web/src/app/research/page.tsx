import {
  BookOpenCheck,
  CheckCircle2,
  Database,
  FlaskConical,
  GitBranch,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { PageLayout, StatItem, StatRow } from "@/components/layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TerminalPanel } from "@/components/ui/terminal-panel";

const rejected = [
  ["HF90 official replay", "2 739 сделок", "−13.87 bps · PF 0.69"],
  ["Donchian / trend breakout", "96 конфигураций", "около −23…−24 bps"],
  ["OI continuation", "2–8h hold", "−18…−26 bps"],
  ["OI squeeze breakout", "64 конфигурации", "около −24…−27 bps"],
  ["1m taker-flow", ">23 000 сделок", "около −18.6 bps"],
  ["Cross-sectional / stat-arb", "несколько семейств", "не пережили 20 bps"],
  ["Coin-specific US-open", "251 позднее событие", "−11.32% account"],
  ["Pooled altcoin ML", "215 поздних сделок", "провал в 2026H1"],
];

export default function ResearchLedgerPage() {
  return (
    <PageLayout
      actions={
        <div className="flex gap-2">
          <Link href="/validation">
            <Button size="sm" variant="outline">
              Forward gate
            </Button>
          </Link>
          <Link href="/strategy-builder">
            <Button size="sm">Strategy blueprint</Button>
          </Link>
        </div>
      }
      subtitle="Почему в production остались только WIF, DOT и каузальный Risk Accelerator"
      title="Research Ledger"
    >
      <section className="strategy-grid overflow-hidden rounded-2xl border bg-card/80 p-5 sm:p-7">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="default">2 MODULES ACCEPTED</Badge>
          <Badge variant="outline">20 BPS COST MODEL</Badge>
          <Badge variant="outline">NO GENERIC BUILDER</Badge>
        </div>
        <h2 className="mt-5 max-w-4xl font-semibold text-2xl tracking-tight sm:text-3xl">
          Фронт показывает не набор идей, а результат последовательного отсева.
        </h2>
        <p className="mt-3 max-w-4xl text-muted-foreground text-sm leading-6">
          Большинство высокочастотных, трендовых, funding, basis, OI и ML веток
          оказалось отрицательным после издержек или не перенеслось между
          периодами. WIF и DOT оставлены как разные экономические механизмы, а
          риск повышается только после закрытой прибыли.
        </p>
      </section>

      <StatRow className="mt-4 md:grid-cols-5">
        <StatItem label="Accepted modules" value="2" />
        <StatItem label="Primary timeframe" value="15m" />
        <StatItem label="Execution venue" value="Binance USD-M" />
        <StatItem label="Cost reserve" value="20 bps" />
        <StatItem label="Maximum positions" value="2" />
      </StatRow>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <TerminalPanel
          subtitle="Accepted coin-specific route"
          title="WIF OI Flush Reclaim"
        >
          <div className="space-y-4 p-4">
            <div className="flex items-start gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10">
                <CheckCircle2 className="size-5 text-primary" />
              </div>
              <div>
                <p className="font-medium">Редкий ликвидационный reversal</p>
                <p className="mt-1 text-muted-foreground text-xs leading-5">
                  Цена резко падает, объём растёт, open interest сокращается,
                  свеча возвращается от минимума. Consensus weekdays:
                  Tue/Fri/Sun.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg border bg-background/40 p-3">
                <div className="font-mono text-lg">1.25 ATR</div>
                <div className="text-[9px] text-muted-foreground uppercase">
                  stop
                </div>
              </div>
              <div className="rounded-lg border bg-background/40 p-3">
                <div className="font-mono text-lg">5R</div>
                <div className="text-[9px] text-muted-foreground uppercase">
                  target
                </div>
              </div>
              <div className="rounded-lg border bg-background/40 p-3">
                <div className="font-mono text-lg">60m</div>
                <div className="text-[9px] text-muted-foreground uppercase">
                  exit
                </div>
              </div>
            </div>
            <p className="rounded-xl border border-yellow-500/25 bg-yellow-500/5 p-3 text-muted-foreground text-xs leading-5">
              Сильная историческая асимметрия, но низкая частота. Модуль не
              способен самостоятельно обеспечить стабильные 100% CAGR.
            </p>
          </div>
        </TerminalPanel>

        <TerminalPanel
          subtitle="Accepted funding route"
          title="DOT Negative Funding Rebound"
        >
          <div className="space-y-4 p-4">
            <div className="flex items-start gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-yellow-500/10">
                <CheckCircle2 className="size-5 text-yellow-500" />
              </div>
              <div>
                <p className="font-medium">Post-funding price drift</p>
                <p className="mt-1 text-muted-foreground text-xs leading-5">
                  Long открывается через 15 минут после уже опубликованной
                  отрицательной ставки. Использование будущего funding
                  исключено.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg border bg-background/40 p-3">
                <div className="font-mono text-lg">6 ATR</div>
                <div className="text-[9px] text-muted-foreground uppercase">
                  stop
                </div>
              </div>
              <div className="rounded-lg border bg-background/40 p-3">
                <div className="font-mono text-lg">2R</div>
                <div className="text-[9px] text-muted-foreground uppercase">
                  target
                </div>
              </div>
              <div className="rounded-lg border bg-background/40 p-3">
                <div className="font-mono text-lg">8h</div>
                <div className="text-[9px] text-muted-foreground uppercase">
                  exit
                </div>
              </div>
            </div>
            <p className="rounded-xl border border-yellow-500/25 bg-yellow-500/5 p-3 text-muted-foreground text-xs leading-5">
              Широкий стоп создаёт gap-риск. Поэтому DOT нельзя масштабировать
              без gross cap, hard stop и отдельного forward-подтверждения.
            </p>
          </div>
        </TerminalPanel>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <TerminalPanel
          subtitle="Не скрываются из интерфейса исследования"
          title="Rejected branches"
        >
          <div className="divide-y divide-border/60">
            {rejected.map(([name, sample, result]) => (
              <div
                className="grid gap-2 px-4 py-3 sm:grid-cols-[1fr_0.7fr_0.9fr_auto] sm:items-center"
                key={name}
              >
                <div className="flex items-center gap-2 text-sm">
                  <XCircle className="size-4 text-destructive" />
                  {name}
                </div>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {sample}
                </span>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {result}
                </span>
                <Badge variant="destructive">REJECT</Badge>
              </div>
            ))}
          </div>
        </TerminalPanel>

        <div className="space-y-4">
          <TerminalPanel title="Evidence hierarchy">
            <div className="p-4">
              <div className="flex items-start gap-3 border-border/60 border-b pb-3">
                <Database className="mt-0.5 size-4 text-primary" />
                <div>
                  <p className="text-sm">Official market archives</p>
                  <p className="mt-1 text-muted-foreground text-xs">
                    Binance USD-M klines, OI, premium, funding.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 border-border/60 border-b py-3">
                <GitBranch className="mt-0.5 size-4 text-primary" />
                <div>
                  <p className="text-sm">Period separation</p>
                  <p className="mt-1 text-muted-foreground text-xs">
                    Маршруты фиксировались до позднего календаря.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 pt-3">
                <ShieldAlert className="mt-0.5 size-4 text-yellow-500" />
                <div>
                  <p className="text-sm">Forward evidence still required</p>
                  <p className="mt-1 text-muted-foreground text-xs">
                    Post-selection остаётся главным ограничением.
                  </p>
                </div>
              </div>
            </div>
          </TerminalPanel>

          <TerminalPanel title="100% CAGR interpretation">
            <div className="space-y-3 p-4 text-xs leading-5">
              <p className="text-muted-foreground">
                Исторический Risk Accelerator пересёк +100% на позднем году, но
                при сокращении наблюдаемого edge вдвое медианная модель
                снижалась примерно до однозначной доходности.
              </p>
              <p className="rounded-xl border bg-background/40 p-3">
                Плановая область до нового forward-календаря:{" "}
                <strong>25–40%</strong>. Сильный режим: <strong>60–100%</strong>
                . 100% не являются гарантией.
              </p>
            </div>
          </TerminalPanel>

          <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
            <div className="flex items-start gap-3">
              <BookOpenCheck className="mt-0.5 size-5 text-primary" />
              <div>
                <p className="font-medium text-sm">
                  Frontend mirrors the strategy contract
                </p>
                <p className="mt-1 text-muted-foreground text-xs leading-5">
                  В UI больше нет builder для случайных индикаторов,
                  AI-сигналов, prediction markets или news-driven execution.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </PageLayout>
  );
}
