"""
IFF Snowflake Streamlit App — operator/investor cross-link.
Lives at: app.snowflake.com/yshoftq/ql22196/#/streamlit-apps

Reads from IFF_SEAFOOD.OPS.V_SIGNALS_LATEST and ANALYTICS.MODEL_FORECASTS.
Cross-links to Cloudflare-hosted dashboards (app.cantekhi.com, etc.) so
operators can drill from a Snowflake worksheet into the live UI and back.
"""

import streamlit as st
import pandas as pd
from snowflake.snowpark.context import get_active_session

st.set_page_config(
    page_title="IFF Operator Dashboard",
    page_icon="🐟",
    layout="wide",
)

session = get_active_session()

# ---------- Theme ----------
PRIMARY = "#0B5394"   # IFF deep ocean blue
ACCENT = "#D97706"    # IFF salmon orange
INK = "#0F172A"

st.markdown(f"""
<style>
  .iff-hero {{
    background: linear-gradient(135deg, {PRIMARY} 0%, #1E3A8A 100%);
    color: white; padding: 24px 32px; border-radius: 12px; margin-bottom: 24px;
  }}
  .iff-hero h1 {{ margin: 0; font-size: 28px; font-weight: 700; }}
  .iff-hero p  {{ margin: 4px 0 0; opacity: 0.9; }}
  .iff-card {{
    background: white; border: 1px solid #E5E7EB; border-radius: 12px;
    padding: 16px; box-shadow: 0 1px 2px rgba(0,0,0,.04);
  }}
  .iff-pill {{
    display: inline-block; padding: 2px 10px; border-radius: 999px;
    font-size: 12px; font-weight: 600; background: #E0F2FE; color: {PRIMARY};
  }}
</style>
""", unsafe_allow_html=True)

st.markdown("""
<div class="iff-hero">
  <h1>IFF Unified Operator Dashboard</h1>
  <p>Live signals · Model forecasts · Marketplace · Tariff scenarios · Research</p>
</div>
""", unsafe_allow_html=True)

# ---------- Cross-links ----------
st.markdown("### Quick links")
c1, c2, c3, c4, c5, c6 = st.columns(6)
with c1: st.link_button("🎣 Harvester",  "https://harvester.cantekhi.com")
with c2: st.link_button("🔨 Auction",    "https://auction.cantekhi.com")
with c3: st.link_button("👨‍🍳 Chef",       "https://chef.cantekhi.com")
with c4: st.link_button("🛒 Market",     "https://market.cantekhi.com")
with c5: st.link_button("🛍 Shop",       "https://shop.cantekhi.com")
with c6: st.link_button("📈 Investor v32","https://iff-app-2mw.pages.dev/v32/")

# ---------- KPIs ----------
st.markdown("### Today's signals")
try:
    signals_df = session.sql("""
        SELECT SIGNAL_ID, KIND, SPECIES, VALUE, UNIT, CONFIDENCE, DIRECTION, COMPUTED_AT
        FROM IFF_SEAFOOD.OPS.V_SIGNALS_LATEST
        WHERE KIND IN ('composite','model')
        ORDER BY KIND, SIGNAL_ID
    """).to_pandas()
except Exception as e:
    st.warning(f"Signals view not available yet: {e}")
    signals_df = pd.DataFrame()

if not signals_df.empty:
    composites = signals_df[signals_df["KIND"] == "composite"].head(8)
    cols = st.columns(min(4, len(composites)))
    for i, (_, row) in enumerate(composites.iterrows()):
        with cols[i % len(cols)]:
            arrow = "▲" if row["DIRECTION"] == "up" else ("▼" if row["DIRECTION"] == "down" else "→")
            color = ACCENT if row["DIRECTION"] == "up" else ("#10B981" if row["DIRECTION"] == "down" else "#64748B")
            st.markdown(f"""
            <div class="iff-card">
              <div style="font-size:11px; color:#64748B; text-transform:uppercase; letter-spacing:.5px;">
                {row['SIGNAL_ID']} · {row['SPECIES'] or 'all'}
              </div>
              <div style="font-size:24px; font-weight:700; color:{INK}; margin-top:4px;">
                {row['VALUE']:.2f} <span style="font-size:14px; font-weight:400; color:#64748B;">{row['UNIT'] or ''}</span>
              </div>
              <div style="margin-top:6px;">
                <span class="iff-pill" style="background:{color}1A; color:{color};">{arrow} {row['DIRECTION'] or '—'}</span>
                <span style="font-size:11px; color:#64748B; margin-left:6px;">conf {row['CONFIDENCE']:.0%}</span>
              </div>
            </div>
            """, unsafe_allow_html=True)

# ---------- Model forecasts ----------
st.markdown("### Model forecasts (M11 · M16 · M19)")
try:
    forecast_df = session.sql("""
        SELECT MODEL_ID, SPECIES, HORIZON_MONTHS, FORECAST_VALUE, CONFIDENCE_LOW, CONFIDENCE_HIGH, COMPUTED_AT
        FROM IFF_SEAFOOD.ANALYTICS.MODEL_FORECASTS
        QUALIFY ROW_NUMBER() OVER (PARTITION BY MODEL_ID, SPECIES, HORIZON_MONTHS
                                   ORDER BY COMPUTED_AT DESC) = 1
        ORDER BY MODEL_ID, SPECIES
    """).to_pandas()
    st.dataframe(forecast_df, use_container_width=True, hide_index=True)
except Exception as e:
    st.info(f"Forecasts not loaded: {e}")

# ---------- Marketplace pulse ----------
st.markdown("### Marketplace pulse")
try:
    lots_df = session.sql("""
        SELECT STATUS, COUNT(*) AS N_LOTS, SUM(WEIGHT_KG) AS WEIGHT_KG,
               AVG(LISTING_PRICE) AS AVG_PRICE
        FROM IFF_SEAFOOD.MARKETPLACE.LOTS
        WHERE CREATED_AT >= DATEADD(day, -7, CURRENT_TIMESTAMP())
        GROUP BY STATUS ORDER BY N_LOTS DESC
    """).to_pandas()
    st.dataframe(lots_df, use_container_width=True, hide_index=True)
except Exception as e:
    st.info(f"Marketplace data pending: {e}")

# ---------- Active tariff scenarios ----------
st.markdown("### Active tariff scenarios")
try:
    tariff_df = session.sql("""
        SELECT SCENARIO_ID, ACTIVATED_AT, ACTIVATED_BY, NOTES
        FROM IFF_SEAFOOD.OPS.ACTIVE_TARIFF_SCENARIOS
        WHERE DEACTIVATED_AT IS NULL
        ORDER BY ACTIVATED_AT DESC
    """).to_pandas()
    if tariff_df.empty:
        st.success("No active tariff scenarios")
    else:
        st.dataframe(tariff_df, use_container_width=True, hide_index=True)
except Exception as e:
    st.info(f"Tariff data pending: {e}")

# ---------- Research scans ----------
st.markdown("### Recent research (Perplexity bridge)")
try:
    scans_df = session.sql("""
        SELECT SCAN_ID, TOPIC, STATUS, RAN_AT
        FROM IFF_SEAFOOD.RESEARCH.SCANS
        ORDER BY RAN_AT DESC LIMIT 25
    """).to_pandas()
    st.dataframe(scans_df, use_container_width=True, hide_index=True)
except Exception as e:
    st.info(f"Research bridge pending: {e}")

st.markdown("---")
st.caption("IFF Unified Platform · Snowflake operator view · Connected to Cloudflare Worker api.cantekhi.com")
