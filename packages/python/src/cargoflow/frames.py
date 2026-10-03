"""Data-frame conversion: pandas by default, polars when installed (``pip install cargoflow[polars]``)."""

from __future__ import annotations

from typing import Any, Iterable, Literal, Sequence

import pandas as pd
from pydantic import BaseModel

Backend = Literal["pandas", "polars"]


def _records(models: Iterable[BaseModel | dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for m in models:
        if isinstance(m, BaseModel):
            # extra (newer) API fields are included: models allow them
            out.append(m.model_dump(mode="python", by_alias=False))
        else:
            out.append(dict(m))
    return out


def models_to_frame(models: Sequence[BaseModel | dict[str, Any]], backend: Backend | str = "pandas"):
    """One row per model; nested objects become ``parent_child`` columns, lists stay as Python lists."""
    records = _records(models)
    df = pd.json_normalize(records, sep="_") if records else pd.DataFrame()
    return convert(df, backend)


def convert(df: pd.DataFrame, backend: Backend | str = "pandas"):
    """Returns ``df`` as is (pandas) or as a polars DataFrame."""
    if backend == "pandas":
        return df
    if backend == "polars":
        try:
            import polars as pl
        except ImportError as exc:  # pragma: no cover - exercised only without the extra
            raise ImportError("polars is not installed: pip install 'cargoflow[polars]'") from exc
        if df.empty:
            return pl.DataFrame({c: [] for c in df.columns})
        cols: dict[str, Any] = {}
        for c in df.columns:
            s = df[c]
            if pd.api.types.is_datetime64_any_dtype(s):
                naive = s.dt.tz_convert("UTC").dt.tz_localize(None) if s.dt.tz is not None else s
                arr = naive.to_numpy().astype("datetime64[us]")
                cols[c] = pl.Series(c, arr).dt.replace_time_zone("UTC") if s.dt.tz is not None else pl.Series(c, arr)
            else:
                cols[c] = pl.Series(c, s.tolist(), strict=False)
        return pl.DataFrame(cols)
    raise ValueError(f"unknown backend {backend!r}; use 'pandas' or 'polars'")
