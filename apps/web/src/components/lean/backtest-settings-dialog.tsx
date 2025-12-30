"use client";

import { CalendarIcon, PlusIcon, TrashIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Пресеты периодов
const PERIOD_PRESETS = [
  { label: "1 мес", months: 1 },
  { label: "3 мес", months: 3 },
  { label: "6 мес", months: 6 },
  { label: "1 год", months: 12 },
  { label: "2 года", months: 24 },
  { label: "3 года", months: 36 },
] as const;

function getDefaultDates() {
  const end = new Date();
  const start = new Date();
  start.setFullYear(start.getFullYear() - 2); // 2 года назад
  return { start, end };
}

export interface StrategyParameter {
  value: number | string;
  type: "int" | "float" | "string";
  description: string;
}

export interface StrategyConfig {
  "algorithm-language": string;
  parameters: Record<string, StrategyParameter>;
  description?: string;
}

export interface BacktestConfig {
  startDate?: string;
  endDate?: string;
  cash?: number;
  backtestName?: string;
  dataProvider?: "local" | "binance" | "quantconnect";
  parameters?: Record<string, string | number>;
}

interface BacktestSettingsDialogProps {
  strategyName: string;
  strategyConfig?: StrategyConfig | null;
  onRun: (config: BacktestConfig) => void;
  isRunning?: boolean;
  trigger?: React.ReactNode;
}

interface ParameterEntry {
  key: string;
  value: string;
  description?: string;
  type?: string;
  isFromConfig?: boolean;
}

export function BacktestSettingsDialog({
  strategyName,
  strategyConfig,
  onRun,
  isRunning = false,
  trigger,
}: BacktestSettingsDialogProps) {
  const defaultDates = useMemo(() => getDefaultDates(), []);

  // Инициализируем параметры из конфига стратегии
  const initialParameters = useMemo(() => {
    if (!strategyConfig?.parameters) return [];
    return Object.entries(strategyConfig.parameters).map(([key, param]) => ({
      key,
      value: String(param.value),
      description: param.description,
      type: param.type,
      isFromConfig: true,
    }));
  }, [strategyConfig]);

  const [open, setOpen] = useState(false);
  const [startDate, setStartDate] = useState<Date>(defaultDates.start);
  const [endDate, setEndDate] = useState<Date>(defaultDates.end);
  const [cash, setCash] = useState<string>("10000");
  const [backtestName, setBacktestName] = useState<string>("");
  const [dataProvider, setDataProvider] = useState<string>("local");
  const [parameters, setParameters] = useState<ParameterEntry[]>([]);
  const [configLoaded, setConfigLoaded] = useState(false);

  // Обновляем параметры при загрузке конфига
  // biome-ignore lint/correctness/useExhaustiveDependencies: only run when config loads
  useEffect(() => {
    if (initialParameters.length > 0 && !configLoaded) {
      setParameters(initialParameters);
      setConfigLoaded(true);
    }
  }, [initialParameters]);

  const applyPreset = (months: number) => {
    const end = new Date();
    const start = new Date();
    start.setMonth(start.getMonth() - months);
    setStartDate(start);
    setEndDate(end);
  };

  const formatDate = (date: Date | undefined) => {
    if (!date) return "Выбрать";
    return date.toLocaleDateString("ru-RU");
  };

  const toISODate = (date: Date | undefined) => {
    if (!date) return undefined;
    return date.toISOString().split("T")[0];
  };

  const addParameter = () => {
    setParameters([...parameters, { key: "", value: "" }]);
  };

  const removeParameter = (index: number) => {
    setParameters(parameters.filter((_, i) => i !== index));
  };

  const updateParameter = (
    index: number,
    field: "key" | "value",
    value: string
  ) => {
    const updated = [...parameters];
    updated[index][field] = value;
    setParameters(updated);
  };

  const handleRun = () => {
    const config: BacktestConfig = {
      startDate: toISODate(startDate),
      endDate: toISODate(endDate),
    };

    if (cash) {
      config.cash = Number.parseFloat(cash);
    }
    if (backtestName.trim()) {
      config.backtestName = backtestName.trim();
    }
    if (dataProvider !== "local") {
      config.dataProvider = dataProvider as BacktestConfig["dataProvider"];
    }

    // Собираем параметры
    const params: Record<string, string | number> = {};
    for (const param of parameters) {
      if (param.key.trim()) {
        const numValue = Number.parseFloat(param.value);
        params[param.key.trim()] = Number.isNaN(numValue)
          ? param.value
          : numValue;
      }
    }
    if (Object.keys(params).length > 0) {
      config.parameters = params;
    }

    onRun(config);
    setOpen(false);
  };

  const handleQuickRun = () => {
    onRun({});
    setOpen(false);
  };

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger
        render={
          trigger || (
            <Button disabled={isRunning} size="sm">
              {isRunning ? "Running..." : "Run Backtest"}
            </Button>
          )
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Настройки бэктеста</DialogTitle>
          <DialogDescription>
            Стратегия: <strong>{strategyName}</strong>
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {/* Имя бэктеста */}
          <div className="grid gap-1.5">
            <Label htmlFor="backtest-name">Имя бэктеста</Label>
            <Input
              id="backtest-name"
              onChange={(e) => setBacktestName(e.target.value)}
              placeholder="Опционально"
              value={backtestName}
            />
          </div>

          {/* Период - пресеты */}
          <div className="grid gap-1.5">
            <Label>Период</Label>
            <div className="flex flex-wrap gap-1">
              {PERIOD_PRESETS.map((preset) => (
                <Button
                  key={preset.months}
                  onClick={() => applyPreset(preset.months)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {preset.label}
                </Button>
              ))}
            </div>
          </div>

          {/* Период - точные даты */}
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label className="text-muted-foreground text-xs">Начало</Label>
              <Popover>
                <PopoverTrigger
                  render={
                    <Button
                      className="justify-start font-normal"
                      size="sm"
                      variant="outline"
                    >
                      <CalendarIcon className="mr-2 size-3" />
                      {formatDate(startDate)}
                    </Button>
                  }
                />
                <PopoverContent align="start" className="w-auto p-0">
                  <Calendar
                    defaultMonth={startDate}
                    mode="single"
                    onSelect={(date) => date && setStartDate(date)}
                    selected={startDate}
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-muted-foreground text-xs">Конец</Label>
              <Popover>
                <PopoverTrigger
                  render={
                    <Button
                      className="justify-start font-normal"
                      size="sm"
                      variant="outline"
                    >
                      <CalendarIcon className="mr-2 size-3" />
                      {formatDate(endDate)}
                    </Button>
                  }
                />
                <PopoverContent align="start" className="w-auto p-0">
                  <Calendar
                    defaultMonth={endDate}
                    mode="single"
                    onSelect={(date) => date && setEndDate(date)}
                    selected={endDate}
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {/* Капитал */}
          <div className="grid gap-1.5">
            <Label htmlFor="cash">Начальный капитал ($)</Label>
            <Input
              id="cash"
              onChange={(e) => setCash(e.target.value)}
              placeholder="10000"
              type="number"
              value={cash}
            />
          </div>

          {/* Data Provider */}
          <div className="grid gap-1.5">
            <Label>Источник данных</Label>
            <Select onValueChange={setDataProvider} value={dataProvider}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="local">Local (по умолчанию)</SelectItem>
                <SelectItem value="binance">Binance</SelectItem>
                <SelectItem value="quantconnect">QuantConnect</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Параметры стратегии */}
          <div className="grid gap-1.5">
            <div className="flex items-center justify-between">
              <Label>Параметры стратегии</Label>
              <Button
                onClick={addParameter}
                size="sm"
                type="button"
                variant="ghost"
              >
                <PlusIcon className="mr-1 size-3" />
                Добавить
              </Button>
            </div>
            {parameters.length === 0 && (
              <p className="text-muted-foreground text-xs">Нет параметров</p>
            )}
            {parameters.map((param, index) => (
              <div className="grid gap-1" key={index}>
                <div className="flex gap-2">
                  {param.isFromConfig ? (
                    <div className="flex flex-1 items-center">
                      <span className="min-w-[140px] font-medium text-sm">
                        {param.key}
                      </span>
                    </div>
                  ) : (
                    <Input
                      className="flex-1"
                      onChange={(e) =>
                        updateParameter(index, "key", e.target.value)
                      }
                      placeholder="Ключ"
                      value={param.key}
                    />
                  )}
                  <Input
                    className="w-24"
                    onChange={(e) =>
                      updateParameter(index, "value", e.target.value)
                    }
                    placeholder="Значение"
                    step={param.type === "float" ? "0.01" : "1"}
                    type={param.type === "string" ? "text" : "number"}
                    value={param.value}
                  />
                  {!param.isFromConfig && (
                    <Button
                      onClick={() => removeParameter(index)}
                      size="icon"
                      type="button"
                      variant="ghost"
                    >
                      <TrashIcon className="size-4" />
                    </Button>
                  )}
                </div>
                {param.description && (
                  <p className="pl-0 text-muted-foreground text-xs">
                    {param.description}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button onClick={handleQuickRun} variant="outline">
            Быстрый запуск
          </Button>
          <Button disabled={isRunning} onClick={handleRun}>
            {isRunning ? "Запуск..." : "Запустить"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
