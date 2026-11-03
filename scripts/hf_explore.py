import duckdb, json
B = "https://huggingface.co/datasets/eatpizzanot/soccer-dataset/resolve/main/"
c = duckdb.connect(); c.execute("INSTALL httpfs; LOAD httpfs;")
out = {}
for t in ["fixtures", "match_stats", "odds", "league_catalogue", "leagues", "fixture_lineups", "fixture_players_stats_flat", "xg_training", "teams"]:
    u = f"{B}{t}.parquet"
    try:
        schema = c.execute(f"DESCRIBE SELECT * FROM read_parquet('{u}')").fetchall()
        n = c.execute(f"SELECT count(*) FROM read_parquet('{u}')").fetchone()[0]
        sample = c.execute(f"SELECT * FROM read_parquet('{u}') LIMIT 2").fetchdf().astype(str).to_dict("records")
        out[t] = {"rows": n, "cols": [[s[0], s[1]] for s in schema], "sample": sample}
    except Exception as e:
        out[t] = {"error": str(e)[:300]}
    print(t, out[t].get("rows"), out[t].get("error"), flush=True)
try:
    u = f"{B}fixtures.parquet"; cols = [x[0] for x in c.execute(f"DESCRIBE SELECT * FROM read_parquet('{u}')").fetchall()]
    d = next((k for k in cols if "date" in k.lower()), None)
    if d: out["fixturesRange"] = [str(v) for v in c.execute(f"SELECT min({d}), max({d}), count(*) FILTER (WHERE {d} >= '2026-10-01') FROM read_parquet('{u}')").fetchone()]
except Exception as e: out["fixturesRange"] = str(e)[:200]
json.dump(out, open("docs/hf.json", "w"), ensure_ascii=False, indent=0, default=str)
