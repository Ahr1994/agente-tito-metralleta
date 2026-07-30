# SPX 0DTE/1DTE — Venta de Prima Diaria — Diseño

**Fecha:** 2026-07-30
**Objetivo:** Un módulo para **vender prima diaria en SPX** (credit vertical spreads) en
**0DTE y 1DTE**. Encuentra los **extremos más seguros** para vender, cruzando GEX + move
esperado + IV/IV Rank + flujo agresivo (bid/ask) + noticias macro.

## Feasibility (verificada el 2026-07-30)

- ✅ **Opciones SPX 0DTE/1DTE en Massive:** la cadena `SPXW` (dailies) trae strikes, greeks,
  IV y OI. Query: `/v3/snapshot/options/I:SPX?expiration_date=YYYY-MM-DD` (el underlying
  `I:SPX` devuelve greeks; `SPX` a secas no). Contratos formato OCC `O:SPXW260730C07400000`.
- ✅ **Flujo SPX de MarketSnack:** `/api/flow_feed?filter[symbol][]=SPX&period=1d` → 200 OK,
  trae **`side` (bid/ask = agresividad), `gamma` (para GEX), delta, theta, vega, iv, premium**.
- ⚠️ **Valor del índice SPX: 403** (requiere plan Indices). Se **deriva de las opciones**
  (paridad put-call de un ITM, o `underlying_asset.price`). No bloquea.

## La tesis (por qué GEX manda en 0DTE)

En 0DTE la gamma de los dealers es enorme: donde hay muros de gamma, el dealer **hedgea en
contra del movimiento y "pinnea" el precio**. Entonces:

> **Los extremos MÁS SEGUROS para vender prima en 0DTE están JUSTO FUERA de los muros de
> GEX** — el mercado casi no llega ahí porque la gamma lo jala de vuelta. Vender el credit
> spread más allá del muro = alta probabilidad de que expire OTM.

El módulo combina: **muros de GEX + move esperado (σ) + IV Rank + flujo agresivo (qué lado)
+ noticias (catalizador)** → los credit spreads de las colas más defendibles, por lado.

## Principio de diseño

**Aditivo. Reusa lo que ya existe; no toca su lógica.** Solo se lee:

| Necesidad | Se reusa |
|-----------|----------|
| GEX (muros, imán, flip) | `lib/gex.ts`, `lib/gexHeatmap.ts` (ya anclan gamma real de MarketSnack) |
| IV + IV Rank + régimen | `lib/ivcontext.ts` |
| Flujo agresivo (bid/ask, side) | `lib/flow.ts`, `lib/marketsnack.ts` |
| Parseo de contratos SPXW | `lib/occ.ts` |
| Noticias macro | `lib/news.ts` (RSS CNBC/Investing = macro/SPX) |
| Extremos safe + EV | `lib/premiumSell.ts` (delta 0.10 / ±2σ, R/R, ProbOTM) |
| Move esperado / σ | `lib/expectedMove.ts`, `lib/earningsMove.ts::atmIv` |

## Módulos nuevos

### 1. `lib/spx.ts` (PURO donde se pueda, tests) — data layer + lógica SPX

```ts
// Deriva el spot de SPX desde las opciones (sin plan de Indices):
//   de un call ITM: spot ≈ strike + precioCall;  o promediar varios; o underlying_asset.price
deriveSpxSpot(quotes): number | null

// Filtra la cadena a 0DTE y 1DTE (por fecha de mercado ET).
splitByDte(quotes, now): { zeroDte: SpxQuote[]; oneDte: SpxQuote[] }
```

### 2. `lib/massive.ts` (extensión) — `fetchSpxChain(dte: 0|1)`
Cadena SPXW del 0DTE u 1DTE con greeks/IV/OI, near-money (±5-8% del spot derivado).

### 3. `lib/marketsnack.ts` (extensión) — `fetchSpxFlow(period)`
El flujo SPX (reusa `fetchFlow("SPX")`), parsea los símbolos `SPXW…` con `occ.ts`.

### 4. `lib/spxServer.ts` — orquestación
Junta: chain + flow + GEX (reusa `gexAnalysis`) + IV Rank + move esperado + `suggestSpreadsAtSigma`
anclado a los **muros de GEX** (no solo σ). Devuelve, por DTE:
- muros de GEX (soporte/resistencia gamma), imán, zona de flip, régimen (γ+/γ−)
- IV / IV Rank / régimen de vol
- desbalance de flujo agresivo (compras al ask vs ventas al bid) por lado
- **extremos safe:** put spread bajo el muro inferior, call spread sobre el superior, con
  crédito/máx-pérdida/BE/R-R/ProbOTM/**EV**
- noticias macro relevantes

### 5. `app/api/spx/route.ts` + `app/spx/page.tsx` + pestaña 📊 en `NavTabs`
Vista con toggle 0DTE/1DTE: mapa de GEX + los extremos safe por lado + IV Rank + flujo + noticias.

## Selección de "extremos safe" (la clave)

Para cada lado, el short strike se elige como el **más externo entre**:
1. Fuera del **muro de GEX** relevante (arriba: resistencia gamma; abajo: soporte gamma).
2. Fuera de **N·σ** (move esperado del día).
3. Con **|delta| ≤ objetivo** (ej. 0.10).
Y se filtra por **EV** (no sugerir si el win% para breakeven supera la ProbOTM).

El **flujo agresivo** decide el sesgo: muchas **compras de calls al ask** → riesgo alcista →
preferir vender el **put spread**; muchas **compras de puts al ask** → vender el **call spread**.

## Datos y limitaciones

- **Spot SPX:** derivado de opciones (el índice da 403). Marcar como derivado.
- **IV Rank de SPX:** el `ivStore` acumula fotos diarias; para SPX 0DTE, arrancar con proxy
  (ATM IV vs su rango reciente) hasta acumular. *(VIX/VIX1D sería ideal pero requiere Indices.)*
- **0DTE se mueve rápido:** los datos deben ser en vivo; marcar `stale` como en earnings.
- **No es consejo:** riesgo definido, gap/tail risk, disclaimer.

## Plan por fases

1. **Fase 1:** `spx.ts` (spot derivado + split DTE) + `fetchSpxChain` + `fetchSpxFlow` + tests.
2. **Fase 2:** GEX del 0DTE (reusar `gexAnalysis` con la gamma de MarketSnack) → muros/imán/flip.
3. **Fase 3:** extremos safe anclados a los muros + flujo agresivo por lado + EV.
4. **Fase 4:** vista `/spx` (0DTE/1DTE) + IV Rank + noticias, y tracking de trades (reusar store).

Todo aditivo, con tests puros, por fork + PR.

## Riesgo al proyecto

**Bajo.** Archivos nuevos; reusa lógica existente sin modificarla. Aterriza en el fork; no
afecta `main` hasta merge.
