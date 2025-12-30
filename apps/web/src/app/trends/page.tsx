import { TrendsDashboard } from "@/components/trends";

export const metadata = {
  title: "Trends | Trader",
  description: "News trends analysis and visualization",
};

export default function TrendsPage() {
  return (
    <div className="container mx-auto py-6">
      <div className="mb-6">
        <h1 className="font-bold text-3xl text-zinc-100">News Trends</h1>
        <p className="mt-1 text-zinc-400">
          Анализ трендов из новостей с помощью LLM
        </p>
      </div>
      <TrendsDashboard />
    </div>
  );
}
