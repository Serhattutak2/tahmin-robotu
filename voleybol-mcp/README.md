# Voleybol canlı analiz bağlayıcısı

Claude'a (claude.ai / mobil uygulama) özel bağlayıcı olarak eklenen küçük bir MCP sunucusu.
Telefondan "analiz yap" denildiğinde canlı voleybol maçlarını ve Melbet oranlarını OddsPapi üzerinden çeker,
set simülasyonu ile olasılık hesaplar. Kazanç garantisi yoktur.

Render ayarları: build `cd voleybol-mcp && pip install -r requirements.txt`, start `cd voleybol-mcp && python server.py`.
Ortam değişkenleri: `ODDSPAPI_KEY`, `MCP_SECRET`, `BOOKMAKER` (varsayılan melbet).
