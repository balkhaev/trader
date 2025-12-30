"use client";

import { CheckIcon, ChevronsUpDownIcon, XIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface SymbolMultiSelectProps {
  value: string[];
  onChange: (symbols: string[]) => void;
  availableSymbols: string[];
  loading?: boolean;
  placeholder?: string;
  disabled?: boolean;
}

export function SymbolMultiSelect({
  value,
  onChange,
  availableSymbols,
  loading = false,
  placeholder = "Выберите символы...",
  disabled = false,
}: SymbolMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filteredSymbols = useMemo(() => {
    if (!search) {
      return availableSymbols;
    }
    return availableSymbols.filter((symbol) =>
      symbol.toLowerCase().includes(search.toLowerCase())
    );
  }, [availableSymbols, search]);

  const toggleSymbol = (symbol: string) => {
    if (value.includes(symbol)) {
      onChange(value.filter((s) => s !== symbol));
    } else {
      onChange([...value, symbol]);
    }
  };

  const removeSymbol = (symbol: string) => {
    onChange(value.filter((s) => s !== symbol));
  };

  return (
    <div className="space-y-2">
      <Popover onOpenChange={setOpen} open={open}>
        <PopoverTrigger
          render={
            <Button
              className="w-full justify-between"
              disabled={disabled || loading}
              variant="outline"
            >
              <span className="text-muted-foreground">
                {loading ? "Загрузка..." : placeholder}
              </span>
              <ChevronsUpDownIcon className="ml-2 size-4 shrink-0 opacity-50" />
            </Button>
          }
        />
        <PopoverContent align="start" className="w-[300px] p-0">
          <Command>
            <CommandInput
              onValueChange={setSearch}
              placeholder="Поиск символа..."
              value={search}
            />
            <CommandList>
              <CommandEmpty>Символы не найдены</CommandEmpty>
              <CommandGroup>
                {filteredSymbols.map((symbol) => {
                  const isSelected = value.includes(symbol);
                  return (
                    <CommandItem
                      data-checked={isSelected}
                      key={symbol}
                      onSelect={() => toggleSymbol(symbol)}
                      value={symbol}
                    >
                      <span>{symbol}</span>
                      <CheckIcon
                        className={cn(
                          "ml-auto size-4",
                          isSelected ? "opacity-100" : "opacity-0"
                        )}
                      />
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {/* Selected symbols */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map((symbol) => (
            <Badge className="gap-1 pr-1" key={symbol} variant="secondary">
              {symbol}
              <button
                className="rounded-full p-0.5 hover:bg-muted-foreground/20"
                onClick={() => removeSymbol(symbol)}
                type="button"
              >
                <XIcon className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      {value.length > 0 && value.length < 2 && (
        <p className="text-destructive text-xs">Минимум 2 символа</p>
      )}
    </div>
  );
}
