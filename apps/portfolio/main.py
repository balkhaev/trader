"""
Portfolio Optimization Service
Uses PyPortfolioOpt for portfolio optimization integrated with Lean backtesting data.
"""

import json
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Добавляем путь к lean для импорта data_manager
sys.path.insert(0, str(Path(__file__).parent.parent / "lean"))
from data_manager import DataManager
from pypfopt import (
    BlackLittermanModel,
    CLA,
    EfficientFrontier,
    HRPOpt,
    expected_returns,
    risk_models,
)
from pypfopt.discrete_allocation import DiscreteAllocation, get_latest_prices

load_dotenv()

app = FastAPI(
    title="Portfolio Optimization Service",
    description="PyPortfolioOpt integration with Lean",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

LEAN_PATH = os.getenv("LEAN_PATH", "/Users/balkhaev/mycode/trader/apps/lean")

# Инициализация менеджера данных
data_manager = DataManager(LEAN_PATH)


class OptimizationRequest(BaseModel):
    """Request for portfolio optimization"""
    symbols: list[str]
    method: str = "max_sharpe"  # max_sharpe, min_volatility, efficient_risk, hrp, black_litterman
    target_return: Optional[float] = None
    target_volatility: Optional[float] = None
    risk_free_rate: float = 0.02
    total_portfolio_value: float = 10000
    lookback_days: int = 365


class OptimizationResult(BaseModel):
    """Result of portfolio optimization"""
    weights: dict[str, float]
    expected_return: float
    volatility: float
    sharpe_ratio: float
    discrete_allocation: Optional[dict[str, int]] = None
    leftover: Optional[float] = None


class EfficientFrontierPoint(BaseModel):
    """Point on the efficient frontier"""
    return_: float
    volatility: float
    sharpe: float


def load_lean_data(symbol: str, lookback_days: int = 365) -> pd.Series:
    """Load price data from Lean data folder"""
    # Lean stores data in format: data/crypto/binance/daily/btcusdt_quote.zip
    data_path = Path(LEAN_PATH) / "data" / "crypto" / "binance" / "daily"

    symbol_lower = symbol.lower().replace("/", "")
    zip_file = data_path / f"{symbol_lower}_quote.zip"

    if not zip_file.exists():
        raise FileNotFoundError(f"Data not found for {symbol}")

    # Read from zip
    df = pd.read_csv(
        zip_file,
        compression="zip",
        header=None,
        names=["time", "bid_open", "bid_high", "bid_low", "bid_close",
               "ask_open", "ask_high", "ask_low", "ask_close"],
    )

    # Convert time (Lean uses milliseconds from 1/1/1970)
    df["date"] = pd.to_datetime(df["time"], unit="ms")
    df.set_index("date", inplace=True)

    # Use mid price
    df["close"] = (df["bid_close"] + df["ask_close"]) / 2

    # Filter by lookback
    cutoff = datetime.now() - timedelta(days=lookback_days)
    df = df[df.index >= cutoff]

    return df["close"]


def load_prices_dataframe(symbols: list[str], lookback_days: int = 365, auto_download: bool = True) -> pd.DataFrame:
    """Load prices for multiple symbols into DataFrame"""

    # Автоматически скачиваем недостающие символы
    if auto_download:
        check = data_manager.ensure_symbols(symbols)
        if check["missing"]:
            print(f"Warning: Could not download symbols: {check['missing']}")

    prices = {}

    for symbol in symbols:
        try:
            prices[symbol] = load_lean_data(symbol, lookback_days)
        except FileNotFoundError:
            # Символ недоступен даже после попытки скачивания
            continue

    if not prices:
        raise HTTPException(
            status_code=400,
            detail=f"Could not load data for any symbols: {symbols}"
        )

    df = pd.DataFrame(prices)
    df = df.dropna()

    if df.empty:
        loaded = list(prices.keys())
        failed = [s for s in symbols if s not in prices]
        raise HTTPException(
            status_code=400,
            detail=f"No overlapping data. Loaded: {loaded}, Failed: {failed}"
        )

    return df


@app.get("/")
async def root():
    return {"status": "ok", "service": "Portfolio Optimization"}


@app.get("/symbols")
async def list_available_symbols():
    """List symbols available in Lean data"""
    data_path = Path(LEAN_PATH) / "data" / "crypto" / "binance" / "daily"

    if not data_path.exists():
        return {"symbols": []}

    symbols = []
    for f in data_path.glob("*_quote.zip"):
        symbol = f.stem.replace("_quote", "").upper()
        symbols.append(symbol)

    return {"symbols": sorted(symbols)}


@app.post("/optimize", response_model=OptimizationResult)
async def optimize_portfolio(request: OptimizationRequest):
    """
    Optimize portfolio using various methods:
    - max_sharpe: Maximum Sharpe ratio
    - min_volatility: Minimum volatility
    - efficient_risk: Target volatility with max return
    - efficient_return: Target return with min volatility
    - hrp: Hierarchical Risk Parity
    - black_litterman: Black-Litterman model
    """

    if len(request.symbols) < 2:
        raise HTTPException(status_code=400, detail="Need at least 2 symbols")

    # Load price data
    prices = load_prices_dataframe(request.symbols, request.lookback_days)

    # Calculate expected returns and covariance
    mu = expected_returns.mean_historical_return(prices)
    S = risk_models.sample_cov(prices)

    weights = {}

    if request.method == "hrp":
        # Hierarchical Risk Parity - doesn't need expected returns
        returns = prices.pct_change().dropna()
        hrp = HRPOpt(returns)
        weights = hrp.optimize()

    elif request.method == "black_litterman":
        # Black-Litterman with market-implied prior
        # Using equal weights as market cap proxy for crypto
        from pypfopt import black_litterman

        market_caps = pd.Series({s: 1.0 for s in mu.index})

        # Calculate market-implied risk aversion and prior returns
        delta = black_litterman.market_implied_risk_aversion(prices)
        pi = black_litterman.market_implied_prior_returns(market_caps, delta, S)

        ef = EfficientFrontier(pi, S)
        weights = ef.max_sharpe(risk_free_rate=request.risk_free_rate)

    else:
        # Mean-Variance Optimization
        ef = EfficientFrontier(mu, S)

        if request.method == "max_sharpe":
            # Check if any asset has return above risk-free rate
            if (mu > request.risk_free_rate).any():
                weights = ef.max_sharpe(risk_free_rate=request.risk_free_rate)
            else:
                # Fallback: use risk_free_rate=0 or min_volatility
                try:
                    weights = ef.max_sharpe(risk_free_rate=0)
                except ValueError:
                    # All returns negative - use min_volatility instead
                    ef = EfficientFrontier(mu, S)
                    weights = ef.min_volatility()
        elif request.method == "min_volatility":
            weights = ef.min_volatility()
        elif request.method == "efficient_risk" and request.target_volatility:
            weights = ef.efficient_risk(request.target_volatility)
        elif request.method == "efficient_return" and request.target_return:
            weights = ef.efficient_return(request.target_return)
        else:
            try:
                weights = ef.max_sharpe(risk_free_rate=request.risk_free_rate)
            except ValueError:
                ef = EfficientFrontier(mu, S)
                weights = ef.min_volatility()

    # Clean weights (remove tiny allocations)
    cleaned_weights = {k: round(v, 4) for k, v in weights.items() if v > 0.001}

    # Normalize
    total = sum(cleaned_weights.values())
    cleaned_weights = {k: v/total for k, v in cleaned_weights.items()}

    # Calculate portfolio performance
    # Use symbols from mu (actual loaded data) instead of request.symbols
    available_symbols = list(mu.index)
    weights_array = np.array([cleaned_weights.get(s, 0) for s in available_symbols])
    mu_array = mu.values

    expected_return = float(np.dot(weights_array, mu_array))
    volatility = float(np.sqrt(np.dot(weights_array.T, np.dot(S.values, weights_array))))
    sharpe = (expected_return - request.risk_free_rate) / volatility if volatility > 0 else 0

    # Discrete allocation
    latest_prices = get_latest_prices(prices)
    da = DiscreteAllocation(
        cleaned_weights,
        latest_prices,
        total_portfolio_value=request.total_portfolio_value
    )
    allocation, leftover = da.greedy_portfolio()

    return OptimizationResult(
        weights=cleaned_weights,
        expected_return=expected_return,
        volatility=volatility,
        sharpe_ratio=sharpe,
        discrete_allocation=allocation,
        leftover=leftover,
    )


@app.post("/efficient-frontier")
async def get_efficient_frontier(request: OptimizationRequest):
    """Calculate points on the efficient frontier"""

    prices = load_prices_dataframe(request.symbols, request.lookback_days)

    mu = expected_returns.mean_historical_return(prices)
    S = risk_models.sample_cov(prices)

    # Use Critical Line Algorithm for frontier
    cla = CLA(mu, S)
    cla.max_sharpe()

    # Get frontier points
    returns, volatilities, _ = cla.efficient_frontier(points=50)

    points = []
    for r, v in zip(returns, volatilities):
        sharpe = (r - request.risk_free_rate) / v if v > 0 else 0
        points.append({
            "return": float(r),
            "volatility": float(v),
            "sharpe": float(sharpe),
        })

    return {"frontier": points}


@app.get("/backtest/{backtest_id}/performance")
async def analyze_backtest_performance(backtest_id: str):
    """Analyze a Lean backtest performance metrics"""

    backtest_path = Path(LEAN_PATH) / "backtests" / backtest_id

    if not backtest_path.exists():
        raise HTTPException(status_code=404, detail="Backtest not found")

    # Find summary file
    summary_file = None
    for f in backtest_path.glob("*-summary.json"):
        summary_file = f
        break

    if not summary_file:
        raise HTTPException(status_code=404, detail="Summary not found")

    with open(summary_file) as f:
        summary = json.load(f)

    stats = summary.get("statistics", {})

    # Extract key metrics
    return {
        "backtest_id": backtest_id,
        "metrics": {
            "total_return": stats.get("Net Profit", "0%"),
            "annual_return": stats.get("Compounding Annual Return", "0%"),
            "sharpe_ratio": float(stats.get("Sharpe Ratio", 0)),
            "sortino_ratio": float(stats.get("Sortino Ratio", 0)),
            "max_drawdown": stats.get("Drawdown", "0%"),
            "win_rate": stats.get("Win Rate", "0%"),
            "profit_loss_ratio": float(stats.get("Profit-Loss Ratio", 0)),
            "total_trades": int(stats.get("Total Orders", 0)),
        }
    }


@app.post("/generate-lean-weights")
async def generate_lean_weights(request: OptimizationRequest):
    """Generate Python code for Lean with optimized weights"""

    # Get optimized weights
    result = await optimize_portfolio(request)

    # Generate Lean Python code
    code = f'''# Auto-generated portfolio weights from PyPortfolioOpt
# Method: {request.method}
# Generated: {datetime.now().isoformat()}

class OptimizedPortfolio:
    """Portfolio weights optimized using {request.method}"""

    WEIGHTS = {{
'''

    for symbol, weight in result.weights.items():
        code += f'        "{symbol}": {weight:.4f},\n'

    code += f'''    }}

    # Expected metrics
    EXPECTED_RETURN = {result.expected_return:.4f}  # {result.expected_return*100:.2f}%
    EXPECTED_VOLATILITY = {result.volatility:.4f}  # {result.volatility*100:.2f}%
    SHARPE_RATIO = {result.sharpe_ratio:.4f}

    @classmethod
    def get_weight(cls, symbol: str) -> float:
        """Get weight for a symbol"""
        return cls.WEIGHTS.get(symbol.upper(), 0.0)

    @classmethod
    def get_symbols(cls) -> list:
        """Get all symbols in portfolio"""
        return list(cls.WEIGHTS.keys())


# Usage in Lean:
# from portfolio_weights import OptimizedPortfolio
#
# def Initialize(self):
#     for symbol in OptimizedPortfolio.get_symbols():
#         self.AddCrypto(symbol, Resolution.Hour)
#
# def Rebalance(self):
#     for symbol, weight in OptimizedPortfolio.WEIGHTS.items():
#         self.SetHoldings(symbol, weight)
'''

    return {
        "code": code,
        "weights": result.weights,
        "metrics": {
            "expected_return": result.expected_return,
            "volatility": result.volatility,
            "sharpe_ratio": result.sharpe_ratio,
        }
    }


# ==================== Data Management API ====================

class DownloadRequest(BaseModel):
    """Request for downloading symbols"""
    symbols: list[str]
    start_date: Optional[str] = None
    end_date: Optional[str] = None


class SymbolStatusResponse(BaseModel):
    """Symbol status response"""
    symbol: str
    available: bool
    file_path: Optional[str] = None
    file_size: int = 0
    candles_count: int = 0
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    last_updated: Optional[str] = None


@app.get("/data/status")
async def get_data_status():
    """Получить статус всех данных"""
    statuses = data_manager.get_all_status()
    return {
        "total_symbols": len(statuses),
        "symbols": [
            {
                "symbol": s.symbol,
                "available": s.available,
                "file_size": s.file_size,
                "candles_count": s.candles_count,
                "start_date": s.start_date,
                "end_date": s.end_date,
                "last_updated": s.last_updated,
            }
            for s in statuses
        ]
    }


@app.get("/data/symbols")
async def get_data_symbols():
    """Получить список доступных символов"""
    symbols = data_manager.get_available_symbols()
    return {"symbols": symbols, "count": len(symbols)}


@app.get("/data/symbol/{symbol}")
async def get_symbol_status(symbol: str):
    """Получить статус конкретного символа"""
    status = data_manager.get_symbol_status(symbol)
    return {
        "symbol": status.symbol,
        "available": status.available,
        "file_path": status.file_path,
        "file_size": status.file_size,
        "candles_count": status.candles_count,
        "start_date": status.start_date,
        "end_date": status.end_date,
        "last_updated": status.last_updated,
    }


@app.post("/data/check")
async def check_symbols(request: DownloadRequest):
    """Проверить какие символы доступны"""
    result = data_manager.check_symbols(request.symbols)
    return result


@app.post("/data/download")
async def download_symbols(request: DownloadRequest, background_tasks: BackgroundTasks):
    """Скачать указанные символы"""
    # Проверяем какие нужно скачать
    check = data_manager.check_symbols(request.symbols)

    if not check["missing"]:
        return {
            "status": "ok",
            "message": "All symbols already available",
            "downloaded": [],
            "available": check["available"]
        }

    # Скачиваем в фоне для долгих операций
    results = []
    for symbol in check["missing"]:
        status = data_manager.download_symbol(
            symbol,
            start_date=request.start_date,
            end_date=request.end_date
        )
        results.append({
            "symbol": status.symbol,
            "success": status.available,
            "candles": status.candles_count
        })

    return {
        "status": "ok",
        "downloaded": results,
        "already_available": check["available"]
    }


@app.post("/data/update")
async def update_all_data():
    """Обновить все данные до текущей даты"""
    results = data_manager.update_all()
    return {
        "status": "ok",
        "updated": [
            {
                "symbol": s.symbol,
                "candles": s.candles_count,
                "end_date": s.end_date
            }
            for s in results
        ]
    }


@app.post("/data/update/{symbol}")
async def update_symbol_data(symbol: str):
    """Обновить данные для конкретного символа"""
    status = data_manager.update_symbol(symbol)
    return {
        "symbol": status.symbol,
        "available": status.available,
        "candles_count": status.candles_count,
        "start_date": status.start_date,
        "end_date": status.end_date,
    }


@app.delete("/data/symbol/{symbol}")
async def delete_symbol_data(symbol: str):
    """Удалить данные символа"""
    zip_file = data_manager.data_path / f"{symbol.lower()}_quote.zip"
    if zip_file.exists():
        zip_file.unlink()
        return {"status": "ok", "message": f"Deleted {symbol}"}
    raise HTTPException(status_code=404, detail=f"Symbol {symbol} not found")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
