export { consensusMarketService } from "./consensus-market.service";
export {
  consensusWifDotService,
  type DotEvaluationInput,
  type EvaluateStrategyInput,
  type EvaluateStrategyResult,
  type PositionPlan,
  type StrategyRiskState,
  type StrategySignalPlan,
  type WifEvaluationInput,
} from "./consensus-wif-dot.service";
export { strategyRunnerService } from "./strategy-runner.service";
export { strategyService, type StrategyRecord } from "./strategy.service";

import { strategyScheduler } from "./strategy.scheduler";

strategyScheduler.start();
export { strategyScheduler };
