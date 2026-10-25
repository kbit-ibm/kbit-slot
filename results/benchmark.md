# Benchmark de Kbit Slot

2026-10-25T05:42:42+00:00 · commit `1c7331b` · semillas [1, 2, 3] · Qiskit 2.6.1 · Aer 0.18.0

Índice final medio (menor es mejor) ± desviación, y segundos por corrida. Todas las corridas parten de la distribución actual.

| Método | demo-8 | demo-12 | demo-sin-limite | pedidos-b-12 | dos-niveles-12 |
|---|---|---|---|---|---|
| voraz | 3256 ± 0 · 0.0 s | 3059 ± 0 · 0.1 s | 2722 ± 0 · 0.1 s | 3715 ± 0 · 0.1 s | 2627 ± 0 · 0.1 s |
| recocido | 3105 ± 13 · 0.2 s | 2628 ± 0 · 0.2 s | 2318 ± 2 · 0.3 s | 3680 ± 3 · 0.2 s | 2160 ± 11 · 0.2 s |
| qaoa-intercambios | 3232 ± 58 · 2.7 s | 2874 ± 189 · 2.4 s | 2692 ± 114 · 2.2 s | 3751 ± 42 · 2.4 s | 2230 ± 24 · 2.3 s |
| azar-intercambios | 3232 ± 58 · 0.5 s | 2870 ± 183 · 0.5 s | 2682 ± 107 · 0.4 s | 3751 ± 42 · 0.5 s | 2266 ± 32 · 0.5 s |
| exacto-intercambios | 3232 ± 58 · 0.1 s | 2926 ± 173 · 0.2 s | 2693 ± 115 · 0.2 s | 3804 ± 72 · 0.2 s | 2229 ± 24 · 0.2 s |
| qaoa-ventanas | 3775 ± 155 · 2.4 s | 3631 ± 116 · 2.5 s | 3330 ± 132 · 2.5 s | 4580 ± 122 · 2.4 s | 3220 ± 163 · 2.5 s |
| azar-ventanas | 3775 ± 155 · 0.7 s | 3631 ± 116 · 0.7 s | 3331 ± 132 · 0.7 s | 4580 ± 122 · 0.7 s | 3220 ± 163 · 0.7 s |
| exacto-ventanas | 3775 ± 155 · 0.1 s | 3500 ± 267 · 0.1 s | 3430 ± 40 · 0.1 s | 4580 ± 122 · 0.1 s | 3220 ± 163 · 0.1 s |
| qaoa-ruido | 3219 ± 86 · 17.4 s | 2788 ± 117 · 16.0 s | 2645 ± 97 · 15.4 s | 3814 ± 33 · 16.5 s | 2552 ± 65 · 15.9 s |

| Comparación (misma semilla) | Gana | Empata | Pierde |
|---|---|---|---|
| qaoa-intercambios frente a azar-intercambios | 5 | 8 | 2 |
| qaoa-intercambios frente a exacto-intercambios | 3 | 11 | 1 |
| qaoa-ventanas frente a azar-ventanas | 1 | 14 | 0 |
| qaoa-ventanas frente a exacto-ventanas | 2 | 12 | 1 |
| qaoa-intercambios frente a recocido | 0 | 0 | 15 |
