# Transport Service

> Базовая информация в [AGENTS.md](../AGENTS.md#transport-service)

Анализ транспортных потоков для прогнозирования цен на сырьевые товары.

## Полный маппинг типов судов

```typescript
const VESSEL_TYPE_TO_COMMODITY = {
  // Танкеры
  tanker_crude: ["crude_oil", "brent"],
  tanker_product: ["gasoline", "diesel", "jet_fuel"],
  tanker_lng: ["lng", "natural_gas"],
  tanker_lpg: ["lpg", "propane"],
  tanker_chemical: ["chemicals"],
  
  // Балкеры
  bulk_carrier: ["wheat", "corn", "soybeans", "rice", "coal", "iron_ore"],
  bulk_grain: ["wheat", "corn", "soybeans", "rice"],
  bulk_ore: ["iron_ore", "coal", "bauxite"],
  
  // Контейнеры
  container: ["container_freight"],
  container_feeder: ["container_freight"],
  
  // Специализированные
  reefer: ["frozen_food", "produce"],
  ro_ro: ["automobiles"],
  car_carrier: ["automobiles"],
  livestock: ["cattle"],
};
```

## Полный маппинг товаров → тикеров

```typescript
const COMMODITY_TO_TICKERS = {
  // Энергоносители
  crude_oil: ["CL", "USO", "XLE", "OIL"],
  brent: ["BZ", "BNO"],
  natural_gas: ["NG", "UNG", "BOIL"],
  lng: ["LNG", "GLNG"],
  gasoline: ["RB", "UGA"],
  diesel: ["HO"],
  
  // Зерновые
  wheat: ["ZW", "WEAT"],
  corn: ["ZC", "CORN"],
  soybeans: ["ZS", "SOYB"],
  rice: ["ZR"],
  
  // Металлы и руды
  iron_ore: ["VALE", "RIO", "BHP", "CLF"],
  coal: ["BTU", "ARCH", "CEIX"],
  
  // Прочее
  container_freight: ["ZIM", "DAC", "MATX"],
  automobiles: ["F", "GM", "TM"],
};
```

## Геозоны мониторинга

| Регион | Координаты (lat, lon, radius km) | Товары |
|--------|----------------------------------|--------|
| Persian Gulf | 26.5, 52.0, 500 | Нефть, газ |
| US Gulf | 27.5, -91.0, 400 | Нефтепродукты, зерно |
| West Africa | 4.0, 5.0, 600 | Нефть |
| North Sea | 58.0, 2.0, 400 | Brent crude |
| Baltic Sea | 58.0, 20.0, 500 | Зерно, уголь |
| Singapore Strait | 1.3, 104.0, 200 | Контейнеры, LNG |
| Suez Canal | 30.5, 32.3, 100 | Транзит |
| Panama Canal | 9.0, -79.5, 50 | Транзит |
| Australia East | -25.0, 153.0, 500 | Руда, уголь |
| China Coast | 31.0, 122.0, 600 | Импорт всего |

## Алгоритм генерации сигналов

```typescript
interface AnomalyDetection {
  // Сравнение текущего объёма с историческим средним
  currentCount: number;      // Количество судов за период
  avgCount: number;          // Среднее за аналогичные периоды
  deviation: number;         // Отклонение в стд. отклонениях
  threshold: number;         // Порог для сигнала (обычно 2.0)
  
  // Результат
  isAnomaly: boolean;        // deviation > threshold
  direction: "surge" | "decline";
}
```

## Примеры использования

### В signals service

```typescript
import { transportService } from "@/services/transport";

const signals = await transportService.getSignals({
  commodity: "crude_oil",
  direction: "bullish",
});

for (const signal of signals) {
  // signal.affectedTickers: ["CL", "USO", "XLE"]
  // Создать позицию или алерт
}
```

### Анализ активности

```typescript
import { flowAnalyzer } from "@/services/transport/analyzers";

// Активность по регионам
const activity = await flowAnalyzer.getRegionActivity();
// { "Persian Gulf": 145, "US Gulf": 89, ... }

// Объёмы по товарам за 7 дней
const volumes = await flowAnalyzer.getCommodityVolumes(7);
// { crude_oil: 234, wheat: 156, ... }

// Обнаружение аномалии
const anomaly = await flowAnalyzer.detectVolumeAnomaly("tanker_crude", 7);
// { currentCount: 45, avgCount: 32, deviation: 2.3, isAnomaly: true }
```
