# StockSight Version 2 - Score Logic & Calculations

This document details the exact mathematical models, criteria, and conditional logic used by StockSight Version 2 to evaluate and score assets. 

All logic referenced here is primarily handled by `logic.js`.

---

## 1. Fundamental Scoring System (Max 100 Points)

The overall fundamental score evaluates a stock across four key pillars. The logic dynamically adjusts based on whether the asset is a Stock (Equity), or an ETF/Mutual Fund.

### 1.1 Equities (Stocks)

For stocks, the maximum score per pillar is as follows:
- **Business (40 Points):** Evaluates Sales Growth, Profit Growth, and Operating Profit Margin (OPM).
- **Moat (20 Points):** Evaluates Return on Equity (ROE), Return on Capital Employed (ROCE), and Market Capitalization.
- **Management (20 Points):** Evaluates Price-to-Earnings (P/E) relative to Growth, and Turnaround Size.
- **Risk (20 Points):** Evaluates Market Cap floors, 1-Year Returns, and Beta (Volatility).

### A. Business Pillar (Max 40)
The Business score evaluates top-line and bottom-line growth, alongside operational efficiency.
- **Sales Growth:** 
  - `> 15%`: +15 points
  - `> 8%` : +10 points
  - `> 0%` : +5 points
  - `> -10%`: +2 points (Triggers "Sales Drag" reasoning)
  
- **Profit Growth:** 
  - `> 15%`: +15 points
  - `> 8%` : +10 points
  - `> 0%` : +5 points
  - `> -20%`: +2 points (Triggers "Profit Drag" reasoning)

- **Operating Profit Margin (OPM) / Financial ROE:** 
  - **Non-Financials (Uses OPM):** 
    - `> 20%`: +10 points
    - `> 12%`: +5 points
    - `> 8%` : +2 points (Triggers "Low Margin" reasoning)
  - **Financials (Uses ROE instead of OPM):** 
    - `> 15%`: +10 points
    - `> 10%`: +5 points
    - `> 5%` : +2 points

*The total Business score is capped at 40.*

### B. Moat Pillar (Max 20)
The Moat score assesses capital efficiency and market dominance.
- **Efficiency:** 
  - **Financials:** If `ROE > 18%` (+8), else if `ROE > 12%` (+5).
  - **Non-Financials:** If `OPM > 18%` (+5). If `ROCE > 20%` (+5).
- **Market Dominance (Size):** 
  - `Market Cap > 20,000 Cr`: +5 points
  - `Market Cap > 5,000 Cr`: +3 points
- **Operating Leverage:**
  - If `Profit Growth > Sales Growth`: +5 points
- **Momentum Boost:**
  - If `1-Year Return > 40%`, the Moat score is artificially floored/boosted to at least `18 / 20`.

*The total Moat score is capped at 20.*

### C. Management / Valuation Pillar (Max 20)
This pillar evaluates capital allocation and relative valuation.
- **When P/E is available:**
  - If `P/E < 15` AND (`Profit Growth > 10%` OR `ROE > 15%`): +20 points
  - Else if `P/E < 25`: +10 points
  - Else if `P/E < 60`: +5 points
- **When P/E is missing (Turnaround logic):**
  - If `Market Cap > 50,000 Cr`: +10 points (Triggers "Turnaround Giant")
  - Else if `Market Cap > 10,000 Cr`: +5 points (Triggers "Recovering")

*The total Management score is capped at 20.*

### D. Risk Pillar (Max 20)
The Risk logic functions using baseline penalties and rewards based on volatility and safety nets.
- **Market Cap Safeguards:**
  - `Market Cap < 500 Cr`: **-10 points penalty** (Triggers "Micro Cap Risk")
  - `Market Cap > 5000 Cr`: +10 points
  - `Market Cap > 2000 Cr`: +5 points
- **Volatility (Beta) & Trend:**
  - If `1-Year Return > 40%`: +10 points (Uptrend strength overrides beta penalties)
  - Else if `Beta < 1.1`: +10 points (Low Volatility)
  - Else if `Beta < 1.3`: +5 points (Moderate Volatility)

*The total Risk score is capped at 20, minimum 0.*

### E. Global Fundamental Score Adjustments
After calculating the raw sum (`Business + Moat + Management + Risk`):
- **Deep Value Boosts:**
  - If `P/E < 15` AND `ROE > 15%` AND `Profit Growth > 0%`: +15 points ("High Quality Value")
  - Else if `P/E < 12` AND `Profit Growth > 10%`: +10 points ("Deep Value")

---

### 1.2 ETFs and Mutual Funds

Funds are scored entirely on historical returns or trend strength, as standard growth/margins do not apply.

- **Return-Based Logic (Mutual Funds / ETFs with History):**
  - **1-Year Return:** `> 15%` (+40), `> 10%` (+30), `> 0%` (+15)
  - **3-Year Return:** `> 12%` (+30), `> 8%` (+20), `> 0%` (+10)
  - **5-Year Return:** `> 10%` (+30), `> 8%` (+20), `> 0%` (+10)
  - *Calculation:* `Raw Score = Sum of Return Points (Capped at 99)`.
  - *Distribution:* 
    - Business = 40% of Raw
    - Moat = 30% of Raw
    - Management = 20% of Raw
    - Risk = 10% (Or 20% if `1Y Return > 3Y Return`)
- **Trend-Based Logic (Newer ETFs via Google Finance):**
  - Uses the current price's position relative to its 52-Week High/Low range.
  - `Position % = (Current Price - Low52) / (High52 - Low52) * 100`
  - `Total Score = 20 + (Position % * 0.7)`

---

## 2. Industry Normalization & Missing Data Penalties

Because different sectors have different baseline metrics, StockSight utilizes an `INDUSTRY_PROFILES` matrix to weight the fundamental pillars differently depending on the detected sector.

### Industry Weights
| Industry     | Keywords Analyzed                | Bus. Wgt | Moat Wgt | Mgmt Wgt | Risk Wgt | Required Data |
|--------------|----------------------------------|----------|----------|----------|----------|---------------|
| **BANKING**  | BANK, FINANCE, HDFC, ICICI...    | 1.1x     | 1.2x     | 1.0x     | 0.9x     | ROE           |
| **IT**       | TECH, INFOSYS, TCS, WIPRO...     | 1.2x     | 1.0x     | 1.1x     | 1.0x     | OPM           |
| **FMCG**     | HUL, NESTLE, MARICO, ITC...      | 1.0x     | 1.3x     | 1.1x     | 1.0x     | ROCE          |
| **PHARMA**   | PHARMA, DRUG, SUN, CIPLA...      | 1.1x     | 1.0x     | 1.0x     | 0.9x     | None          |
| **AUTO**     | MOTOR, CAR, MARUTI, TATA...      | 1.2x     | 0.9x     | 1.0x     | 0.9x     | None          |
| **POWER**    | ENERGY, NTPC, ADANI, TATA...     | 1.0x     | 1.2x     | 0.9x     | 0.8x     | None          |
| **REALTY**   | DLF, PRESTIGE, LODHA...          | 1.1x     | 0.8x     | 1.0x     | 0.8x     | None          |
| **GENERAL**  | (Fallback for all else)          | 1.0x     | 1.0x     | 1.0x     | 1.0x     | None          |

### Missing Data Penalty Logic
If the recognized industry requires a specific metric (e.g., OPM for IT) and that metric is missing or `0`, a **20-point penalty** is evaluated against the total score.
- *Safety Net:* If the calculated total score before the penalty is decent (`> 40`), applying the 20-point penalty will not drop the final score below `25`. It protects fundamentally strong companies from being zeroed out simply due to unparsable scraped data.

---

## 3. Porter’s 5 Forces Qualitative Score (Max 100 Points)

The Porter score attempts to mathematically simulate qualitative moat features using available quantitative data. 
Valid only for `STOCK` assets.

1. **Threat of New Entrants (20):** 
   - Uses Size & Efficiency (`Market Cap & ROCE`) as proxies. 
   - If `MCap > 10,000 & ROCE > 20%` (20), else if `MCap > 5,000 & ROCE > 15%` (15)...
2. **Supplier Power (20):** 
   - Uses Margins (`OPM`) as a proxy. High OPM implies the company dictates terms to suppliers.
   - If `OPM > 25%` (20), else if `OPM > 18%` (15)...
3. **Buyer Power (20):** 
   - Uses Returns (`ROE`) as a proxy. High ROE implies pricing power and inelastic buyer demand.
   - If `ROE > 22%` (20), else if `ROE > 16%` (15)...
4. **Threat of Substitutes (20):** 
   - Uses Top-line Growth (`Sales Growth`) as proxy. Rapid sales growth indicates the product is irreplaceably demanded.
   - If `Sales Growth > 15%` (20), else if `Sales Growth > 10%` (15)...
5. **Competitive Rivalry (20):** 
   - Uses Bottom-line Execution (`Profit Growth`) as proxy. Beating competitors results in strong profit accumulation.
   - If `Profit Growth > 15%` (20), else if `Profit Growth > 10%` (15)...

---

## 4. Moreshwar Target / Stop-Loss Levels

Calculates the Entry, Target, and Stop-loss levels dynamically using a blend of the Fundamental Score (`fScore`) and the Qualitative Moat Score (`pScore`).

**Mathematical Model:**
- **Variables:** `Y` = Spot Price. `X` = Average of (`fScore.total` and `pScore.total`).
- **If user HOLDS the stock (`isHolding == true`):**
  - `Target = Y + X`
  - `Stop-Loss = Y - (100 - X)`
- **If user does NOT hold the stock (`isHolding == false`):**
  - `Entry Price = Y - (100 - X)`

*Logic Summary:* A high-scoring asset (e.g., `X = 80`) trading at ₹1000 has tight downside entry/stop levels (`1000 - 20 = 980`) because the system trusts the quality, and high upside targets (`1000 + 80 = 1080`). Conversely, a low-scoring asset expects severe pullbacks.

---

## 5. Final Decision Matrix (BUY/HOLD/SELL Signals)

The final actionable output combines `Conviction`, `Trajectory`, and `Timing`.

### Step 1: Base Indicators
- **Conviction:** Average of Fundamental & Porter scores. `Strong (>=60)`, `Stable (41-59)`, `Weak (<=40)`.
- **Trajectory:** Looks at `Sales Growth`, `Profit Growth`, and `ROE`. Fades if growth is negative.
- **Timing:** Looks at `Price vs 200-Day Moving Average` and `1-Year vs 3-Year Return Momentum`. Outputs `Favourable`, `Neutral`, or `Unfavourable`.

### Step 2: Decision Tree Matrix

| Conviction | Trajectory     | Timing         | Held? | Action Decision | Rationale                                                                                         |
|------------|----------------|----------------|-------|-----------------|---------------------------------------------------------------------------------------------------|
| **Weak**   | *Any*          | *Any*          | Yes   | **EXIT**        | The foundation is crumbling. Temporary positive timing is a trap. Capital must be preserved.      |
| **Weak**   | *Any*          | *Any*          | No    | **AVOID**       | The business quality does not meet the minimum threshold for investment. Ignore price action.     |
| **Strong** | Deteriorating  | *Any*          | Yes   | **REVIEW**      | Core quality is high, but growth momentum is fading. Scrutinize to see if it's a temporary dip.   |
| **Strong** | Deteriorating  | *Any*          | No    | **WAIT**        | High quality business experiencing a slowdown. Wait for the trajectory to stabilize before entry. |
| **Strong** | Improving/Flat | Late           | Yes   | **HOLD**        | Excellent business firing on all cylinders, but valuation/timing is overextended. Ride the trend.   |
| **Strong** | Improving/Flat | Favourable     | No    | **BUY NOW**     | The ideal setup: High conviction quality intersecting with accelerating growth and good timing.   |
| **Strong** | Improving/Flat | Favourable     | Yes   | **ADD**         | Quality, Growth, and Trend all align positively. This is the optimal window to upsize exposure.   |
| **Stable** | Deteriorating  | *Any*          | Yes   | **REDUCE**      | Average business where stability is now threatened by slowing growth. Reduce capital risk.        |
| **Stable** | Flat/Improving | Unfavourable   | No    | **WAIT**        | Decent business, but current price action is working against it. Wait for support to form.        |
| **Stable** | Flat/Improving | Favourable     | No    | **SIP ONLY**    | Decent business with good timing warrants a staggered, lower-risk allocation approach.            |
