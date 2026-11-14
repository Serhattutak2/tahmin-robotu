"""Voleybol canlı analiz bağlayıcısı (MCP).

Claude'a iki araç verir:
- canli_voleybol: OddsPapi üzerinden canlı voleybol maçlarını ve Melbet oranlarını getirir.
- set_simulasyonu: Verilen skor ve sideout oranlarıyla seti simüle edip olasılıkları döndürür.

Ortam değişkenleri:
- ODDSPAPI_KEY: OddsPapi API anahtarı (zorunlu, canli_voleybol için)
- MCP_SECRET: URL'deki gizli yol parçası; bağlayıcı adresi https://<host>/mcp/<MCP_SECRET>
- BOOKMAKER: varsayılan "melbet"
"""
import os
import random
import time
from typing import Any

import httpx
from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings

API = "https://api.oddspapi.io/v4"
KEY = os.environ.get("ODDSPAPI_KEY", "")
BOOKMAKER = os.environ.get("BOOKMAKER", "melbet")
SECRET = os.environ.get("MCP_SECRET", "degistir")
PORT = int(os.environ.get("PORT", "8000"))

mcp = FastMCP(
    "voleybol-analiz",
    instructions=(
        "Canlı voleybol analizi. Kullanıcı 'analiz yap' dediğinde önce canli_voleybol aracını çağır, "
        "sonra uygun maçlar için set_simulasyonu ile olasılık hesapla ve oranın marjsız ima ettiği "
        "olasılıkla karşılaştır. Büyük liglerde en az 8, küçük liglerde en az 10 puan avantaj yoksa pas de."
    ),
    host="0.0.0.0",
    port=PORT,
    streamable_http_path=f"/mcp/{SECRET}",
    stateless_http=True,
    json_response=True,
    transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False),
)

_cache: dict[str, tuple[float, Any]] = {}


def _get(path: str, params: dict, ttl: int = 0) -> Any:
    """OddsPapi'ye istek atar; ttl > 0 ise sonucu önbelleğe alır (aylık sorgu limiti için)."""
    ck = path + repr(sorted(params.items()))
    if ttl and ck in _cache and time.time() - _cache[ck][0] < ttl:
        return _cache[ck][1]
    r = httpx.get(f"{API}/{path}", params={**params, "apiKey": KEY}, timeout=20)
    if r.status_code == 404:
        data: Any = []
    else:
        r.raise_for_status()
        data = r.json()
    if ttl:
        _cache[ck] = (time.time(), data)
    return data


def _volleyball_sport_id() -> int | None:
    sports = _get("sports", {}, ttl=7 * 86400)
    for s in sports if isinstance(sports, list) else []:
        name = str(s.get("sportName") or s.get("name") or s.get("slug") or "").lower()
        if "volley" in name and "beach" not in name:
            return s.get("sportId") or s.get("id")
    return None


def _market_names() -> dict[str, str]:
    try:
        markets = _get("markets", {}, ttl=7 * 86400)
    except Exception:
        return {}
    out: dict[str, str] = {}
    for m in markets if isinstance(markets, list) else []:
        mid = str(m.get("marketId") or m.get("id") or "")
        nm = m.get("marketName") or m.get("name") or ""
        if mid:
            out[mid] = nm
        for o in m.get("outcomes", []) or []:
            oid = str(o.get("outcomeId") or o.get("id") or "")
            if oid:
                out["o" + oid] = o.get("outcomeName") or o.get("name") or ""
    return out


@mcp.tool()
def canli_voleybol(en_fazla_mac: int = 15) -> dict:
    """Şu an canlı oynanan voleybol maçlarını, skorlarını ve Melbet oranlarını getirir.

    Dönen her maçta: takımlar, lig, durum/skor bilgisi ve Melbet pazarları (pazar adı, seçenek adı, oran).
    Not: Ücretsiz planda ayda 250 sorgu var; her çağrı yaklaşık 2-3 sorgu harcar.
    """
    if not KEY:
        return {"hata": "ODDSPAPI_KEY tanımlı değil. Render'da ortam değişkeni olarak eklenmeli."}
    sid = _volleyball_sport_id()
    if sid is None:
        return {"hata": "Voleybol spor kimliği bulunamadı.", "ipucu": "sports uç noktası beklenmedik formatta döndü."}
    tours = _get("tournaments", {"sportId": sid}, ttl=60)
    live = [t for t in (tours if isinstance(tours, list) else []) if (t.get("liveFixtures") or 0) > 0]
    if not live:
        return {"canli_mac_sayisi": 0, "mesaj": "Şu an canlı voleybol maçı görünmüyor."}
    names = {t["tournamentId"]: f'{t.get("categoryName", "")} - {t.get("tournamentName", "")}' for t in live}
    ids = ",".join(str(t["tournamentId"]) for t in live[:30])
    fixtures = _get("odds-by-tournaments", {"bookmaker": BOOKMAKER, "tournamentIds": ids, "oddsFormat": "decimal"})
    mnames = _market_names()
    out = []
    for fx in fixtures if isinstance(fixtures, list) else []:
        bo = (fx.get("bookmakerOdds") or {}).get(BOOKMAKER)
        status = fx.get("statusId")
        if not bo or not bo.get("bookmakerIsActive", True):
            continue
        if status not in (1, "1", "live", "Live", None) and not fx.get("trueStartTime"):
            continue
        markets = []
        for mid, m in (bo.get("markets") or {}).items():
            sel = []
            for oid, o in (m.get("outcomes") or {}).items():
                for p in (o.get("players") or {}).values():
                    if p.get("active") and p.get("price"):
                        sel.append({
                            "secenek": mnames.get("o" + str(oid)) or p.get("bookmakerOutcomeId") or oid,
                            "oran": p["price"],
                        })
            if sel:
                markets.append({
                    "pazar": mnames.get(str(mid)) or m.get("bookmakerMarketId") or mid,
                    "secenekler": sel,
                })
        out.append({
            "fixtureId": fx.get("fixtureId"),
            "lig": names.get(fx.get("tournamentId"), fx.get("tournamentId")),
            "takim1": fx.get("participant1Name") or fx.get("participant1Id"),
            "takim2": fx.get("participant2Name") or fx.get("participant2Id"),
            "durum": fx.get("statusName") or status,
            "skor": fx.get("scores") or fx.get("score") or fx.get("periods"),
            "melbet_link": bo.get("fixturePath"),
            "pazarlar": markets,
        })
        if len(out) >= en_fazla_mac:
            break
    return {"canli_mac_sayisi": len(out), "maclar": out}


def _sim(so_a: float, so_b: float, a: int, b: int, a_serves: bool, target: int, n: int) -> list[tuple[int, int]]:
    res = []
    for _ in range(n):
        x, y, s = a, b, a_serves
        while not ((x >= target or y >= target) and abs(x - y) >= 2):
            p_a = (1 - so_b) if s else so_a
            if random.random() < p_a:
                x += 1
                s = True
            else:
                y += 1
                s = False
        res.append((x, y))
    return res


@mcp.tool()
def set_simulasyonu(
    sideout_a: float,
    sideout_b: float,
    skor_a: int = 0,
    skor_b: int = 0,
    servis_a_da: bool = True,
    hedef: int = 25,
    toplam_cizgileri: list[float] | None = None,
    handikap_cizgileri: list[float] | None = None,
    takim_toplam_cizgileri: list[float] | None = None,
) -> dict:
    """Bir seti mevcut skordan 20.000 kez simüle eder.

    sideout_a/b: takımların rakip servisinde sayı kazanma oranı (örn. erkek ~0.66, kadın ~0.60).
    hedef: normal set 25, 5. set 15.
    Çizgiler verilirse Üst/Alt, A'nın handikap (-x) ve takım toplamı olasılıklarını döndürür.
    """
    R = _sim(sideout_a, sideout_b, skor_a, skor_b, servis_a_da, hedef, 20000)
    n = len(R)

    def pct(cond) -> float:
        return round(100 * sum(1 for r in R if cond(r)) / n, 1)

    out: dict[str, Any] = {"A_seti_alir_%": pct(lambda r: r[0] > r[1])}
    for L in toplam_cizgileri or []:
        out[f"toplam_ust_{L}_%"] = pct(lambda r, L=L: sum(r) > L)
    for h in handikap_cizgileri or []:
        out[f"A_-{h}_%"] = pct(lambda r, h=h: r[0] - r[1] > h)
        out[f"B_+{h}_%"] = pct(lambda r, h=h: r[0] - r[1] < h)
    for L in takim_toplam_cizgileri or []:
        out[f"A_ust_{L}_%"] = pct(lambda r, L=L: r[0] > L)
        out[f"B_ust_{L}_%"] = pct(lambda r, L=L: r[1] > L)
    return out


if __name__ == "__main__":
    mcp.run(transport="streamable-http")
