# SPX Momentum de Cierre (DIRECCIONAL) — Diseño

**Fecha:** 2026-08-03
**Objetivo:** La OTRA cara del módulo de venta de prima. En las últimas ~2h, cuando NO hay edge
para vender prima (IV baja) pero se arma un **move direccional agresivo** (como el del viernes
en el cierre), señalar la dirección + target para tradearlo (long calls/puts o debit spread).

## Tesis
En 0DTE cerca del cierre, si la **gamma es NEGATIVA** los dealers **amplifican** el movimiento
(hedgean a favor). Si además entra **flujo institucional AGRESIVO direccional** (Aggr.Buy
calls/puts), el precio **corre hacia el muro/imán** en esa dirección. El **gamma flip** es el
gatillo. Es lo que pasó el viernes: compras agresivas + move que aceleró al cierre.

## Modos del agente
- IV alta / edge 🟢 → **vender prima** (módulo SPX 0DTE existente).
- IV muerta / edge 🔴 → **direccional de cierre** (este módulo).

## Fases
1. `lib/closingMomentum.ts` (PURO): `minutesToClose`, `aggressiveFlow` (surge Aggr.Buy/Sell),
   `closingMomentumSignal` (cruza régimen+flujo+tiempo → bias/target/convicción). Tests.
2. `spxServer::spxMomentum` (GEX oficial + índice + flujo agresivo) + `/api/spx-momentum`.
3. Vista: tarjeta 🚀 en /spx con la señal (auto-refresh 45s). ✅
4. **Pendiente:** tracking direccional (¿la señal acertó el move? win-rate).

## Setups
- **momentum:** gamma negativa + flujo agresivo de un lado → corre al muro en esa dirección.
- **breakout:** gamma positiva PERO el precio rompe el muro con flujo → corre al siguiente nivel.

## Reusa
Índice real-time, GEX oficial (msGex: net_gex/flip/muros/imán), tape agresiva — todo del plan
GEX & Indices de MarketSnack. Solo la lógica de la señal es nueva.
