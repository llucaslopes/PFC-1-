#!/usr/bin/env python3
"""Gera as cinco tabelas estrategicas do artigo do TCC a partir da campanha
oficial `resultados/oficial-2026-06-04-v2/`.

Cada tabela e gravada em quatro formatos com o mesmo basename:

- `<base>.csv`   (UTF-8, sem BOM) -- dados brutos
- `<base>.md`    (Markdown) -- pronto para colar em docs/
- `<base>.tex`   (LaTeX `booktabs`) -- pronto para colar no .tex do artigo
- `<base>.png`   (matplotlib, 300 dpi) -- imagem renderizada bonita para Word/PDF

Tabelas geradas
---------------

1. Resumo detalhado por (arquitetura x intervalo) -- media +/- desvio das 3
   reps com throughput %, mensagens/s e perdas %; eh a Tabela 1 do artigo,
   alimenta a Figura de throughput da Secao 4.1.
2. Comparacao executiva A1/A2/A4 (1 linha por arquitetura) -- tabela sintese
   que resume as tres arquiteturas no melhor caso (100 ms) e no pior caso
   (20 ms); usada como tabela de fechamento de secao ou na conclusao.
3. Latencia ponta a ponta no baseline saudavel (100 ms) -- defende a tese
   "MQTT entrega latencia ~10-30x menor que REST polling".
4. Confiabilidade sob alta carga (20 ms) -- defende a tese "REST polling e
   WebSocket colapsam para ~22% throughput, MQTT sustenta ~98%".
5. Pontos de saturacao por arquitetura -- menor intervalo saudavel e primeiro
   ponto de stress, motivos do stress.

Uso
---

    python scripts/gera_tabelas_artigo.py
    python scripts/gera_tabelas_artigo.py \\
        --input  resultados/oficial-2026-06-04-v2/consolidated_metrics.csv \\
        --out    resultados/oficial-2026-06-04-v2/tabelas-artigo
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from typing import Iterable

import matplotlib
import numpy as np
import pandas as pd

matplotlib.use("Agg")
import matplotlib.pyplot as plt


# ---------------------------------------------------------------------------
# Estilo visual canonico do artigo
# ---------------------------------------------------------------------------

# Rotulos visiveis nas tabelas/PNGs do artigo. Os codigos internos A1/A2/A4
# ainda existem como identificadores no codigo (constantes ARCH_WEBSOCKET,
# ARCH_REST, ARCH_MQTT) e em comentarios/CLI, mas foram removidos do texto
# que vai para o entregavel do PFC -- o artigo final usa apenas os nomes
# canonicos dos padroes de comunicacao.
ARCH_WEBSOCKET = "WebSocket"
ARCH_REST = "REST polling"
ARCH_MQTT = "MQTT"

ARCH_ORDER = [ARCH_WEBSOCKET, ARCH_REST, ARCH_MQTT]

ARCH_COLORS = {
    ARCH_WEBSOCKET: "#1f77b4",
    ARCH_REST:      "#d62728",
    ARCH_MQTT:      "#2ca02c",
}

DEFAULT_INPUT = Path("resultados/oficial-2026-06-04-v2/consolidated_metrics.csv")
DEFAULT_OUT   = Path("resultados/oficial-2026-06-04-v2/tabelas-artigo")

BASELINE_INTERVAL_MS = 100
STRESS_INTERVAL_MS = 20

THROUGHPUT_HEALTHY_THRESHOLD = 95.0
LOSS_HEALTHY_THRESHOLD = 1.0

# Constantes de layout do PNG das tabelas. Calibradas visualmente a 300
# dpi com a fonte default do matplotlib (DejaVu Sans 10pt). Mudar
# qualquer valor exige regerar todas as 5 tabelas e revisar se nenhuma
# coluna ficou truncada ou se sobrou whitespace excessivo.
TABLE_LAYOUT = {
    # Largura media em polegadas de um caractere na fonte da celula
    # (10pt) e do cabecalho (10pt bold). Valor empirico calibrado
    # contra strings reais das 5 tabelas oficiais.
    "char_in_data":          0.085,
    "char_in_head":          0.090,
    "pad_in":                0.55,   # padding lateral por celula
    "row_height_in":         0.42,
    "header_height_factor":  1.25,   # header eh 25% mais alto que linha
    "title_h_in":            0.5,
    "margin_top_in":         0.25,
    "margin_bottom_in":      0.25,
    "pad_above_table_in":    0.15,
    "pad_below_table_in":    0.35,
    "fig_extra_width_in":    0.5,    # margem horizontal total
    "table_left_margin_in":  0.25,
    "caption_line_h_in":     0.32,
    "caption_extra_h_in":    0.25,
    "caption_width_chars":   130,
    "min_col_width_in":      1.0,
    "cell_fontsize":         10,
    "title_fontsize":        14,
    "caption_fontsize":      8.8,
    "save_dpi":              300,
    "save_pad_inches":       0.18,
    "save_bbox":             "tight",
    # Cores da estetica canonica da tabela: cabecalho escuro, linhas
    # com zebra discreta e bordas suaves.
    "header_face":           "#1a3a5c",
    "header_text":           "white",
    "row_alt_1":             "#ffffff",
    "row_alt_2":             "#eef3f8",
    "border_color":          "#cfd6df",
    "border_linewidth":      0.6,
    "arch_accent_alpha_hex": "33",   # ~20% alpha em hex sobre o color
}


# ---------------------------------------------------------------------------
# Helpers de IO
# ---------------------------------------------------------------------------

def normalize_arch(row: pd.Series) -> str:
    arch = str(row.get("architecture", "")).strip().lower()
    mode = str(row.get("communication_mode", "")).strip().lower()
    if arch == "mqtt":
        return ARCH_MQTT
    if mode == "websocket":
        return ARCH_WEBSOCKET
    if mode in ("rest-polling", "rest_polling", "rest"):
        return ARCH_REST
    return f"{arch}/{mode}"


def load_consolidated(path: Path) -> pd.DataFrame:
    if not path.exists():
        raise FileNotFoundError(f"Arquivo nao encontrado: {path}")
    df = pd.read_csv(path)
    df["arch_label"] = df.apply(normalize_arch, axis=1)
    df = df[df["arch_label"].isin(ARCH_ORDER)].copy()
    df["loss_rate_percent"] = (
        df["missing_messages"].astype(float) / df["expected_messages"].astype(float) * 100.0
    )
    return df


def fmt_mean_std(mean: float, std: float, decimals: int = 2) -> str:
    """`'<mean> \u00b1 <std>'`. Trata NaN como travessao."""
    if pd.isna(mean):
        return "\u2013"
    if pd.isna(std):
        return f"{mean:.{decimals}f}"
    return f"{mean:.{decimals}f} \u00b1 {std:.{decimals}f}"


# ---------------------------------------------------------------------------
# Serializacao multi-formato
# ---------------------------------------------------------------------------

def _df_to_markdown(df: pd.DataFrame) -> str:
    cols = list(df.columns)
    out = ["| " + " | ".join(cols) + " |",
           "|" + "|".join(["---"] * len(cols)) + "|"]
    for _, r in df.iterrows():
        cells = []
        for c in cols:
            v = r[c]
            if isinstance(v, float) and pd.isna(v):
                cells.append("\u2013")
            else:
                cells.append(str(v))
        out.append("| " + " | ".join(cells) + " |")
    return "\n".join(out)


def _escape_latex(text: str) -> str:
    """Escapa caracteres LaTeX-sensiveis preservando os simbolos visuais
    (travessao, +/-) que ja existem no DataFrame de saida."""
    replacements = [
        ("\\", r"\textbackslash{}"),
        ("&",  r"\&"),
        ("%",  r"\%"),
        ("#",  r"\#"),
        ("_",  r"\_"),
        ("{",  r"\{"),
        ("}",  r"\}"),
        ("$",  r"\$"),
        ("^",  r"\^{}"),
        ("~",  r"\~{}"),
        ("\u2014", r"---"),
        ("\u2013", r"--"),
        ("\u00b1", r"$\pm$"),
        ("\u2265", r"$\geq$"),
        ("\u2264", r"$\leq$"),
        ("\u00d7", r"$\times$"),
    ]
    out = text
    for src, dst in replacements:
        out = out.replace(src, dst)
    return out


def _df_to_latex_booktabs(df: pd.DataFrame, *, caption: str, label: str) -> str:
    n = len(df.columns)
    col_spec = "l" + "r" * (n - 1)
    header = " & ".join(_escape_latex(str(c)) for c in df.columns) + r" \\"
    body_rows = []
    for _, r in df.iterrows():
        cells = []
        for c in df.columns:
            v = r[c]
            if isinstance(v, float) and pd.isna(v):
                cells.append(r"--")
            else:
                cells.append(_escape_latex(str(v)))
        body_rows.append(" & ".join(cells) + r" \\")
    body = "\n    ".join(body_rows)
    caption_tex = _escape_latex(caption)
    return (
        "\\begin{table}[ht]\n"
        "  \\centering\n"
        f"  \\caption{{{caption_tex}}}\n"
        f"  \\label{{{label}}}\n"
        f"  \\begin{{tabular}}{{{col_spec}}}\n"
        "    \\toprule\n"
        f"    {header}\n"
        "    \\midrule\n"
        f"    {body}\n"
        "    \\bottomrule\n"
        "  \\end{tabular}\n"
        "\\end{table}\n"
    )


def _wrap_caption(text: str, width_chars: int = TABLE_LAYOUT["caption_width_chars"]) -> str:
    """Quebra a caption em linhas para nao estourar a largura da figura."""
    import textwrap
    paragraphs = text.split("\n")
    wrapped = []
    for p in paragraphs:
        if not p.strip():
            wrapped.append("")
            continue
        wrapped.append(textwrap.fill(p, width=width_chars,
                                      break_long_words=False,
                                      break_on_hyphens=False))
    return "\n".join(wrapped)


def _compute_column_widths(cell_text: list[list[str]], col_labels: list[str]) -> list[float]:
    """Largura por coluna em polegadas, baseada no conteudo (max entre
    cabecalho e celulas). Garante piso de TABLE_LAYOUT['min_col_width_in']
    para evitar colunas-fio em tabelas com so um digito por coluna.
    """
    char_in_data = TABLE_LAYOUT["char_in_data"]
    char_in_head = TABLE_LAYOUT["char_in_head"]
    pad_in       = TABLE_LAYOUT["pad_in"]
    min_w        = TABLE_LAYOUT["min_col_width_in"]
    n_rows = len(cell_text)
    col_widths: list[float] = []
    for j in range(len(col_labels)):
        header_chars = len(col_labels[j])
        max_cell_chars = max((len(cell_text[r][j]) for r in range(n_rows)), default=1)
        w = max(header_chars * char_in_head, max_cell_chars * char_in_data) + pad_in
        col_widths.append(max(w, min_w))
    return col_widths


def _cell_texts_from_df(df: pd.DataFrame) -> list[list[str]]:
    n_rows, n_cols = df.shape
    return [[
        str(df.iat[r, c])
        if not (isinstance(df.iat[r, c], float) and pd.isna(df.iat[r, c]))
        else "\u2013"
        for c in range(n_cols)
    ] for r in range(n_rows)]


def _style_cells(tbl, cell_text, col_labels, arch_column, n_rows):
    """Aplica zebra, cabecalho escuro e destaque por arquitetura."""
    arch_col_idx = col_labels.index(arch_column) if arch_column in col_labels else None
    base_h_norm = 1.0 / (n_rows + TABLE_LAYOUT["header_height_factor"])
    header_h_norm = base_h_norm * TABLE_LAYOUT["header_height_factor"]

    for (row_idx, col_idx), cell in tbl.get_celld().items():
        cell.set_edgecolor(TABLE_LAYOUT["border_color"])
        cell.set_linewidth(TABLE_LAYOUT["border_linewidth"])
        if row_idx == 0:
            cell.set_facecolor(TABLE_LAYOUT["header_face"])
            cell.set_text_props(color=TABLE_LAYOUT["header_text"], weight="bold")
            cell.set_height(header_h_norm)
            continue
        cell.set_height(base_h_norm)
        base_color = TABLE_LAYOUT["row_alt_1"] if (row_idx % 2 == 1) else TABLE_LAYOUT["row_alt_2"]
        cell.set_facecolor(base_color)
        if arch_col_idx is not None and col_idx == arch_col_idx:
            arch_value = cell_text[row_idx - 1][col_idx]
            accent = ARCH_COLORS.get(arch_value)
            if accent is not None:
                cell.set_facecolor(accent + TABLE_LAYOUT["arch_accent_alpha_hex"])
                cell.set_text_props(weight="bold", color="#111")


_TABLE_NUMBER_PREFIX_RE = re.compile(r"^Tabela\s+\d+\s*[\u2014\u2013\-]\s*")


def _strip_table_number_prefix(title: str) -> str:
    """Remove o prefixo ``"Tabela N \u2014 "`` do titulo.

    A numeracao da tabela e responsabilidade do editor do artigo
    (Word/LaTeX). No PNG, o titulo grande exibido na figura deve
    conter apenas a descricao semantica, sem o numero, para evitar
    redundancia/incoerencia quando a tabela for inserida em uma
    secao com numeracao automatica.
    """
    return _TABLE_NUMBER_PREFIX_RE.sub("", title, count=1)


def _render_table_png(df: pd.DataFrame, *,
                      out_path: Path,
                      title: str,
                      caption: str,
                      arch_column: str | None = None) -> None:
    """Renderiza a tabela como PNG bonito usando matplotlib.

    - Cabecalho com fundo escuro e texto branco
    - Linhas alternadas (zebra) para leitura mais facil
    - Quando `arch_column` for informado, a coluna da arquitetura recebe
      uma faixa colorida (WebSocket=azul, REST polling=vermelho, MQTT=verde)
      para o leitor reconhecer cada bloco rapidamente
    - Titulo em negrito acima e caption em italico abaixo
    - Larguras de coluna dimensionadas pelo conteudo (max(header, celulas))
      para evitar tanto truncamento quanto whitespace excessivo
    """
    n_rows, _ = df.shape
    cell_text = _cell_texts_from_df(df)
    col_labels = [str(c) for c in df.columns]
    col_widths_in = _compute_column_widths(cell_text, col_labels)
    total_w_in = sum(col_widths_in)

    row_h = TABLE_LAYOUT["row_height_in"]
    header_h = row_h * TABLE_LAYOUT["header_height_factor"]
    table_h_in = header_h + row_h * n_rows

    caption_wrapped = _wrap_caption(caption)
    n_caption_lines = len(caption_wrapped.split("\n"))
    caption_h_in = (TABLE_LAYOUT["caption_line_h_in"] * n_caption_lines
                    + TABLE_LAYOUT["caption_extra_h_in"])

    fig_w = total_w_in + TABLE_LAYOUT["fig_extra_width_in"]
    fig_h = (
        TABLE_LAYOUT["margin_top_in"]
        + TABLE_LAYOUT["title_h_in"]
        + TABLE_LAYOUT["pad_above_table_in"]
        + table_h_in
        + TABLE_LAYOUT["pad_below_table_in"]
        + caption_h_in
        + TABLE_LAYOUT["margin_bottom_in"]
    )

    fig = plt.figure(figsize=(fig_w, fig_h), dpi=TABLE_LAYOUT["save_dpi"])
    fig.patch.set_facecolor("white")

    table_top_norm = 1.0 - (
        TABLE_LAYOUT["margin_top_in"] + TABLE_LAYOUT["title_h_in"]
        + TABLE_LAYOUT["pad_above_table_in"]
    ) / fig_h
    table_bottom_norm = (
        TABLE_LAYOUT["margin_bottom_in"] + caption_h_in
        + TABLE_LAYOUT["pad_below_table_in"]
    ) / fig_h
    table_left_norm = TABLE_LAYOUT["table_left_margin_in"] / fig_w
    table_width_norm = total_w_in / fig_w

    ax = fig.add_axes([
        table_left_norm,
        table_bottom_norm,
        table_width_norm,
        table_top_norm - table_bottom_norm,
    ])
    ax.set_axis_off()

    col_widths_norm = [w / total_w_in for w in col_widths_in]
    tbl = ax.table(
        cellText=cell_text,
        colLabels=col_labels,
        bbox=[0.0, 0.0, 1.0, 1.0],
        cellLoc="center",
        colLoc="center",
        colWidths=col_widths_norm,
    )
    tbl.auto_set_font_size(False)
    tbl.set_fontsize(TABLE_LAYOUT["cell_fontsize"])
    _style_cells(tbl, cell_text, col_labels, arch_column, n_rows)

    title_y = 1.0 - (
        TABLE_LAYOUT["margin_top_in"] + TABLE_LAYOUT["title_h_in"] * 0.5
    ) / fig_h
    fig.text(0.5, title_y, _strip_table_number_prefix(title),
             ha="center", va="center",
             fontsize=TABLE_LAYOUT["title_fontsize"], fontweight="bold", color="#111")

    caption_y = (TABLE_LAYOUT["margin_bottom_in"] + caption_h_in - 0.15) / fig_h
    fig.text(0.5, caption_y, caption_wrapped,
             ha="center", va="top",
             fontsize=TABLE_LAYOUT["caption_fontsize"], style="italic", color="#555")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out_path, dpi=TABLE_LAYOUT["save_dpi"], facecolor="white",
                bbox_inches=TABLE_LAYOUT["save_bbox"],
                pad_inches=TABLE_LAYOUT["save_pad_inches"])
    plt.close(fig)


def save_table_all_formats(df: pd.DataFrame, *,
                           out_dir: Path,
                           base_name: str,
                           title: str,
                           caption: str,
                           latex_label: str,
                           arch_column: str | None = None) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    base = out_dir / base_name

    df.to_csv(base.with_suffix(".csv"), index=False, encoding="utf-8")

    md = f"# {title}\n\n{caption}\n\n{_df_to_markdown(df)}\n"
    base.with_suffix(".md").write_text(md, encoding="utf-8")

    tex = _df_to_latex_booktabs(df, caption=caption, label=latex_label)
    base.with_suffix(".tex").write_text(tex, encoding="utf-8")

    _render_table_png(
        df,
        out_path=base.with_suffix(".png"),
        title=title,
        caption=caption,
        arch_column=arch_column,
    )

    print(f"  [ok] {base_name}  ({df.shape[0]} linhas \u00d7 {df.shape[1]} colunas)")


# ---------------------------------------------------------------------------
# Construcao das 5 tabelas
# ---------------------------------------------------------------------------

def _arch_sort_key(label: str) -> int:
    try:
        return ARCH_ORDER.index(label)
    except ValueError:
        return len(ARCH_ORDER)


def aggregate_by_arch_interval(df: pd.DataFrame) -> pd.DataFrame:
    """Agrega media e desvio-padrao das 3 reps para cada (arq, intervalo).

    Throughput percent de MQTT pode passar de 100% por causa de
    duplicatas/republish QoS=0 -- preservamos esse valor cru para
    transparencia (a tabela 1 ja explica o porque).
    """
    metrics = {
        "throughput_percent":          "throughput_pct",
        "loss_rate_percent":           "loss_pct",
        "messages_per_second":         "msgps",
        "estimated_latency_avg_ms":    "lat_avg_ms",
        "estimated_latency_p95_ms":    "lat_p95_ms",
        "estimated_latency_std_ms":    "lat_std_ms",
    }
    g = df.groupby(["arch_label", "interval_ms"])
    agg = pd.DataFrame({
        "n_reps": g.size(),
    })
    for src, dst in metrics.items():
        agg[f"{dst}_mean"] = g[src].mean()
        agg[f"{dst}_std"]  = g[src].std(ddof=1)
    agg = agg.reset_index()
    agg["__sort"] = agg["arch_label"].map(_arch_sort_key)
    agg = agg.sort_values(by=["__sort", "interval_ms"],
                          ascending=[True, False]).drop(columns="__sort")
    return agg.reset_index(drop=True)


def tabela1_resumo_detalhado(agg: pd.DataFrame, out_dir: Path) -> pd.DataFrame:
    rows = []
    for _, r in agg.iterrows():
        rows.append({
            "Arquitetura": r["arch_label"],
            "Intervalo (ms)": int(r["interval_ms"]),
            "Throughput (%)": fmt_mean_std(r["throughput_pct_mean"],
                                            r["throughput_pct_std"], 2),
            "Mensagens/s (msg/s)": fmt_mean_std(r["msgps_mean"],
                                                  r["msgps_std"], 2),
            "Perdas (%)": fmt_mean_std(r["loss_pct_mean"],
                                        r["loss_pct_std"], 2),
            "Latência média (ms)": fmt_mean_std(r["lat_avg_ms_mean"],
                                                  r["lat_avg_ms_std"], 2),
            "Latência P95 (ms)": fmt_mean_std(r["lat_p95_ms_mean"],
                                                r["lat_p95_ms_std"], 2),
            "N reps": int(r["n_reps"]),
        })
    df = pd.DataFrame(rows)

    save_table_all_formats(
        df,
        out_dir=out_dir,
        base_name="tabela1_resumo_detalhado",
        title="Tabela 1 \u2014 Resumo detalhado por arquitetura × intervalo",
        caption=(
            "Média ± desvio padrão das 3 repetições para cada combinação de "
            "arquitetura e intervalo de envio do produtor. Intervalos menores "
            "implicam taxa maior de envio (carga). A coluna \"Mensagens/s\" "
            "é a vazão efetiva entregue ao cliente (cabe diretamente no texto "
            "da Seção 4.1), enquanto \"Throughput (%)\" é a mesma vazão "
            "normalizada pela taxa-alvo do produtor. Tabela de apoio que "
            "alimenta a Figura de throughput e a Figura de latência do artigo."
        ),
        latex_label="tab:resumo-detalhado",
        arch_column="Arquitetura",
    )
    return df


def tabela2_comparacao_executiva(agg: pd.DataFrame, out_dir: Path) -> pd.DataFrame:
    rows = []
    for arch in ARCH_ORDER:
        sub = agg[agg["arch_label"] == arch]
        base = sub[sub["interval_ms"] == BASELINE_INTERVAL_MS]
        stress = sub[sub["interval_ms"] == STRESS_INTERVAL_MS]
        if base.empty or stress.empty:
            continue

        b = base.iloc[0]
        s = stress.iloc[0]

        rows.append({
            "Arquitetura": arch,
            "Throughput @ 100 ms (%)": fmt_mean_std(b["throughput_pct_mean"],
                                                    b["throughput_pct_std"], 2),
            "Latência média @ 100 ms (ms)": fmt_mean_std(b["lat_avg_ms_mean"],
                                                          b["lat_avg_ms_std"], 2),
            "Latência P95 @ 100 ms (ms)": fmt_mean_std(b["lat_p95_ms_mean"],
                                                        b["lat_p95_ms_std"], 2),
            "Throughput @ 20 ms (%)": fmt_mean_std(s["throughput_pct_mean"],
                                                    s["throughput_pct_std"], 2),
            "Mensagens entregues @ 20 ms (msg/s)": fmt_mean_std(s["msgps_mean"],
                                                                  s["msgps_std"], 2),
            "Perdas @ 20 ms (%)": fmt_mean_std(s["loss_pct_mean"],
                                                s["loss_pct_std"], 2),
        })
    df = pd.DataFrame(rows)

    save_table_all_formats(
        df,
        out_dir=out_dir,
        base_name="tabela2_comparacao_executiva",
        title="Tabela 2 \u2014 Comparação executiva entre arquiteturas",
        caption=(
            "Síntese da campanha oficial (ESP32 + Wi-Fi, 3 repetições de 60 s). "
            "Coluna esquerda mostra o comportamento no intervalo saudável de "
            "100 ms (cada padrão no seu \"melhor caso\"); coluna direita mostra "
            "o comportamento sob carga agressiva de 20 ms (5× o baseline). "
            "Valores são média ± desvio padrão das 3 repetições. Fonte: "
            "resultados/oficial-2026-06-04-v2/consolidated_metrics.csv."
        ),
        latex_label="tab:comparacao-executiva",
        arch_column="Arquitetura",
    )
    return df


def tabela3_latencia_baseline(agg: pd.DataFrame, out_dir: Path) -> pd.DataFrame:
    sub = agg[agg["interval_ms"] == BASELINE_INTERVAL_MS].copy()
    sub = sub.sort_values(by="arch_label", key=lambda s: s.map(_arch_sort_key))
    rows = []
    for _, r in sub.iterrows():
        rows.append({
            "Arquitetura": r["arch_label"],
            "Latência média (ms)": fmt_mean_std(r["lat_avg_ms_mean"],
                                                  r["lat_avg_ms_std"], 2),
            "Latência P95 (ms)": fmt_mean_std(r["lat_p95_ms_mean"],
                                                r["lat_p95_ms_std"], 2),
            "Desvio padrão da latência (ms)": fmt_mean_std(r["lat_std_ms_mean"],
                                                            r["lat_std_ms_std"], 2),
            "Throughput (%)": fmt_mean_std(r["throughput_pct_mean"],
                                            r["throughput_pct_std"], 2),
            "Perdas (%)": fmt_mean_std(r["loss_pct_mean"],
                                        r["loss_pct_std"], 2),
        })
    df = pd.DataFrame(rows)

    save_table_all_formats(
        df,
        out_dir=out_dir,
        base_name="tabela3_latencia_baseline_100ms",
        title="Tabela 3 \u2014 Latência ponta a ponta no baseline saudável (100 ms)",
        caption=(
            "Latência estimada ponta a ponta (ESP32 → backend/broker → cliente) "
            "no intervalo de 100 ms, onde todas as arquiteturas operam em regime "
            "saudável (throughput ≥ 95%). Sincronização via SNTP no ESP32 e "
            "Cristian/NTP simplificado no cliente; incerteza ~ RTT_sync / 2. "
            "MQTT entrega latência sub-milissegundo a média porque o broker é "
            "local e a fila do producer é pequena; REST polling acumula latência "
            "inerente do mecanismo (cliente busca no próprio passo)."
        ),
        latex_label="tab:latencia-baseline",
        arch_column="Arquitetura",
    )
    return df


def tabela4_carga_extrema(df_raw: pd.DataFrame, agg: pd.DataFrame,
                          out_dir: Path) -> pd.DataFrame:
    sub_agg = agg[agg["interval_ms"] == STRESS_INTERVAL_MS].copy()
    sub_agg = sub_agg.sort_values(by="arch_label", key=lambda s: s.map(_arch_sort_key))

    rows = []
    for _, r in sub_agg.iterrows():
        arch = r["arch_label"]
        raw_sub = df_raw[(df_raw["arch_label"] == arch)
                          & (df_raw["interval_ms"] == STRESS_INTERVAL_MS)]
        expected_per_rep = float(raw_sub["expected_messages"].mean()) if not raw_sub.empty else float("nan")
        received_per_rep = float(raw_sub["received_messages"].mean()) if not raw_sub.empty else float("nan")
        rows.append({
            "Arquitetura": arch,
            "Mensagens esperadas (3000/rep)": f"{expected_per_rep:.0f}",
            "Mensagens entregues (média)":   f"{received_per_rep:.0f}",
            "Throughput (%)": fmt_mean_std(r["throughput_pct_mean"],
                                            r["throughput_pct_std"], 2),
            "Perdas (%)": fmt_mean_std(r["loss_pct_mean"],
                                        r["loss_pct_std"], 2),
            "Latência média (ms)": fmt_mean_std(r["lat_avg_ms_mean"],
                                                  r["lat_avg_ms_std"], 2),
            "Latência P95 (ms)": fmt_mean_std(r["lat_p95_ms_mean"],
                                                r["lat_p95_ms_std"], 2),
        })
    df = pd.DataFrame(rows)

    save_table_all_formats(
        df,
        out_dir=out_dir,
        base_name="tabela4_carga_extrema_20ms",
        title="Tabela 4 \u2014 Confiabilidade sob carga agressiva (20 ms)",
        caption=(
            "Comportamento das três arquiteturas sob o intervalo mais agressivo "
            "da matriz (20 ms = 50 msg/s). A 20 ms o produtor pressiona o canal "
            "de comunicação ao limite. REST polling e WebSocket colapsam para "
            "~22% de throughput porque o cliente/servidor não acompanha; MQTT "
            "sustenta ~98% porque o broker desacopla produtor e consumidor "
            "(fila assíncrona, sem polling síncrono no cliente). 3 repetições "
            "de 60 s; valores são média ± desvio padrão."
        ),
        latex_label="tab:carga-extrema",
        arch_column="Arquitetura",
    )
    return df


def tabela5_pontos_saturacao(df_raw: pd.DataFrame, agg: pd.DataFrame,
                             out_dir: Path) -> pd.DataFrame:
    intervals_desc = sorted(agg["interval_ms"].unique(), reverse=True)
    rows = []
    for arch in ARCH_ORDER:
        sub = agg[agg["arch_label"] == arch].copy()
        if sub.empty:
            continue
        sub = sub.sort_values(by="interval_ms", ascending=False)

        healthy_smallest: int | None = None
        first_stress: int | None = None
        stress_reasons: list[str] = []

        for _, r in sub.iterrows():
            tp = float(r["throughput_pct_mean"])
            loss = float(r["loss_pct_mean"])
            is_healthy = (tp >= THROUGHPUT_HEALTHY_THRESHOLD) and (loss <= LOSS_HEALTHY_THRESHOLD)
            if is_healthy:
                healthy_smallest = int(r["interval_ms"])
            else:
                if first_stress is None:
                    first_stress = int(r["interval_ms"])
                    if tp < THROUGHPUT_HEALTHY_THRESHOLD:
                        stress_reasons.append(f"throughput {tp:.1f}% < 95%")
                    if loss > LOSS_HEALTHY_THRESHOLD:
                        stress_reasons.append(f"perdas {loss:.1f}% > 1%")
                    break

        rows.append({
            "Arquitetura": arch,
            "Menor intervalo saudável (ms)":
                (str(healthy_smallest) if healthy_smallest is not None else "indef."),
            "Primeiro stress (ms)":
                (str(first_stress) if first_stress is not None else "n/a"),
            "Motivos do primeiro stress":
                ("; ".join(stress_reasons) if stress_reasons else "\u2013"),
            "Intervalo mais agressivo testado (ms)":
                str(int(min(intervals_desc))),
            "Throughput nesse intervalo (%)":
                fmt_mean_std(
                    float(sub[sub["interval_ms"] == min(intervals_desc)]["throughput_pct_mean"].iloc[0]),
                    float(sub[sub["interval_ms"] == min(intervals_desc)]["throughput_pct_std"].iloc[0]),
                    2,
                ),
        })
    df = pd.DataFrame(rows)

    save_table_all_formats(
        df,
        out_dir=out_dir,
        base_name="tabela5_pontos_saturacao",
        title="Tabela 5 \u2014 Pontos de saturação por arquitetura",
        caption=(
            "Critério saudável: throughput ≥ 95% E perdas ≤ 1%. \"Menor intervalo "
            "saudável\" é o intervalo mais agressivo (taxa mais alta de envio) "
            "no qual a arquitetura ainda atende a esses dois critérios "
            "simultaneamente. \"Primeiro stress\" é o intervalo imediatamente "
            "seguinte (mais agressivo) onde a arquitetura passa a violar pelo "
            "menos um critério. Útil para o leitor situar rapidamente onde cada "
            "padrão começa a sofrer."
        ),
        latex_label="tab:saturacao",
        arch_column="Arquitetura",
    )
    return df


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------

def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT,
                        help=f"CSV consolidado de entrada (default: {DEFAULT_INPUT})")
    parser.add_argument("--out",   type=Path, default=DEFAULT_OUT,
                        help=f"Pasta de saida (default: {DEFAULT_OUT})")
    args = parser.parse_args(list(argv) if argv is not None else None)

    in_path: Path = args.input
    out_dir: Path = args.out

    print(f"[input]  {in_path}")
    print(f"[output] {out_dir}\n")

    df_raw = load_consolidated(in_path)
    agg = aggregate_by_arch_interval(df_raw)

    print("Gerando 5 tabelas em 4 formatos (csv, md, tex, png):\n")
    tabela1_resumo_detalhado(agg, out_dir)
    tabela2_comparacao_executiva(agg, out_dir)
    tabela3_latencia_baseline(agg, out_dir)
    tabela4_carga_extrema(df_raw, agg, out_dir)
    tabela5_pontos_saturacao(df_raw, agg, out_dir)

    print(f"\nTudo pronto. Tabelas em: {out_dir.resolve()}")
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
