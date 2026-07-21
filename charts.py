"""
All chart-building logic, adapted from the original Colab notebook.
Every function takes/returns a pandas DataFrame or a Plotly figure so the
Flask app can assemble a full dashboard page for whichever MATOC was picked.
"""
import numpy as np
import pandas as pd
import plotly.graph_objects as go
import plotly.express as px
from plotly.subplots import make_subplots

BG, BG2, BG3 = "#0D1117", "#161B22", "#21262D"
ACCENT, GREEN, RED, GOLD, PURPLE = "#58A6FF", "#3FB950", "#F78166", "#E3B341", "#BC8CFF"
TEXT, TEXT2, GRID = "#F0F6FC", "#8B949E", "#30363D"

# Name your own company is tagged with when it's the winner (Result == "WON"),
# used by the market-share / revenue-distribution extension charts below.
OUR_COMPANY = "Addon Services LLC"


def apply_theme(fig, title="", height=500):
    fig.update_layout(
        height=height,
        title=dict(text=title, font=dict(size=16, color=TEXT, family="Arial"), x=0.01, y=0.97),
        paper_bgcolor=BG2, plot_bgcolor=BG2,
        font=dict(color=TEXT2, size=11, family="Arial"),
        legend=dict(bgcolor=BG3, bordercolor=GRID, borderwidth=1, font=dict(color=TEXT2, size=10)),
        margin=dict(l=100, r=60, t=90, b=120),
        hoverlabel=dict(bgcolor=BG3, font_color=TEXT, font_size=12),
    )
    fig.update_xaxes(gridcolor=GRID, zerolinecolor=GRID, tickfont=dict(color=TEXT2, size=10),
                      title_font=dict(color=TEXT2, size=11), automargin=True)
    fig.update_yaxes(gridcolor=GRID, zerolinecolor=GRID, tickfont=dict(color=TEXT2, size=10),
                      title_font=dict(color=TEXT2, size=11), automargin=True)
    return fig


def dynamic_height(n_items, base=500, per_item=32, min_h=400, max_h=1400):
    return int(np.clip(base + n_items * per_item, min_h, max_h))


PROJECT_TYPE_PALETTE = (
    px.colors.qualitative.Set2 + px.colors.qualitative.Set3 + px.colors.qualitative.Pastel
)


def project_type_color_map(df: pd.DataFrame) -> dict:
    """Assigns each Project Type ONE fixed color (e.g. 'Office Renovation' is
    always the same color everywhere it appears), based on the full dataset -
    not on whatever subset happens to be plotted."""
    types = sorted(df["Project Type"].dropna().unique())
    return {t: PROJECT_TYPE_PALETTE[i % len(PROJECT_TYPE_PALETTE)] for i, t in enumerate(types)}


def price_band(pct):
    if pct <= -50:  return "Priced <= -50% (Very Low)"
    elif pct < 0:   return "Below Winner (-50% to 0%)"
    elif pct == 0:  return "Exact Match (tied the winning price)"
    elif pct < 50:  return "Overpriced 1-50%"
    elif pct < 100: return "Overpriced 50-99%"
    else:           return "OVERPRICED 100%+ CRITICAL"


def prepare_dataframe(df: pd.DataFrame, exclude_asterisk_bids: bool = True) -> pd.DataFrame:
    """Clean + derive columns, same logic as Step 4 of the original script.

    exclude_asterisk_bids: the "Asterisk Bid" filter toggle.
      True  (default / ON)  -> rows flagged "Asterisk Bid" = YES are treated
                               as No Bid: Result becomes "NB" and their bid
                               pricing is zeroed out of every calculation.
      False (OFF)           -> those rows are left completely untouched and
                               count normally under whatever their real
                               Result/pricing actually was.
    """
    df = df.copy()
    df.columns = df.columns.str.strip()

    for col in ["Contract Value", "Addon Bid", "Winner Price Difference $",
                "Winner Price Difference %", "Number of Offers Received", "Mods", "Total"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)
        else:
            df[col] = 0

    df["PriceDiffPct"] = df["Winner Price Difference %"] * 100
    df["Year"] = df["Year"].astype(str)
    df["Result"] = df["Result"].astype(str).str.strip().str.upper()
    df["Project Type"] = df["Project Type"].astype(str).str.strip().fillna("Unspecified")

    df["Awardee_short"] = (
        df["Awardee"].astype(str)
        .str.replace(r"(LLC|INC|JV|Corp|Services|Facility|Support|\.|,)", "", regex=True)
        .str.strip().str[:24]
    )
    df["PriceBand"] = df["PriceDiffPct"].apply(price_band)
    df["Asterisk Bid"] = (df["Asterisk Bid"].fillna("").astype(str).str.strip().str.upper())

    if exclude_asterisk_bids:
        mask = df["Asterisk Bid"] == "YES"
        # Treat as No Bid
        df.loc[mask, "Result"] = "NB"
        # Remove bid pricing calculations
        df.loc[mask, "Addon Bid"] = 0
        df.loc[mask, "Winner Price Difference $"] = 0
        df.loc[mask, "Winner Price Difference %"] = 0
        df.loc[mask, "PriceDiffPct"] = 0
    return df


def compute_kpis(df: pd.DataFrame) -> dict:
    total_bids = len(df)
    won = (df["Result"] == "WON").sum()
    lost = (df["Result"] == "LOST").sum()
    sole = (~df["Result"].isin(["WON", "LOST", "NB", "Cancelled", "CANCELLED"])).sum()
    nb = (df["Result"] == "NB").sum()
    cancel = (df["Result"] == "CANCELLED").sum()
    win_rate = round(won / total_bids * 100, 1) if total_bids else 0
    total_value = df["Contract Value"].sum()
    won_value = df[df["Result"] == "WON"]["Contract Value"].sum()
    avg_diff = df[df["Result"] == "LOST"]["PriceDiffPct"].mean() if lost > 0 else 0
    over100 = (df["PriceDiffPct"] >= 100).sum()
    avg_comp = df["Number of Offers Received"].replace(0, np.nan).mean()
    avg_comp = 0 if pd.isna(avg_comp) else avg_comp
    largest_deal = df["Contract Value"].max() if total_bids else 0
    total_mods = df["Mods"].sum()

    lost_df_kpi = df[df["Result"] == "LOST"]
    rivals = (
        lost_df_kpi[~lost_df_kpi["Awardee_short"].str.contains("ADDON", case=False, na=False)]
        ["Awardee_short"].value_counts().head(3)
    )
    top_rival_n = rivals.iloc[0] if len(rivals) > 0 else 0
    top_rival = "<br>".join([f"{name} ({count})" for name, count in rivals.items()]) or "N/A"

    return dict(total_bids=total_bids, won=won, lost=lost, sole=sole, nb=nb, cancel=cancel, win_rate=win_rate,
                total_value=total_value, won_value=won_value, avg_diff=avg_diff,
                over100=over100, avg_comp=avg_comp, largest_deal=largest_deal,
                total_mods=total_mods, top_rival=top_rival, top_rival_n=top_rival_n)


def build_kpi_html(k: dict) -> str:
    return f"""
<style>
  .kgrid{{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;font-family:Arial,sans-serif;margin:10px 0}}
  .kcard{{background:#161B22;border:1px solid #30363D;border-radius:12px;padding:18px 16px;position:relative;overflow:hidden}}
  .kcard::before{{content:'';position:absolute;top:0;left:0;right:0;height:3px}}
  .kb::before{{background:linear-gradient(90deg,#58A6FF,#79C0FF)}}
  .kg::before{{background:linear-gradient(90deg,#3FB950,#56D364)}}
  .kr::before{{background:linear-gradient(90deg,#F78166,#FF7B72)}}
  .kgo::before{{background:linear-gradient(90deg,#E3B341,#FFA657)}}
  .kp::before{{background:linear-gradient(90deg,#BC8CFF,#D2A8FF)}}
  .klbl{{font-size:10px;color:#8B949E;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px}}
  .kval{{font-size:26px;font-weight:700;color:#F0F6FC;line-height:1;margin-bottom:5px}}
  .ksub{{font-size:11px;color:#8B949E;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}}
  @media (max-width:900px){{.kgrid{{grid-template-columns:repeat(2,1fr)}}}}
</style>
<div class='kgrid'>
  <div class='kcard kb'><div class='klbl'>Total Task Order</div><div class='kval'>{k['total_bids']}</div><div class='ksub'>Won: {k['won']} &nbsp;.&nbsp; Lost: {k['lost']} &nbsp;.&nbsp; No Bid: {k['nb']} &nbsp;.&nbsp; Sole: {k['sole']} &nbsp;.&nbsp; Cancel: {k['cancel']}</div></div>
  <div class='kcard kg'><div class='klbl'>Win Rate</div><div class='kval' style='color:#3FB950'>{k['win_rate']}%</div><div class='ksub'>${k['won_value']:,.0f} revenue captured</div></div>
  <div class='kcard kr'><div class='klbl'>Avg Overpriced When Lost</div><div class='kval' style='color:#F78166'>+{k['avg_diff']:.1f}%</div><div class='ksub'>above winning bid on losses</div></div>
  <div class='kcard kgo'><div class='klbl'>Overpriced 100%+</div><div class='kval' style='color:#E3B341'>{k['over100']}</div><div class='ksub'>bids at critical overpricing</div></div>
  <div class='kcard kp'><div class='klbl'>Total Contract Value</div><div class='kval'>${k['total_value']/1e6:.1f}M</div><div class='ksub'>across all bids</div></div>
  <div class='kcard kgo'><div class='klbl'>Largest Single Contract</div><div class='kval'>${k['largest_deal']/1e6:.1f}M</div><div class='ksub'>single biggest deal</div></div>
  <div class='kcard kb'><div class='klbl'>Total Mods Value</div><div class='kval'>${k['total_mods']/1e6:.1f}M</div><div class='ksub'>post-award modifications</div></div>
  <div class='kcard kr'><div class='klbl'>Top Competitors</div><div class='kval' style='font-size:14px;line-height:1.4;padding-top:4px'>{k['top_rival']}</div><div class='ksub'>companies winning most often</div></div>
</div>
"""


def build_heatmap(df: pd.DataFrame):
    lost_df = df[df["Result"] == "LOST"].copy()
    if len(lost_df) == 0:
        return None
    top_cos = lost_df["Awardee_short"].value_counts().head(10).index
    hm_df = lost_df[lost_df["Awardee_short"].isin(top_cos)]
    pivot = hm_df.pivot_table(index="Project Type", columns="Awardee_short",
                               values="PriceDiffPct", aggfunc="mean").round(1)
    if pivot.empty:
        return None
    hm_h = dynamic_height(len(pivot), base=400, per_item=40, min_h=400, max_h=900)
    z_max = np.nanmax(np.abs(pivot.values)) if np.isfinite(pivot.values).any() else 100
    fig = go.Figure(go.Heatmap(
        z=pivot.values, x=list(pivot.columns), y=list(pivot.index),
        colorscale=[[0, GREEN], [0.5, GOLD], [1, "#8B0000"]],
        zmid=0, zmin=-z_max, zmax=z_max,
        xgap=2, ygap=2, hoverongaps=False,
        text=[[("" if pd.isna(v) else f"{v:.0f}%") for v in row] for row in pivot.values],
        texttemplate="%{text}", textfont=dict(size=11, color="white"),
        hovertemplate="<b>Project:</b> %{y}<br><b>Winner:</b> %{x}<br><b>Avg Overbid:</b> +%{z:.1f}%<extra></extra>",
        colorbar=dict(title=dict(text="% Over Winner", font=dict(color=TEXT2, size=10)),
                      tickfont=dict(color=TEXT2), bgcolor=BG2, bordercolor=GRID)
    ))
    apply_theme(fig, "PRICING HEATMAP - How Much We Overprice vs Each Competitor by Project Type", hm_h)
    fig.update_xaxes(tickangle=-45)
    return fig


def build_price_bands(df: pd.DataFrame):
    fig = make_subplots(
        rows=1, cols=2,
        subplot_titles=("Price Bands - Bids We Lost", "50%+ OVERPRICED - By Project Type"),
        specs=[[{"type": "pie"}, {"type": "bar"}]], horizontal_spacing=0.20,
    )
    band_color_map = {
        "Priced <= -50% (Very Low)": GREEN, "Below Winner (-50% to 0%)": "#56D364",
        "Exact Match (tied the winning price)": TEXT2, "Overpriced 1-50%": "#FFA657",
        "Overpriced 50-99%": RED, "OVERPRICED 100%+ CRITICAL": "#FF0000",
    }

    band_df = df[df["Result"].str.upper() == "LOST"].copy()
    band_counts = band_df["PriceBand"].value_counts()
    pie_colors = [band_color_map.get(b, ACCENT) for b in band_counts.index]
    fig.add_trace(go.Pie(labels=band_counts.index, values=band_counts.values, hole=0.55,
                          marker=dict(colors=pie_colors, line=dict(color=BG, width=2)),
                          textinfo="percent", textfont=dict(size=11, color=TEXT),
                          hoverinfo="label+percent", name=""), row=1, col=1)

    color_map = project_type_color_map(df)
    critical_df = band_df[band_df["PriceDiffPct"] >= 50].copy()
    if len(critical_df) > 0:
        crit_proj = (critical_df.groupby("Project Type")
                     .agg(Count=("PriceDiffPct", "count"), AvgOver=("PriceDiffPct", "mean"))
                     .sort_values("AvgOver", ascending=True).reset_index())
        bar_colors = [color_map.get(pt, ACCENT) for pt in crit_proj["Project Type"]]
        fig.add_trace(go.Bar(
            y=crit_proj["Project Type"], x=crit_proj["AvgOver"], orientation="h",
            marker=dict(color=bar_colors),
            text=[f" +{v:.0f}% ({c} bid{'s' if c != 1 else ''})" for v, c in zip(crit_proj["AvgOver"], crit_proj["Count"])],
            textposition="outside", textfont=dict(color=TEXT, size=10),
            showlegend=False,
            hovertemplate="<b>%{y}</b><br>Avg over winning bid: +%{x:.1f}%<extra></extra>"
        ), row=1, col=2)

    pb_h = dynamic_height(len(critical_df.groupby("Project Type")) if len(critical_df) > 0 else 0, base=460, per_item=28)
    apply_theme(fig, "PRICE DIFFERENCE BREAKDOWN - Full Bands (Losses/No-Bids) + 50%+ Overpriced", pb_h)
    fig.update_layout(showlegend=True, legend=dict(x=-0.05, y=-0.25, orientation="h"))
    fig.update_xaxes(title="Avg % Above Winning Bid", row=1, col=2)

    if len(critical_df) > 0:
        max_val = crit_proj["AvgOver"].max()
        fig.update_xaxes(range=[0, max_val * 1.45], row=1, col=2)
    fig.update_layout(margin=dict(r=140))
    return fig


def build_competitor_intel(df: pd.DataFrame):
    df_comp = df.copy()
    df_comp["Result"] = df_comp["Result"].fillna("").astype(str).str.strip().str.upper()
    df_comp = df_comp[df_comp["Result"].isin(["WON", "LOST"])]

    comp = df_comp.groupby("Awardee_short").agg(
        TheyBeatUs=("Result", lambda x: (x == "LOST").sum()),
        TotalWins=("Result", lambda x: (x == "WON").sum()),
        TotalValue=("Contract Value", "sum"),
        AvgPriceDiff=("PriceDiffPct", "mean"),
    ).reset_index()

    comp = comp[comp["TheyBeatUs"] > 0]
    comp = comp.sort_values("TheyBeatUs", ascending=False).head(12)

    if comp.empty:
        return None

    comp_h = dynamic_height(len(comp), base=400, per_item=36, min_h=420)

    fig = make_subplots(
        rows=1, cols=2,
        subplot_titles=("Times Each Company Beat Us", "Contract Value Won by Each Company ($M)"),
        horizontal_spacing=0.22,
    )

    bar_cols = [RED if v > 3 else GOLD if v > 1 else GREEN for v in comp["TheyBeatUs"]]
    fig.add_trace(go.Bar(
        y=comp["Awardee_short"], x=comp["TheyBeatUs"], orientation="h",
        marker=dict(color=bar_cols), text=comp["TheyBeatUs"], textposition="outside",
        textfont=dict(color=TEXT, size=10), showlegend=False,
        hovertemplate="<b>%{y}</b><br>Beat us %{x} times<extra></extra>",
    ), row=1, col=1)

    comp_val = comp.sort_values("TotalValue", ascending=False)
    fig.add_trace(go.Bar(
        y=comp_val["Awardee_short"], x=comp_val["TotalValue"] / 1e6, orientation="h",
        marker=dict(color=comp_val["TotalValue"], colorscale=[[0, PURPLE], [1, ACCENT]]),
        text=[f"${v:.1f}M" for v in comp_val["TotalValue"] / 1e6], textposition="outside",
        textfont=dict(color=TEXT, size=10), showlegend=False,
        hovertemplate="<b>%{y}</b><br>$%{x:.1f}M total value<extra></extra>",
    ), row=1, col=2)

    apply_theme(fig, "COMPETITOR INTELLIGENCE - Key Market Rivals Profile", comp_h)
    fig.update_xaxes(title="Times They Won Against Us", row=1, col=1)
    fig.update_xaxes(title="Total Contract Value ($M)", row=1, col=2)
    return fig


def build_missed_revenue_radar(df: pd.DataFrame):
    sc_df = df.copy()
    sc_df["Result"] = sc_df["Result"].fillna("").astype(str).str.strip().str.upper()
    sc_df = sc_df[sc_df["Result"].isin(["WON", "LOST"])]

    if sc_df.empty:
        return None

    sc_df = sc_df.dropna(subset=["Contract Value", "PriceDiffPct"])
    sc_df["BubbleSize"] = np.sqrt(sc_df["Contract Value"].clip(lower=1)) / 80

    top_ids = sc_df[(sc_df["Result"] == "LOST") & (sc_df["PriceDiffPct"] >= 50)].nlargest(3, "Contract Value").index
    fig = go.Figure()

    for result in ["LOST", "WON"]:
        grp = sc_df[sc_df["Result"] == result]
        if grp.empty: continue
        color = RED if result == "LOST" else GREEN
        labels = []

        for idx, row in grp.iterrows():
            if result == "LOST" and idx in top_ids:
                labels.append(f"{str(row['Project Type'])[:18]}... (+{row['PriceDiffPct']:.0f}%)")
            else:
                labels.append("")

        fig.add_trace(go.Scatter(
            x=grp["Contract Value"] / 1e6, y=grp["PriceDiffPct"], mode="markers+text",
            name=result, text=labels, textposition="top right", textfont=dict(color=color, size=10),
            marker=dict(size=grp["BubbleSize"].clip(8,45), color=color, opacity=0.75, line=dict(width=1, color=BG)),
            customdata=grp[["Project Type", "Awardee_short", "PriceDiffPct"]].values,
            hovertemplate="<b>%{customdata[0]}</b><br>Winner: %{customdata[1]}<br>Contract Value: $%{x:.2f}M<br>Price Difference: %{y:.1f}%<extra></extra>"
        ))

    fig.add_hline(y=0, line=dict(color=TEXT2, dash="dot", width=1))
    fig.add_hline(y=50, line=dict(color=GOLD, dash="dash", width=1.5), annotation_text="50% Overpriced", annotation_font_color=GOLD, annotation_position="top left")
    fig.add_hline(y=100, line=dict(color=RED, dash="dash", width=1.5), annotation_text="100% Overpriced", annotation_font_color=RED, annotation_position="top left")

    apply_theme(fig, "MISSED REVENUE RADAR - Contract Size vs Price Overrun", 560)
    fig.update_xaxes(title="Contract Value ($M)")
    fig.update_yaxes(title="Our Bid vs Winning Bid (%)")
    return fig


def build_project_deep_dive(df: pd.DataFrame):
    proj = df.groupby("Project Type").agg(
        TotalBids=("Result", "count"),
        Wins=("Result", lambda x: (x == "WON").sum()),
        TotalValue=("Contract Value", "sum"),
        Over100=("PriceDiffPct", lambda x: (x >= 100).sum()),
    ).reset_index()

    avg_lost = df[df["Result"] == "LOST"].groupby("Project Type")["PriceDiffPct"].mean().reset_index(name="AvgPriceDiff")
    proj = proj.merge(avg_lost, on="Project Type", how="left")
    proj["AvgPriceDiff"] = proj["AvgPriceDiff"].fillna(0)
    proj["WinRate"] = (proj["Wins"] / proj["TotalBids"] * 100).round(1)
    proj = proj.sort_values("TotalValue", ascending=False)

    if proj.empty:
        return None, False

    n_proj = len(proj)
    scroll_proj = n_proj > 6
    proj_h = dynamic_height(n_proj, base=760, per_item=18, min_h=700, max_h=1200)
    tick_angle = -45 if n_proj > 5 else -30

    fig = make_subplots(
        rows=2, cols=2,
        subplot_titles=("Total Contract Value by Project ($M)", "Win Rate by Project Type (%)",
                        "Avg Price Difference % (When Lost)", "Count of 100%+ Overpriced Bids"),
        vertical_spacing=0.28, horizontal_spacing=0.14,
    )

    value_df = proj[proj["TotalValue"] > 0]
    fig.add_trace(go.Bar(
        x=value_df["Project Type"], y=value_df["TotalValue"] / 1e6,
        marker=dict(color=value_df["TotalValue"], colorscale=[[0, PURPLE], [1, ACCENT]]),
        text=[f"${v:.1f}M" for v in value_df["TotalValue"] / 1e6], textposition="outside",
        textfont=dict(color=TEXT, size=9), hovertemplate="<b>%{x}</b><br>$%{y:.1f}M<extra></extra>",
    ), row=1, col=1)

    win_df = proj[proj["WinRate"] > 0]
    fig.add_trace(go.Bar(
        x=win_df["Project Type"], y=win_df["WinRate"],
        marker=dict(color=[GREEN if w >= 30 else GOLD if w >= 15 else RED for w in win_df["WinRate"]]),
        text=[f"{v:.0f}%" for v in win_df["WinRate"]], textposition="outside",
        textfont=dict(color=TEXT, size=9), hovertemplate="<b>%{x}</b><br>Win Rate: %{y:.1f}%<extra></extra>",
    ), row=1, col=2)

    price_df = proj[proj["AvgPriceDiff"] != 0]
    fig.add_trace(go.Bar(
        x=price_df["Project Type"], y=price_df["AvgPriceDiff"],
        marker=dict(color=[RED if d > 50 else GOLD if d > 0 else GREEN for d in price_df["AvgPriceDiff"]]),
        text=[f"+{v:.0f}%" if v > 0 else f"{v:.0f}%" for v in price_df["AvgPriceDiff"]], textposition="outside",
        textfont=dict(color=TEXT, size=9), hovertemplate="<b>%{x}</b><br>Avg over winner: %{y:.1f}%<extra></extra>",
    ), row=2, col=1)

    over100_df = proj[proj["Over100"] > 0]
    fig.add_trace(go.Bar(
        x=over100_df["Project Type"], y=over100_df["Over100"], marker=dict(color=RED),
        text=over100_df["Over100"], textposition="outside", textfont=dict(color=TEXT, size=10),
        hovertemplate="<b>%{x}</b><br>%{y} bids at 100%+ overpriced<extra></extra>",
    ), row=2, col=2)

    apply_theme(fig, "PROJECT TYPE DEEP DIVE - Market Capacity, Win Rates & Pricing Leakage", proj_h)
    fig.update_layout(showlegend=False)
    fig.update_xaxes(tickangle=tick_angle, automargin=True)
    return fig, scroll_proj


def build_year_over_year(df: pd.DataFrame):
    yr = df.groupby("Year").agg(
        TotalBids=("Result", "count"), Wins=("Result", lambda x: (x == "WON").sum()),
        TotalValue=("Contract Value", "sum"), AvgPriceDiff=("PriceDiffPct", "mean"),
    ).reset_index()
    if yr.empty:
        return None
    yr["WinRate"] = (yr["Wins"] / yr["TotalBids"] * 100).round(1)

    fig = make_subplots(rows=1, cols=3, subplot_titles=("Bids Submitted", "Win Rate Trend (%)", "Avg Price Diff (%)"),
                         horizontal_spacing=0.12)
    fig.add_trace(go.Bar(x=yr["Year"], y=yr["TotalBids"], marker=dict(color=ACCENT, opacity=0.85),
                          text=yr["TotalBids"], textposition="outside", textfont=dict(color=TEXT)), row=1, col=1)
    fig.add_trace(go.Scatter(x=yr["Year"], y=yr["WinRate"], mode="lines+markers+text",
                              line=dict(color=GREEN, width=3), marker=dict(size=10, color=GREEN),
                              text=[f"{v:.0f}%" for v in yr["WinRate"]], textposition="top center",
                              textfont=dict(color=GREEN, size=11)), row=1, col=2)
    fig.add_trace(go.Scatter(x=yr["Year"], y=yr["AvgPriceDiff"], mode="lines+markers+text",
                              line=dict(color=GOLD, width=3), marker=dict(size=10, color=GOLD),
                              text=[f"+{v:.0f}%" if v > 0 else f"{v:.0f}%" for v in yr["AvgPriceDiff"]], textposition="top center",
                              textfont=dict(color=GOLD, size=11)), row=1, col=3)
    apply_theme(fig, "YEAR-OVER-YEAR TRENDS - Macro Corporate Direction", 420)
    fig.update_layout(showlegend=False)
    return fig


def build_critical_table_html(df: pd.DataFrame) -> str:
    critical_df = df[df["PriceDiffPct"] >= 100].copy()
    if critical_df.empty:
        return ""
    rows_html = ""
    for _, r in critical_df.sort_values("PriceDiffPct", ascending=False).iterrows():
        our_bid = f"${r['Addon Bid']:,.0f}" if r["Addon Bid"] > 0 else "N/A"
        rows_html += f"""
        <tr>
          <td>{r['Year']}</td><td>{r['Project Type']}</td><td>{r['Awardee']}</td>
          <td style='text-align:right'>${r['Contract Value']:,.0f}</td>
          <td style='text-align:right'>{our_bid}</td>
          <td style='text-align:right'>${r['Winner Price Difference $']:,.0f}</td>
          <td style='color:#FF6B6B;font-weight:700;text-align:right'>+{r['PriceDiffPct']:.1f}%</td>
          <td>{r['Result']}</td>
        </tr>"""
    return f"""
    <div style='background:#161B22;border:1px solid #30363D;border-radius:12px;padding:24px;margin-bottom:28px'>
      <h2 style='color:#F78166;margin:0 0 16px 0;font-size:18px'>
        CRITICAL OVERPRICING - {len(critical_df)} Bids Where We Were 100%+ Above Winner
      </h2>
      <div style='overflow-x:auto'>
        <table style='width:100%;border-collapse:collapse;font-size:13px'>
          <thead><tr style='background:#21262D'>
            <th style='padding:10px 12px;color:#58A6FF;text-align:left;border-bottom:1px solid #30363D'>Year</th>
            <th style='padding:10px 12px;color:#58A6FF;text-align:left;border-bottom:1px solid #30363D'>Project Type</th>
            <th style='padding:10px 12px;color:#58A6FF;text-align:left;border-bottom:1px solid #30363D'>Winner (Beat Us)</th>
            <th style='padding:10px 12px;color:#58A6FF;text-align:right;border-bottom:1px solid #30363D'>Their Contract $</th>
            <th style='padding:10px 12px;color:#58A6FF;text-align:right;border-bottom:1px solid #30363D'>Our Bid $</th>
            <th style='padding:10px 12px;color:#58A6FF;text-align:right;border-bottom:1px solid #30363D'>We Overbid By $</th>
            <th style='padding:10px 12px;color:#58A6FF;text-align:right;border-bottom:1px solid #30363D'>We Were Over %</th>
            <th style='padding:10px 12px;color:#58A6FF;text-align:left;border-bottom:1px solid #30363D'>Result</th>
          </tr></thead>
          <tbody style='color:#F0F6FC'>{rows_html}</tbody>
        </table>
      </div>
    </div>"""


def build_ceo_brief_html(df: pd.DataFrame, k: dict) -> str:
    critical_df = df[df["PriceDiffPct"] >= 100].copy()
    worst_pricing = df[df["PriceDiffPct"] > 0].groupby("Project Type")["PriceDiffPct"].mean().nlargest(2)
    worst_proj_str = ", ".join([f"{n} (+{v:.0f}%)" for n, v in worst_pricing.items()]) or "N/A"
    crit100_grp = critical_df.groupby("Project Type")["PriceDiffPct"].mean().nlargest(1)
    worst_crit_str = f"{crit100_grp.index[0]} (+{crit100_grp.iloc[0]:.0f}%)" if len(crit100_grp) > 0 else "None"
    pct_captured = (k["won_value"] / k["total_value"] * 100) if k["total_value"] else 0

    return f"""
<style>
  .brief{{background:#161B22;border:1px solid #30363D;border-radius:14px;padding:26px 30px;font-family:Arial,sans-serif;max-width:920px}}
  .btitle{{color:#58A6FF;font-size:20px;font-weight:700;margin-bottom:18px;border-bottom:1px solid #30363D;padding-bottom:10px}}
  .brow{{display:flex;align-items:flex-start;margin-bottom:15px}}
  .bicon{{font-size:20px;margin-right:14px;min-width:28px}}
  .btext{{color:#F0F6FC;font-size:13px;line-height:1.7}}
  .btext strong{{color:#E3B341}}
  .baction{{background:#21262D;border-left:3px solid #F78166;padding:8px 14px;border-radius:4px;margin-top:6px;color:#8B949E;font-size:12px}}
</style>
<div class='brief'>
  <div class='btitle'>CEO ACTION INTELLIGENCE BRIEF</div>
  <div class='brow'><div class='bicon'>&#127919;</div><div class='btext'>
    Win rate is <strong>{k['win_rate']}%</strong> - {k['won']} wins from {k['total_bids']} bids.
    We captured <strong>${k['won_value']/1e6:.1f}M</strong> of ${k['total_value']/1e6:.1f}M total market value ({pct_captured:.1f}%).
    <div class='baction'>-> Industry benchmark is 20-35%. Market capture rate is the true CEO metric.</div>
  </div></div>
  <div class='brow'><div class='bicon'>&#128184;</div><div class='btext'>
    When we lose, our bid is on average <strong>+{k['avg_diff']:.1f}% above the winning bid</strong>.
    Worst project types: <strong>{worst_proj_str}</strong>.
    <div class='baction'>-> Conduct cost model review on these project types. Check subcontractor rates vs market.</div>
  </div></div>
  <div class='brow'><div class='bicon'>&#128680;</div><div class='btext'>
    <strong>{k['over100']} bids</strong> were priced 100%+ above the winner. Worst category: <strong>{worst_crit_str}</strong>.
    <div class='baction'>-> These should never have been submitted. Immediate pricing audit required.</div>
  </div></div>
  <div class='brow'><div class='bicon'>&#127970;</div><div class='btext'>
    Top rival: <strong>{k['top_rival']}</strong> - beat us <strong>{k['top_rival_n']} times</strong>.
    Average competition per bid: <strong>{k['avg_comp']:.1f} bidders</strong>.
    <div class='baction'>-> Analyse their past bid prices. Renegotiate supplier costs or adjust strategy against them.</div>
  </div></div>
</div>
"""


def build_mods_vs_total(df: pd.DataFrame):
    ext = df.groupby("Project Type").agg(
        Base_Val=("Contract Value", "sum"),
        Spreadsheet_Mods=("Mods", "sum"),
    ).reset_index().sort_values("Base_Val", ascending=True)
    if ext.empty:
        return None
    fig = go.Figure()
    fig.add_trace(go.Bar(y=ext["Project Type"], x=ext["Base_Val"], name="Contract Baseline", orientation="h", marker_color=ACCENT))
    fig.add_trace(go.Bar(y=ext["Project Type"], x=ext["Spreadsheet_Mods"], name="Spreadsheet Mods Value", orientation="h", marker_color=GOLD))
    h = dynamic_height(len(ext), base=400, per_item=32, min_h=450)
    apply_theme(fig, "FINANCIAL EXTENSION GRAPH - Direct Spreadsheet Mods vs Total Volume Structure", h)
    fig.update_layout(barmode="stack", xaxis_title="Total Financial Footprint Volume ($)")
    return fig


def _winner_entity(row):
    return OUR_COMPANY if row["Result"] == "WON" else row["Awardee_short"]


def build_top_competitors_by_project(df: pd.DataFrame):
    share_df = df[df["Result"].isin(["LOST", "WON", "NB"])].copy()
    if share_df.empty:
        return None
    share_df["Winner_Entity"] = share_df.apply(_winner_entity, axis=1)

    matrix = share_df.groupby(["Project Type", "Winner_Entity"])["Total"].sum().reset_index()
    project_totals = matrix.groupby("Project Type")["Total"].transform("sum")
    matrix["Market Share %"] = (matrix["Total"] / project_totals.replace(0, np.nan) * 100).round(1).fillna(0)

    competitive_projects = matrix.groupby("Project Type")["Winner_Entity"].nunique().reset_index(name="Competitors")
    competitive_projects = competitive_projects[competitive_projects["Competitors"] > 1]["Project Type"]
    matrix = matrix[matrix["Project Type"].isin(competitive_projects)]
    if matrix.empty:
        return None
    matrix = matrix.sort_values(["Project Type", "Market Share %"], ascending=[True, False])

    fig = px.bar(matrix, y="Project Type", x="Market Share %", color="Winner_Entity",
                 orientation="h", text="Market Share %",
                 color_discrete_sequence=px.colors.qualitative.Pastel)
    fig.update_traces(texttemplate="%{x:.1f}%", textposition="inside")
    h = dynamic_height(matrix["Project Type"].nunique(), base=400, per_item=40, min_h=450)
    apply_theme(fig, "TOP COMPETITORS BY PROJECT TYPE (%)", h)
    fig.update_layout(barmode="stack", xaxis_title="Market Share (%)", yaxis_title="Project Type", legend_title="Competitor")
    fig.update_xaxes(range=[0, 100])
    return fig


def build_revenue_distribution_dropdown(df: pd.DataFrame):
    share_df = df[df["Result"].isin(["LOST", "WON", "NB"])].copy()
    if share_df.empty:
        return None
    share_df["Winner_Entity"] = share_df.apply(_winner_entity, axis=1)

    company_revenue = share_df.groupby("Winner_Entity")["Total"].sum().sort_values(ascending=False)
    companies = company_revenue.index.tolist()
    if not companies:
        return None

    fig = go.Figure()
    for i, company in enumerate(companies):
        tmp = share_df[share_df["Winner_Entity"] == company].groupby("Project Type")["Total"].sum().reset_index()
        total = tmp["Total"].sum()
        tmp["Share"] = (tmp["Total"] / total * 100) if total else 0
        fig.add_trace(go.Pie(labels=tmp["Project Type"], values=tmp["Share"], name=company,
                              visible=(i == 0), hole=0.35, textinfo="percent+label"))

    buttons = []
    for i, company in enumerate(companies):
        visibility = [False] * len(companies)
        visibility[i] = True
        buttons.append(dict(label=company, method="update",
                             args=[{"visible": visibility},
                                   {"title": f"{company} - Revenue Distribution by Project Type"}]))

    fig.update_layout(updatemenus=[dict(buttons=buttons, direction="down", showactive=True, x=1.05, y=1.15)])
    apply_theme(fig, f"{companies[0]} - Revenue Distribution by Project Type", 650)
    return fig


def build_mods_by_company_project(df: pd.DataFrame):
    mods_df = df.groupby(["Awardee_short", "Project Type"]).agg(
        Mods=("Mods", "sum"), Total_Value=("Total", "sum")
    ).reset_index()
    mods_df = mods_df[mods_df["Mods"] != 0].sort_values("Mods", ascending=True)
    if mods_df.empty:
        return None
    fig = go.Figure()
    fig.add_trace(go.Bar(
        y=mods_df["Awardee_short"] + " | " + mods_df["Project Type"],
        x=mods_df["Mods"], name="Mods Value", orientation="h", marker_color=GOLD,
        customdata=mods_df["Total_Value"],
        hovertemplate="<b>%{y}</b><br>Mods: $%{x:,.0f}<br>Total Value: $%{customdata:,.0f}<extra></extra>"
    ))
    h = dynamic_height(len(mods_df), base=400, per_item=25, min_h=450)
    apply_theme(fig, "MODIFICATION VALUE BY COMPANY & PROJECT TYPE", h)
    fig.update_layout(xaxis_title="Mods Value ($)")
    return fig


def build_full_dashboard_html(raw_df: pd.DataFrame, matoc_label: str,
                               slug: str = None, is_admin: bool = False, all_matocs: dict = None,
                               exclude_asterisk_bids: bool = True) -> str:
    """Takes the raw DB dataframe for one MATOC and returns a full self-contained
    HTML page string, in the same visual style as the original Colab export.

    exclude_asterisk_bids: state of the "Asterisk Bid" filter toggle shown at
    the top of the dashboard (ON by default). See prepare_dataframe() for
    exactly what ON vs OFF does.
    """
    df = prepare_dataframe(raw_df, exclude_asterisk_bids=exclude_asterisk_bids)
    k = compute_kpis(df)
    kpi_html = build_kpi_html(k)

    charts = []
    fig_pb = build_price_bands(df)
    if fig_pb: charts.append((fig_pb, False))
    fig_comp = build_competitor_intel(df)
    if fig_comp: charts.append((fig_comp, False))
    fig_sc = build_missed_revenue_radar(df)
    if fig_sc: charts.append((fig_sc, False))
    fig_proj, scroll_proj = build_project_deep_dive(df)
    if fig_proj: charts.append((fig_proj, scroll_proj))
    fig_yr = build_year_over_year(df)
    if fig_yr: charts.append((fig_yr, False))
    fig_mods_total = build_mods_vs_total(df)
    if fig_mods_total: charts.append((fig_mods_total, False))
    fig_top_comp_proj = build_top_competitors_by_project(df)
    if fig_top_comp_proj: charts.append((fig_top_comp_proj, False))
    fig_rev_dist = build_revenue_distribution_dropdown(df)
    if fig_rev_dist: charts.append((fig_rev_dist, False))
    fig_mods_company = build_mods_by_company_project(df)
    if fig_mods_company: charts.append((fig_mods_company, False))
    # Heatmap goes last, per request
    fig_hm = build_heatmap(df)
    if fig_hm: charts.append((fig_hm, False))

    crit_table_html = build_critical_table_html(df)
    brief_html = build_ceo_brief_html(df, k)

    sidebar_links_html = ""
    if all_matocs:
        for matoc_slug, matoc_name in all_matocs.items():
            active = "active" if matoc_slug == slug else ""
            sidebar_links_html += f"""
            <a class="sidebar-item {active}" href="/dashboard/{matoc_slug}">
                {matoc_name}
            </a>
            """

    parts = [f"""<!DOCTYPE html>
<html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width, initial-scale=1'>
<title>{matoc_label} Executive Performance Dashboard</title>
<style>
  * {{ box-sizing: border-box; }}
  body {{ background:#0D1117; margin:0; padding:0; font-family:Arial,sans-serif; }}
  
  /* Layout App Wrapper Structure */
  .page-wrapper {{
      display: flex;
      min-height: 100vh;
  }}

  /* Left Persistent Sidebar Layout */
  .sidebar {{
      width: 280px;
      min-width: 280px;
      background: #161B22;
      border-right: 1px solid #30363D;
      padding: 24px 16px;
      overflow-y: auto;
      height: 100vh;
      position: sticky;
      top: 0;
      transition: margin-left 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.2s ease;
  }}

  /* Collapsed layout utilities */
  .sidebar.collapsed {{
      margin-left: -280px;
      opacity: 0;
      pointer-events: none;
  }}

  /* Right Canvas Display Panel */
  .main-content {{
      position: relative; /* Fixed: Added to allow absolute placement of floating button */
      flex: 1;
      min-width: 0;
      padding: 30px 40px;
      display: flex;
      flex-direction: column;
      align-items: center;
      transition: padding-top 0.2s ease;
  }}

  /* FIX: when the sidebar is collapsed, the floating "Show MATOCs" button
     sits directly on top of the page title. Reserve extra top padding on the 
     content area in that state so the header never sits underneath the floating button. */
  .main-content.sidebar-hidden {{
      padding-top: 90px;
  }}

  /* Structural Content Wrapper to lock grid alignment with cards */
  .dashboard-container {{
      width: 100%;
      max-width: 1420px;
      display: flex;
      flex-direction: column;
  }}

  /* Fixed Dashboard Top Header Grid Alignment */
  .dashboard-header {{
      display: flex;
      align-items: center;
      gap: 16px;
      margin-bottom: 4px;
      width: 100%;
  }}

  /* Navigation Sidebar Top Control Structure */
  .sidebar-header-control {{
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 18px;
      padding-left: 10px;
  }}

  .sidebar-title {{
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      color: #8B949E;
      font-weight: 700;
  }}

  /* Mini Toggle Button placed right next to "MATOCs" inside sidebar */
  .sidebar-mini-toggle {{
      background: #21262D;
      border: 1px solid #30363D;
      color: #C9D1D9;
      padding: 4px 8px;
      border-radius: 6px;
      cursor: pointer;
      font-weight: 600;
      font-size: 12px;
      transition: all 0.2s;
  }}

  .sidebar-mini-toggle:hover {{
      background: #30363D;
      color: #F78166;
      border-color: #F78166;
  }}

  /* Main Floating Toggle for restoring the menu when collapsed */
  .floating-toggle {{
      position: absolute; /* Fixed: Changed from fixed to absolute so it doesn't freeze on scroll */
      top: 24px;
      left: 20px;
      background: #161B22;
      border: 1px solid #30363D;
      color: #C9D1D9;
      padding: 10px 16px;
      border-radius: 8px;
      cursor: pointer;
      font-weight: 600;
      font-size: 13px;
      display: none;
      align-items: center;
      gap: 8px;
      z-index: 999;
      box-shadow: 0 4px 12px rgba(0,0,0,0.4);
  }}

  .floating-toggle:hover {{
      background: #21262D;
      color: #58A6FF;
      border-color: #58A6FF;
  }}

  /* Show floating button only when collapsed */
  .sidebar.collapsed ~ .main-content .floating-toggle {{
      display: inline-flex;
  }}

  .sidebar-item {{
      display: block;
      padding: 11px 14px;
      margin-bottom: 6px;
      color: #C9D1D9;
      text-decoration: none;
      border-radius: 8px;
      font-size: 14px;
      transition: background .2s, color .15s;
  }}

  .sidebar-item:hover {{
      background: #21262D;
      color: #58A6FF;
  }}

  .sidebar-item.active {{
      background: #1F6FEB;
      color: white;
      font-weight: 600;
  }}

  /* Global Section Components styling */
  h1 {{ color:#58A6FF; font-size:28px; margin: 0; }}
  p.sub {{ color:#8B949E; margin-top:4px; margin-bottom:12px; font-size:14px; padding-left: 2px; }}
  .toolbar {{ display:flex; gap:10px; flex-wrap:wrap; margin:10px 0 14px; padding-left: 2px; }}
  .toolbar a {{ text-decoration:none; font-size:13px; font-weight:600; padding:8px 14px;
    border-radius:8px; border:1px solid #30363D; color:#F0F6FC; background:#161B22; }}
  .toolbar a:hover {{ border-color:#58A6FF; color:#58A6FF; }}
  .toolbar a.primary {{ background:#1F6FEB; border-color:#1F6FEB; color:#fff; }}
  .toolbar a.primary:hover {{ background:#388BFD; border-color:#388BFD; color:#fff; }}
  .toolbar a.admin {{ background:#238636; border-color:#238636; color:#fff; }}
  .toolbar a.admin:hover {{ background:#2EA043; border-color:#2EA043; }}
  .chart {{ margin-bottom:28px; border-radius:12px; overflow:hidden; }}
  .chart-scroll {{ overflow-x:auto; overflow-y:hidden; width:100%; border-radius:12px; }}
  .chart-scroll-inner {{ min-width:1100px; }}
  hr {{ border-color:#30363D; margin:20px 0; }}
  tbody tr:hover {{ background:#1C2128; }}
  tbody td {{ padding:9px 12px; border-bottom:1px solid #21262D; }}
  .scroll-note {{ color:#8B949E; font-size:12px; margin-bottom:6px; font-style:italic; }}
</style></head><body>

<div class="page-wrapper">

  <!-- Left Sidebar Navigation -->
  <div id="sidebar" class="sidebar">
      <div class="sidebar-header-control">
          <div class="sidebar-title">MATOCs</div>
          <button id="sidebar-hide-btn" class="sidebar-mini-toggle" title="Hide Sidebar">&laquo; Hide</button>
      </div>
      {sidebar_links_html}
  </div>

  <!-- Main Display Canvas Area -->
  <div id="main-content" class="main-content">
    <!-- Floating toggle trigger block that only shows when layout menu is closed -->
    <button id="floating-sidebar-toggle" class="floating-toggle">
        &#9776; Show MATOCs
    </button>

    <div class="dashboard-container">
  
      <div class="dashboard-header">
        <h1>{matoc_label} Intelligence Dashboard</h1>
      </div>
      
      <p class='sub'>Competitive Pricing &middot; Win/Loss Analysis &middot; Market Intelligence</p>
      <div class='toolbar'>
        <a class='primary' href='/dashboard/{slug}/download?asterisk={"on" if exclude_asterisk_bids else "off"}'>&#8681; Download Dashboard</a>
        <a href='/dashboard/{slug}/data'>&#128202; View Raw Data (Excel view)</a>
        <a class='{"admin" if exclude_asterisk_bids else ""}' style='{"" if exclude_asterisk_bids else "background:#8B949E;border-color:#8B949E;color:#0D1117;"}' href='/dashboard/{slug}?asterisk={"off" if exclude_asterisk_bids else "on"}' title='When ON, bids flagged Asterisk Bid are excluded (treated as No Bid). When OFF, they count normally.'>
          &#10033; Asterisk Bid Filter: {"ON" if exclude_asterisk_bids else "OFF"}
        </a>
        {"<a class='admin' href='/logout'>Log Out Admin</a>" if is_admin else "<a href='/login?next=/dashboard/" + str(slug) + "/data'>Admin Login</a>"}
      </div>
      {kpi_html}
      <hr>
"""]

    first = True
    for fig, needs_scroll in charts:
        chunk = fig.to_html(full_html=False, include_plotlyjs="cdn" if first else False)
        first = False
        if needs_scroll:
            parts.append(f"""<div class='scroll-note'>Scroll horizontally to see all project types</div>
            <div class='chart-scroll'><div class='chart-scroll-inner'>{chunk}</div></div><hr>""")
        else:
            parts.append(f"<div class='chart'>{chunk}</div><hr>")

    if not charts:
        parts.append("<p style='color:#8B949E'>No data found for this MATOC yet. Import bid data using import_data.py.</p>")

    parts.append(crit_table_html)
    parts.append("<hr>")
    parts.append(brief_html)
    parts.append("""
    </div> <!-- End of dashboard-container -->
  </div> <!-- End of main-content -->
</div>
</body>
<script>
  const sidebar = document.getElementById('sidebar');
  const mainContent = document.getElementById('main-content');
  const hideBtn = document.getElementById('sidebar-hide-btn');
  const floatBtn = document.getElementById('floating-sidebar-toggle');

  // Manually resize every Plotly graph div after the collapse/expand
  // transition finishes so charts actually fill the new available width.
  function resizeAllPlots() {
    if (!window.Plotly) return;
    document.querySelectorAll('.js-plotly-plot').forEach(function (gd) {
      window.Plotly.Plots.resize(gd);
    });
  }

  // Compact layout click toggles.
  // Also toggle a 'sidebar-hidden' class on the main content area so its
  // top padding grows when collapsed -- this keeps the floating
  // "Show MATOCs" button from overlapping the dashboard title.
  hideBtn.addEventListener('click', () => {
    sidebar.classList.add('collapsed');
    mainContent.classList.add('sidebar-hidden');
    setTimeout(resizeAllPlots, 320); // wait out the 0.3s CSS transition first
  });
  floatBtn.addEventListener('click', () => {
    sidebar.classList.remove('collapsed');
    mainContent.classList.remove('sidebar-hidden');
    setTimeout(resizeAllPlots, 320);
  });
</script>
</html>
""")
    return "".join(parts)


def build_contractor_year_chart(df):
    if df.empty:
        return "<p>No data available.</p>"

    chart = df.groupby("Year", as_index=False)["Contract Value"].sum().sort_values("Year")
    labels = [f"${v/1_000_000:.1f}M" if v >= 1_000_000 else f"${v:,.0f}" for v in chart["Contract Value"]]

    fig = px.bar(chart, x="Year", y="Contract Value", title="Contract Value by Year",
                 color="Contract Value", color_continuous_scale="Blues")
    fig.update_traces(text=labels, textposition="outside")
    fig.update_layout(template="plotly_dark", paper_bgcolor="#161B22", plot_bgcolor="#161B22",
                      margin=dict(l=20, r=20, t=50, b=20), height=450, coloraxis_showscale=False)
    return fig.to_html(full_html=False, include_plotlyjs=False)


def build_contractor_project_chart(df):
    if df.empty:
        return "<p>No data available.</p>"

    chart = df.groupby("Project Type", as_index=False)["Contract Value"].sum().sort_values("Contract Value", ascending=False).head(10)
    labels = [f"${v/1_000_000:.1f}M" if v >= 1_000_000 else f"${v:,.0f}" for v in chart["Contract Value"]]

    fig = px.bar(chart, x="Contract Value", y="Project Type", orientation="h", title="Top Project Types",
                 color="Contract Value", color_continuous_scale="Viridis")
    fig.update_traces(text=labels, textposition="outside")
    fig.update_yaxes(autorange="reversed")
    fig.update_layout(template="plotly_dark", paper_bgcolor="#161B22", plot_bgcolor="#161B22",
                      margin=dict(l=20, r=20, t=50, b=20), height=500, coloraxis_showscale=False)
    return fig.to_html(full_html=False, include_plotlyjs=False)