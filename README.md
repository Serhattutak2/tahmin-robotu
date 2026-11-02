# Tahmin Robotu
Futbol ve basketbol maçlarını ücretsiz kaynaklardan değerlendirir; yalnızca oranı 1,30 ve üstü, hesaba göre avantajlı seçimleri gösterir. Kazanç garantisi yoktur.
- `scripts/run.mjs`: 3 saatte bir veri çeker, `docs/data.json` ve `docs/ledger.json` yazar.
- `scripts/backtest.mjs`: geçmiş oranlarla test eder, `config/strategy.json` ayarını seçer.
- `docs/`: GitHub Pages sitesi.
