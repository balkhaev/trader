"use client";

import { PlusIcon } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAddExchangeAccount } from "@/hooks/use-exchange";

export function AddAccountDialog() {
  const [open, setOpen] = useState(false);
  const [exchange, setExchange] = useState<"bybit" | "binance" | "tinkoff">(
    "bybit"
  );
  const [name, setName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [testnet, setTestnet] = useState(false);

  const addAccount = useAddExchangeAccount();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      await addAccount.mutateAsync({
        exchange,
        name,
        apiKey,
        apiSecret,
        testnet,
      });

      setOpen(false);
      resetForm();
    } catch (error) {
      // Error handled by mutation
    }
  };

  const resetForm = () => {
    setExchange("bybit");
    setName("");
    setApiKey("");
    setApiSecret("");
    setTestnet(false);
  };

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger render={<Button />}>
        <PlusIcon className="mr-2 h-4 w-4" />
        Add Exchange
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Add Exchange Account</DialogTitle>
            <DialogDescription>
              Connect your exchange account using API keys. We encrypt all keys
              before storing.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="exchange">Exchange</Label>
              <Select
                onValueChange={(v) => setExchange(v as typeof exchange)}
                value={exchange}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select exchange" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bybit">Bybit</SelectItem>
                  <SelectItem disabled value="binance">
                    Binance (Coming soon)
                  </SelectItem>
                  <SelectItem disabled value="tinkoff">
                    Tinkoff (Coming soon)
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="name">Account Name</Label>
              <Input
                id="name"
                onChange={(e) => setName(e.target.value)}
                placeholder="My Trading Account"
                required
                value={name}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="apiKey">API Key</Label>
              <Input
                id="apiKey"
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Enter your API key"
                required
                value={apiKey}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="apiSecret">API Secret</Label>
              <Input
                id="apiSecret"
                onChange={(e) => setApiSecret(e.target.value)}
                placeholder="Enter your API secret"
                required
                type="password"
                value={apiSecret}
              />
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                checked={testnet}
                id="testnet"
                onCheckedChange={(checked) => setTestnet(checked === true)}
              />
              <Label className="font-normal text-sm" htmlFor="testnet">
                Use Testnet (for testing with fake funds)
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={() => setOpen(false)}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button disabled={addAccount.isPending} type="submit">
              {addAccount.isPending ? "Connecting..." : "Connect"}
            </Button>
          </DialogFooter>
          {addAccount.isError && (
            <p className="mt-2 text-red-500 text-sm">
              {addAccount.error.message}
            </p>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
