"use client";

import { PlusIcon, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { useAddExchangeAccount } from "@/hooks/use-exchange";

export function AddAccountDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("Binance USD-M Testnet");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [testnet, setTestnet] = useState(true);
  const addAccount = useAddExchangeAccount();

  const reset = () => {
    setName("Binance USD-M Testnet");
    setApiKey("");
    setApiSecret("");
    setTestnet(true);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    await addAccount.mutateAsync({
      exchange: "binance",
      name,
      apiKey,
      apiSecret,
      testnet,
    });
    setOpen(false);
    reset();
  };

  return (
    <Dialog
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
      open={open}
    >
      <DialogTrigger render={<Button size="sm" />}>
        <PlusIcon className="mr-1 size-4" /> Подключить Binance
      </DialogTrigger>
      <DialogContent className="sm:max-w-[460px]">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Binance USD-M Futures</DialogTitle>
            <DialogDescription>
              Терминал поддерживает только Binance USD-M. Ключи шифруются перед
              сохранением; вывод средств API-ключу не требуется.
            </DialogDescription>
          </DialogHeader>

          <div className="my-4 rounded-xl border border-primary/25 bg-primary/5 p-3">
            <div className="flex items-start gap-2">
              <ShieldCheck className="mt-0.5 size-4 text-primary" />
              <p className="text-muted-foreground text-xs leading-5">
                По умолчанию используется testnet. Live account backend примет
                только при явном ALLOW_LIVE_TRADING=true.
              </p>
            </div>
          </div>

          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="account-name">Название</Label>
              <Input
                id="account-name"
                maxLength={80}
                onChange={(event) => setName(event.target.value)}
                required
                value={name}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="api-key">API key</Label>
              <Input
                autoComplete="off"
                id="api-key"
                onChange={(event) => setApiKey(event.target.value)}
                required
                value={apiKey}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="api-secret">API secret</Label>
              <Input
                autoComplete="new-password"
                id="api-secret"
                onChange={(event) => setApiSecret(event.target.value)}
                required
                type="password"
                value={apiSecret}
              />
            </div>
            <div className="flex items-start gap-2 rounded-lg border p-3">
              <Checkbox
                checked={testnet}
                id="testnet"
                onCheckedChange={(checked) => setTestnet(checked === true)}
              />
              <div>
                <Label htmlFor="testnet">Binance Futures Testnet</Label>
                <p className="mt-1 text-muted-foreground text-xs">
                  Обязательно для первой forward-проверки.
                </p>
              </div>
            </div>
          </div>

          {addAccount.isError ? (
            <p className="mt-2 text-destructive text-sm">
              {addAccount.error.message}
            </p>
          ) : null}

          <DialogFooter className="mt-4">
            <Button onClick={() => setOpen(false)} type="button" variant="outline">
              Отмена
            </Button>
            <Button disabled={addAccount.isPending} type="submit">
              {addAccount.isPending ? "Проверка preflight…" : "Подключить"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
