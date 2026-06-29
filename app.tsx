const ROOT_STYLE: any = {
  "--primary": "27 65% 47%",
  "--primary-foreground": "0 0% 100%",
  "--ring": "27 65% 47%",
  "--radius": "0.625rem",
};

export default function MyApp(props: any) {
  return (
    <BeaUI.ToastProvider>
      <App {...props} />
    </BeaUI.ToastProvider>
  );
}

const HASH = "fz7k";

let _pdfjsPromise: Promise<any> | null = null;
function loadPdfjs(): Promise<any> {
  const w = window as any;
  if (w.pdfjsLib) return Promise.resolve(w.pdfjsLib);
  if (_pdfjsPromise) return _pdfjsPromise;
  _pdfjsPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    s.onload = () => {
      const lib = (window as any).pdfjsLib;
      if (!lib) { reject(new Error("pdfjs não inicializou")); return; }
      lib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      resolve(lib);
    };
    s.onerror = () => reject(new Error("Falha ao baixar pdfjs do CDN"));
    document.head.appendChild(s);
  });
  return _pdfjsPromise;
}

const MONTHS_PT: Record<string, number> = { janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12 };
const fmtBRL = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtNum = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const monthLabel = (k: string) => { if (!k || !k.includes("-")) return k || ""; const [y, m] = k.split("-"); const M = ["", "Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"]; return `${M[parseInt(m)] || m}/${y.slice(-2)}`; };
const normName = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const isValidDate = (s: any) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
function parseValor(s: string): number { s = s.trim(); const neg = s.endsWith("-"); if (neg) s = s.slice(0, -1); const v = parseFloat(s.replace(/\./g, "").replace(",", ".")); return isNaN(v) ? 0 : (neg ? -v : v); }

async function readPDFPages(pdfjsLib: any, file: File) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const pages: { items: any[]; height: number; width: number }[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const p = await pdf.getPage(i);
    const c = await p.getTextContent();
    pages.push({ items: c.items, width: p.view[2] - p.view[0], height: p.view[3] - p.view[1] });
  }
  return pages;
}

function itemsToLines(items: any[], xMax: number, skipTopPx: number | null, pageHeight: number): string[] {
  const yCutoff = skipTopPx !== null ? pageHeight - skipTopPx : pageHeight;
  const groups: { y: number; items: any[] }[] = [];
  for (const it of items) {
    const x = it.transform[4], y = it.transform[5];
    if (x >= xMax || y > yCutoff) continue;
    let found = false;
    for (const g of groups) { if (Math.abs(g.y - y) <= 2) { g.items.push(it); found = true; break; } }
    if (!found) groups.push({ y, items: [it] });
  }
  groups.sort((a, b) => b.y - a.y);
  return (Array.isArray(groups)?groups:[]).map(g => {
    g.items.sort((a, b) => a.transform[4] - b.transform[4]);
    let text = "", lastEnd = -100;
    for (const it of g.items) { const x = it.transform[4]; if (text && (x - lastEnd) > 2) text += " "; text += it.str; lastEnd = x + (it.width || 0); }
    return text.replace(/\s+/g, " ").trim();
  }).filter(s => s.length > 0);
}

const RE_DATE_VAL = /^(\d{2}\/\d{2})\s+(.*?)\s+([\d.]+,\d{2}-?)$/;
const RE_USD_LINE = /^(\d{2}\/\d{2})\s+(.+?)\s+USD\s*([\d.]+,\d{2}-?)\s*(.+?)\s+[\d.]+,\d{2}-?\s+\d+,\d+\s+([\d.]+,\d{2}-?)$/;
const RE_HOLDER = /^([A-ZÁÉÍÓÚÂÊÔÃÕÇ ]+?)\s+Cartão\s+(\d{4})\s+XXXX\s+XXXX\s+(\d{4})/;
const RE_TOTAL_HOLDER = /^Total para\s*([A-ZÁÉÍÓÚÂÊÔÃÕÇ ]+?)\s+([\d.]+,\d{2})/;

function parseCardPDF(pages: any[], cardBrand: string, monthInt: number, year: number) {
  const allLines: string[] = [];
  for (const p of pages) allLines.push(...itemsToLines(p.items, 340, null, p.height));
  const out: any[] = [];
  let holder: string | null = null, inLanc = false;
  for (let i = 0; i < allLines.length; i++) {
    const ln = allLines[i].trim();
    if (!ln) continue;
    const mH = RE_HOLDER.exec(ln);
    if (mH) { holder = mH[1].trim(); inLanc = true; continue; }
    if (RE_TOTAL_HOLDER.test(ln)) { inLanc = false; continue; }
    if (ln === "Lançamentos") { inLanc = true; holder = "BANCO"; continue; }
    if (!inLanc) continue;
    let dateDm: string | null = null, desc = "", value = 0, usd: number | null = null;
    const mUsd = RE_USD_LINE.exec(ln);
    const mD = !mUsd ? RE_DATE_VAL.exec(ln) : null;
    if (mUsd) { dateDm = mUsd[1]; desc = `${mUsd[2]} ${mUsd[4]}`.trim(); usd = parseValor(mUsd[3]); value = parseValor(mUsd[5]); }
    else if (mD) { dateDm = mD[1]; desc = mD[2]; value = parseValor(mD[3]); }
    else continue;
    if (!dateDm || value === 0) continue;
    const [dd, mm] = dateDm.split("/").map(Number);
    if (!dd || !mm) continue;
    const trxYear = mm > monthInt ? year - 1 : year;
    const fullDate = `${trxYear}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    let installment: string | null = null;
    const mI = /\b(\d{2})\/(\d{2})\b/.exec(desc);
    if (mI) { const a = +mI[1], b = +mI[2]; if (a >= 1 && a <= b && b <= 24) { installment = `${a}/${b}`; desc = desc.replace(/\b\d{2}\/\d{2}\b/, "").trim(); } }
    desc = desc.replace(/\d+\.?\d*,\d{2}-?(?=[A-Z])/g, "").replace(/\b\d+[.,]\d+\b/g, "").replace(/\bUSD\b/g, "").replace(/\s+/g, " ").trim().replace(/\s+(SAN|SO|BELO|PORTO|JUIZ|ALEGRE)$/, "").trim();
    if (!desc) desc = "Sem descrição";
    if (i + 1 < allLines.length) {
      const nxt = allLines[i + 1].trim();
      if (nxt && !RE_DATE_VAL.test(nxt) && !RE_HOLDER.test(nxt) && !RE_TOTAL_HOLDER.test(nxt) && /^[A-Za-zÀ-ÿ ]+$/.test(nxt) && nxt.length < 40) i++;
    }
    out.push({ card: cardBrand, statement_month: `${year}-${String(monthInt).padStart(2, "0")}`, date: fullDate, holder: holder || "BANCO", description: desc, amount: value, usd_amount: usd, installment });
  }
  return out;
}

function normalizeMerchant(d: string): string {
  let s = d.toUpperCase();
  s = s.replace(/\s+(BELO|SAO PAULO|SO PAULO|CANDELARIA|PORTO ALEGRE|SAO|BELO HORIZONT|JUIZ DE FORA|OSASCO|CURITIBA|TABAI|SANTANA DE PA|MILWAUKEE|SEATTLE|SAN FRANCISCO|MILTON|LANARCA|RESTINGA SECA).*$/, "");
  s = s.replace(/\s+\d{2}\/\d{2}\s*$/, "");
  return s.replace(/\s+/g, " ").trim() || "Sem nome";
}

const KNOWN_TYPES = ["Transferencia Pix", "Transfe Pix", "Apl.invest Fac", "Aplicacao Fundo", "Resgate Invest Facil", "Resgate Inv Fac", "Resgate Fundos", "Rentab.invest Facilcred*", "Rent.inv.facil", "Pagto Cobranca", "Conta Telefone", "Gasto c Credito", "Iof Util Limite", "Ted-t Elet Disp", "Pix Qrcode Din", "Pix Qrcode Est", "Receb Pagfor", "Pgto Elet Trib", "Devolucao Pix", "Saque"];
const RE_DATE_FULL = /^(\d{2}\/\d{2}\/\d{2})\b/;
const RE_VAL = /([\d.]+,\d{2})/;
const RE_DOCTO_FRONT = /^(\d{6,8})\s/;
const RE_DOCTO_VAL = /\b(\d{6,8})\s+(?:-\s+)?([\d.]+,\d{2})/;

function startsWithType(l: string): [string | null, string] { for (const t of KNOWN_TYPES) if (l.startsWith(t)) return [t, l.slice(t.length).trim()]; return [null, l]; }

function extractData(rest: string): any | null {
  if (!rest) return null;
  const tokens = rest.split(/\s+/);
  if (!tokens.length) return null;
  let docto: string | null = null, idx = 0;
  if (/^\d{6,8}$/.test(tokens[0])) { docto = tokens[0]; idx = 1; }
  let isDebit = false;
  if (idx < tokens.length && tokens[idx] === "-") { isDebit = true; idx++; }
  const numeric: string[] = []; let saldoNeg = false;
  for (let j = idx; j < tokens.length; j++) {
    const t = tokens[j];
    if (/^[\d.]+,\d{2}-?$/.test(t)) numeric.push(t);
    else if (t === "-" && numeric.length && j + 1 < tokens.length && /^[\d.]+,\d{2}$/.test(tokens[j + 1])) saldoNeg = true;
    else break;
  }
  if (!numeric.length) return null;
  const v0 = numeric[0];
  let amount = parseValor(v0.replace(/-$/, ""));
  if (v0.endsWith("-") || isDebit) amount = -amount;
  let saldo: number | null = null;
  if (numeric.length >= 2) { const v1 = numeric[1]; saldo = parseValor(v1.replace(/-$/, "")); if (v1.endsWith("-") || saldoNeg) saldo = -saldo; }
  return { docto, amount, saldo };
}

function parseBankPDF(pages: any[]) {
  const allLines: string[] = [];
  (Array.isArray(pages)?pages:[]).forEach((p, i) => { allLines.push(...itemsToLines(p.items, 9999, i === 0 ? 165 : 20, p.height)); });
  const trx: any[] = [], saldos: any[] = [];
  let currentDate: string | null = null, pendingType: string | null = null, pendingDesc: string[] = [];
  let inSaldos = false, inUlt = false;
  function finalize(ty: string, data: any, desc: string = "") {
    if (!currentDate) return;
    if (data.amount == null || data.amount === 0) return;
    let cp: string | null = null, refDate: string | null = null;
    if (desc) {
      let c = desc.replace(/^(Rem|Des)\s*:\s*/, "");
      const m = /(\d{2}\/\d{2})\s*$/.exec(c);
      if (m) { refDate = m[1]; c = c.slice(0, m.index).trim(); }
      cp = c.trim() || null;
    }
    const [dd, mm, yy] = currentDate.split("/");
    if (!dd || !mm || !yy) return;
    const sm = `20${yy}-${mm}`;
    const isoDate = `20${yy}-${mm}-${dd}`;
    if (!isValidDate(isoDate)) return;
    trx.push({ date: isoDate, statement_month: sm, type: ty, docto: data.docto, amount: data.amount, saldo: data.saldo, desc: desc || null, counterparty: cp, ref_date: refDate, section: inUlt ? "ultimos" : "principal" });
  }
  for (let i = 0; i < allLines.length; i++) {
    let line = allLines[i].trim();
    if (!line) continue;
    if (line.includes("Saldos Invest")) { inSaldos = true; inUlt = false; continue; }
    if (line.includes("Últimos Lançamentos") || line.includes("Ultimos Lancamentos")) { inUlt = true; inSaldos = false; continue; }
    if (line.includes("Fone Fácil Bradesco")) break;
    if (inSaldos) {
      const mS = /^(\d{2}\/\d{2}\/\d{2})\s+Saldo\s+Invest\s+F[áa]cil\s+([\d.]+,\d{2})/.exec(line);
      if (mS) { const [dd, mm, yy] = mS[1].split("/"); const d = `20${yy}-${mm}-${dd}`; if (isValidDate(d)) saldos.push({ date: d, saldo: parseValor(mS[2]) }); }
      continue;
    }
    if (line.includes("Bradesco Internet Banking") || line.includes("Os dados acima") || line.startsWith("Extrato de:")) continue;
    if (line.startsWith("Data ") && line.includes("Histórico")) continue;
    if (line.startsWith("Total ") && line.includes(",")) continue;
    const mD = RE_DATE_FULL.exec(line);
    if (mD) { currentDate = mD[1]; line = line.slice(mD[0].length).trim(); if (!line) continue; }
    if (line.includes("SALDO ANTERIOR")) continue;
    const [ty, rest] = startsWithType(line);
    if (ty) {
      const data = rest ? extractData(rest) : null;
      if (data && data.amount != null) { finalize(ty, data); pendingType = null; pendingDesc = []; }
      else { pendingType = ty; pendingDesc = rest ? [rest] : []; }
      continue;
    }
    const isPrefix = line.startsWith("Rem:") || line.startsWith("Des:");
    if (isPrefix) {
      const mDoc = /\b(\d{6,8})\b/.exec(line);
      if (mDoc && RE_VAL.test(line.slice(mDoc.index + mDoc[0].length))) {
        const descText = line.slice(0, mDoc.index).trim();
        const data = extractData(line.slice(mDoc.index));
        if (data && data.amount != null) { finalize(pendingType || "Transfe Pix", data, descText); pendingType = null; pendingDesc = []; continue; }
      }
      if (pendingType) pendingDesc.push(line);
      else if (trx.length) {
        const prev = trx[trx.length - 1];
        prev.desc = (prev.desc || "") + " " + line;
        if (!prev.counterparty) {
          let cp = line.replace(/^(Rem|Des)\s*:\s*/, "");
          const m = /(\d{2}\/\d{2})\s*$/.exec(cp);
          if (m) { prev.ref_date = m[1]; cp = cp.slice(0, m.index).trim(); }
          prev.counterparty = cp.trim() || null;
        }
      }
      continue;
    }
    if (RE_DOCTO_FRONT.test(line) && RE_VAL.test(line)) {
      const data = extractData(line);
      if (data && data.amount != null) {
        const ty2 = pendingType || (trx.length ? trx[trx.length - 1].type : "Desconhecido");
        finalize(ty2, data, pendingDesc.join(" ").trim());
        pendingType = null; pendingDesc = [];
      }
      continue;
    }
    const mDv = RE_DOCTO_VAL.exec(line);
    if (mDv && pendingType) {
      const prefix = line.slice(0, mDv.index).trim();
      const data = extractData(line.slice(mDv.index));
      if (data && data.amount != null) {
        finalize(pendingType, data, [...pendingDesc, prefix].filter(Boolean).join(" ").trim());
        pendingType = null; pendingDesc = []; continue;
      }
    }
    if (pendingType) pendingDesc.push(line);
    else if (trx.length) { const prev = trx[trx.length - 1]; prev.desc = (prev.desc || "") + " " + line; }
  }
  return { trx, saldos };
}

const CARD_RULES: { cat: string; patterns: RegExp[] }[] = [
  { cat: "Pagamento Fatura", patterns: [/PAGTO\./i] },
  { cat: "Tarifas/IOF", patterns: [/\bIOF\b/i, /CUSTO TRANS/i] },
  { cat: "Eletrônicos", patterns: [/APPLE STORE/i, /APPLE\.COM\/US/i, /BEST BUY/i, /KABUM/i] },
  { cat: "Assinaturas", patterns: [/NETFLIX/i, /SPOTIFY/i, /GOOGLE ONE/i, /YOUTUBE/i, /CLAUDE\.?AI/i, /ANTHROPIC/i, /OPENAI/i, /APPLE\.?COM\.?BILL/i, /APPLECOMBILL/i, /APPLE COM BILL/i, /LINKEDIN/i, /CONTABILIZEI/i, /HOSTINGER/i, /NINTENDO/i, /DISNEY/i, /PRIMEVIDEO/i, /WORDPRESS/i, /UOL/i, /DROPBOX/i, /GITHUB/i, /ICLOUD/i, /ADOBE/i, /LIVELO.*CLUBE/i] },
  { cat: "Mercado", patterns: [/SUPER NOSSO/i, /SN BURITIS/i, /SUPERMERCADO/i, /HIPER SACOLAO/i, /IMEC/i, /WOLLMANN/i, /MEZENGA/i, /DAKI/i, /CASA DA GRANJA/i, /CAPPTA/i, /HORTI/i, /WALMART/i, /MERCADO/i, /PADARIA/i] },
  { cat: "Farmácia/Saúde", patterns: [/DROGARI/i, /ARAUJO LOJA/i, /\bRAIA\d*\b/i, /PACHECO/i, /SAO JOAO FARMACIAS/i, /FARMACIA/i, /COMERCIAL SAUDE/i, /CLINICA/i, /CLINIC/i, /LABORATOR/i, /ODONTO/i, /HOSPITAL/i, /ADCOS/i, /AFYA/i] },
  { cat: "Combustível", patterns: [/\bPOSTO\b/i, /AUTO POSTO/i, /VELOE/i, /ESTACIONAMENTO/i] },
  { cat: "Restaurantes/Bares", patterns: [/STEAK/i, /ECHOPE/i, /RESTAURANTE/i, /PELLEGRINO/i, /CAFE/i, /PANDOCA/i, /PUB/i, /BURITIS CONVENIENCIA/i, /DC COMERCIO DE BEBIDAS/i, /\bBAR\b/i, /CAFFEINE/i, /JAH DO ACAI/i, /PIZZ/i, /\bIFD/i, /BURGER/i, /CONFEIT/i] },
  { cat: "E-commerce", patterns: [/AMAZON/i, /MERCADOLIVRE/i, /ALIEXPRESS/i, /SHEIN/i, /SHOPEE/i, /MAGAZINE/i, /INDITEX/i, /TARGET/i] },
  { cat: "Viagem", patterns: [/LATAM/i, /\bGOL\b/i, /\bAZUL\b/i, /UNIDAS/i, /BOOKING/i, /AIRBNB/i, /HOTEL/i, /DECOLAR/i, /LOCADORA/i, /AMTRAK/i, /AVIANCA/i, /AIRLINE/i] },
  { cat: "Transporte", patterns: [/\bUBER\b/i, /UBER ?\*/i, /99\*/i, /TAXI/i, /CABIFY/i] },
  { cat: "Pet", patterns: [/COBASI/i, /PETZ/i, /PETLOVE/i, /PETSHOP/i, /CLINIPET/i, /VETERIN/i] },
  { cat: "Filhos", patterns: [/ALO BEBE/i, /CARTERS/i, /INFANTIL/i, /LILIBEE/i] },
  { cat: "Vestuário", patterns: [/TRACK FIELD/i, /LUPO/i, /BARBEARIA/i, /CALCAD/i, /NIKE/i, /LOUNGERIE/i, /ZARA/i, /RENNER/i, /RIACHUELO/i, /PERFUMARIA/i, /COSMETIC/i] },
  { cat: "Seguros", patterns: [/TOKIO MARINE/i, /SEGURO/i, /MAPFRE/i] },
  { cat: "Casa/Serviços", patterns: [/PRO REPAROS/i, /CONDOMINIO/i, /ELETRO/i] },
];
function categorizeCard(desc: string): string { for (const r of CARD_RULES) if (r.patterns.some(p => p.test(desc))) return r.cat; return "Outros"; }

const COUNTERPARTY_MAP: Record<string, [string, string]> = {
  "Maria Aparecida de ol": ["Maria Aparecida", "Funcionários domésticos"],
  "Tabata Cristina Ferre": ["Tabata Cristina", "Funcionários domésticos"],
  "Andrea Chagas Libanio": ["Andrea Chagas", "Saúde/Terapia"],
  "Lais Albanese Fonoaud": ["Lais Albanese (fono)", "Saúde/Terapia"],
  "Casulo Clinica de Des": ["Casulo Clínica", "Saúde/Terapia"],
  "Casulo Clinica": ["Casulo Clínica", "Saúde/Terapia"],
  "Barcelos Servicos Med": ["Barcelos Serv. Méd.", "Saúde/Terapia"],
  "Poliana Martins da si": ["Poliana Martins", "Saúde/Terapia"],
  "Helena Maria Lemos de": ["Helena Maria Lemos", "Família"],
  "Maria Clara Lemos de": ["Maria Clara Lemos", "Família"],
  "Jordana de Padua Lemo": ["Jordana (esposa)", "Família"],
  "Ticiana Krug": ["Ticiana Krug", "Família"],
  "Rodrigo Krug": ["Rodrigo Krug", "Transf. própria"],
  "Icatu Seguros - Matri": ["Icatu Seguros", "Renda"],
  "Mapfre Vida S/a": ["Mapfre Vida", "Renda"],
  "Zoop Tecnologia & Inst de": ["Zoop Tecnologia", "Renda"],
  "Remet.tam Linhas Aereas s/": ["TAM Linhas Aéreas", "Outros"],
  "Remet.unimed Seguradora s": ["Unimed Seguradora", "Renda"],
  "Vendere Negocios Imobiliarios lt": ["Vendere Imobiliária", "Moradia (Aluguel/Cond)"],
  "Condominio do Edificio Parque bu": ["Condomínio Parque", "Moradia (Aluguel/Cond)"],
  "Claro": ["Claro", "Telefone/Internet"],
};

function categorizeBank(t: any): string {
  const ty = t.type, desc = (t.desc || "").toLowerCase(), cp = (t.counterparty || "").toLowerCase(), amount = t.amount;
  if (ty === "Apl.invest Fac" || ty === "Aplicacao Fundo") return "Investimento (aporte)";
  if (["Resgate Inv Fac", "Resgate Fundos", "Rent.inv.facil", "Resgate Invest Facil", "Rentab.invest Facilcred*"].includes(ty)) return "Investimento (resgate)";
  if (ty === "Gasto c Credito") return "Cartão de crédito";
  if (ty === "Pagto Cobranca") { if (desc.includes("vendere") || desc.includes("imobiliar") || desc.includes("condominio")) return "Moradia (Aluguel/Cond)"; return "Boleto"; }
  if (ty === "Conta Telefone") return "Telefone/Internet";
  if (ty === "Pgto Elet Trib") return desc.includes("ipva") ? "IPVA" : "Impostos";
  if (ty === "Iof Util Limite") return "Tarifas/IOF";
  if (["Transfe Pix", "Transferencia Pix", "Pix Qrcode Din", "Pix Qrcode Est", "Devolucao Pix"].includes(ty)) {
    if (cp) for (const [key, [name, cat]] of Object.entries(COUNTERPARTY_MAP)) {
      if (cp.includes(key.toLowerCase()) || key.toLowerCase().includes(cp)) {
        if (amount < 0) { if (cat === "Transf. própria") return "Transf. própria"; return "PIX enviado: " + cat; }
        return "PIX recebido: " + cat;
      }
    }
    return amount < 0 ? "PIX enviado: Outros" : "PIX recebido: Outros";
  }
  if (ty === "Ted-t Elet Disp" || ty === "Receb Pagfor") return "PIX recebido: Renda";
  return "Outros";
}

function mapCounterparty(t: any): string | null {
  const target = (t.counterparty || t.desc || "").trim();
  if (!target) return null;
  for (const [key, [name]] of Object.entries(COUNTERPARTY_MAP)) {
    if (target.toLowerCase().includes(key.toLowerCase()) || key.toLowerCase().includes(target.toLowerCase())) return name;
  }
  return t.counterparty || null;
}

function parseFilename(name: string): { card: string; month: number; year: number } | null {
  const m = name.replace(/\.pdf$/i, "").trim().match(/^(Elo|Master)\s+(.+)$/i);
  if (!m) return null;
  const card = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
  const monthInt = MONTHS_PT[normName(m[2])];
  if (!monthInt) return null;
  const year = monthInt === 12 ? 2025 : 2026;
  return { card, month: monthInt, year };
}

// ============== Paleta "Banco Sóbrio" ==============
// Tons terrosos/sóbrios: navy, verde, terracota, azul-aço, ardósia, areia.
const SB = {
  bg: "#f4f5f2", side: "#1c2b46", ink: "#1c2b46", accent: "#c8702a",
  green: "#2e7d52", red: "#b03a30", border: "#e3e2dc", bInner: "#eceadf",
  row: "#f1f0e9", headBg: "#fafaf7", muted: "#8a8678", faint: "#a8a496",
  chip: "#6b6757", navIdle: "#a6b1c6", navMute: "#8a97b0", sect: "#5e6c87",
};

const CAT_COLOR: Record<string, string> = {
  "Mercado": "#2e7d52", "Eletrônicos": "#9a8c6a", "E-commerce": "#b8b09a", "Viagem": "#3a5a8c",
  "Farmácia/Saúde": "#b03a30", "Restaurantes/Bares": "#c8702a", "Assinaturas": "#5b7a99",
  "Vestuário": "#8a5a8c", "Filhos": "#7a6a8c", "Seguros": "#6b6757", "Combustível": "#a8743a",
  "Tarifas/IOF": "#9a9483", "Casa/Serviços": "#4a6b8a", "Pet": "#6b8e5a", "Transporte": "#3a5a8c", "Outros": "#1c2b46",
};

// Paleta cíclica sóbria para categorias dinâmicas sem cor fixa
const PALETTE = ["#1c2b46", "#2e7d52", "#c8702a", "#3a5a8c", "#8a5a8c", "#9a8c6a", "#b03a30", "#5b7a99", "#6b8e5a", "#a8743a", "#7a6a8c", "#b8b09a", "#4a6b8a", "#857c5e", "#9c5a4a"];
function catColor(cat: string, idx: number = 0): string {
  if (CAT_COLOR[cat]) return CAT_COLOR[cat];
  let h = 0;
  for (let i = 0; i < cat.length; i++) h = (h * 31 + cat.charCodeAt(i)) >>> 0;
  return PALETTE[(h + idx) % PALETTE.length];
}

// CSS global do app: tema "Banco Sóbrio" + tipografia Inter (texto + números tabulares)
const APP_CSS = `
:root{
  --background:70 12% 95%; --foreground:219 43% 19%;
  --card:0 0% 100%; --card-foreground:219 43% 19%;
  --popover:0 0% 100%; --popover-foreground:219 43% 19%;
  --primary:27 65% 47%; --primary-foreground:0 0% 100%;
  --secondary:60 20% 97%; --secondary-foreground:219 43% 19%;
  --muted:60 20% 97%; --muted-foreground:47 8% 51%;
  --accent:60 20% 97%; --accent-foreground:219 43% 19%;
  --destructive:5 57% 44%; --destructive-foreground:0 0% 100%;
  --border:51 11% 88%; --input:50 13% 82%; --ring:27 65% 47%;
  --radius:0.625rem;
}
@keyframes finFadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
.fin-fade{animation:finFadeIn .25s ease-out both}
.fin-app{font-family:'Inter',system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
.fin-app .font-mono{font-family:'Inter',system-ui,sans-serif;font-variant-numeric:tabular-nums;font-feature-settings:'tnum' 1}
.fin-serif{font-family:'Inter',system-ui,sans-serif;letter-spacing:-0.011em}
.sbgroup{display:grid;gap:1px;background:#e6e5df;border:1px solid #e3e2dc;border-radius:10px;overflow:hidden}
.sbcell{background:#fff;padding:20px 24px}
.fin-grid-2{display:grid;grid-template-columns:1fr;gap:16px}
@media(min-width:1024px){.fin-grid-2{grid-template-columns:1.55fr 1fr}}
.fin-chip:hover{background:#faf9f5;color:#1c2b46}
.fin-nav:hover{filter:brightness(1.14)}
.fin-no-scrollbar::-webkit-scrollbar{display:none}
.fin-no-scrollbar{scrollbar-width:none}
`;

// Navegação principal — barra lateral escura (substitui BeaUI.Tabs)
const NAV = [
  { value: "overview", label: "Visão Geral", icon: "layout-grid", sub: "Acompanhe gastos, renda e orçamento" },
  { value: "expenses", label: "Despesas", icon: "banknote", sub: "Todas as saídas, classificadas por categoria" },
  { value: "trends", label: "Evolução", icon: "trending-up", sub: "Gastos e patrimônio ao longo do tempo" },
  { value: "insights", label: "Insights", icon: "lightbulb", sub: "Observações automáticas sobre seus hábitos" },
  { value: "budgets", label: "Orçamento", icon: "target", sub: "Defina limites por categoria e acompanhe o consumo" },
  { value: "cards", label: "Cartões", icon: "credit-card", sub: "Faturas e gastos dos seus cartões de crédito" },
  { value: "bank", label: "Conta Corrente", icon: "landmark", sub: "Movimentações de entrada e saída da conta" },
];

// Cor do "hint" do StatCard conforme o acento semântico
const HINT_COLOR: Record<string, string> = { primary: SB.accent, success: SB.green, destructive: SB.red, warning: "#a8743a", neutral: SB.muted };

// Célula de métrica (label + valor mono + hint) no estilo sóbrio. Ignora ícone de propósito.
function StatCard({ label, value, accent = "neutral", hint }: any) {
  const neg = typeof value === "string" && value.trim().startsWith("-");
  const hc = HINT_COLOR[accent] || HINT_COLOR.neutral;
  return (
    <div className="sbcell">
      <div style={{ font: "500 10.5px 'Inter'", letterSpacing: ".07em", textTransform: "uppercase", color: SB.faint, marginBottom: 12 }}>{label}</div>
      <div className="font-mono" style={{ fontSize: 23, fontWeight: 500, lineHeight: 1.1, color: neg ? SB.red : SB.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{value}</div>
      {hint ? <div style={{ font: "400 12px 'Inter'", color: hc, marginTop: 10, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{hint}</div> : null}
    </div>
  );
}

// Painel de métricas conectado (grade branca com divisórias internas) — substitui BeaUI.StatsGrid
function StatGroup({ children }: any) {
  return <div className="sbgroup grid-cols-2 lg:grid-cols-4">{children}</div>;
}

// Painel/seção: card branco chapado com borda fina e título serifado (substitui BeaUI.Section)
function Panel({ title, description, action, children }: any) {
  return (
    <div style={{ background: SB.card, border: `1px solid ${SB.border}`, borderRadius: 10, padding: "24px 26px" }}>
      {(title || description || action) && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 22 }}>
          <div style={{ minWidth: 0 }}>
            {title && <div className="fin-serif" style={{ fontSize: 18, fontWeight: 600, color: SB.ink, lineHeight: 1.2 }}>{title}</div>}
            {description && <div style={{ font: "400 12px 'Inter'", color: SB.muted, marginTop: 3 }}>{description}</div>}
          </div>
          {action ? <div style={{ flex: "none" }}>{action}</div> : null}
        </div>
      )}
      {children}
    </div>
  );
}

// Filtro de período no estilo "chips conectados" (substitui BeaUI.SegmentedControl)
function PeriodChips({ value, onChange, options }: any) {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", background: SB.card, border: `1px solid ${SB.border}`, borderRadius: 8, overflow: "hidden", flexWrap: "wrap" }}>
      {(Array.isArray(options) ? options : []).map((o: any, i: number) => {
        const active = o.value === value;
        return (
          <button key={o.value} onClick={() => onChange(o.value)} className={active ? "" : "fin-chip"}
            style={{ padding: "9px 16px", border: 0, borderRight: i < options.length - 1 ? `1px solid ${SB.bInner}` : "none", background: active ? SB.side : "transparent", color: active ? "#fff" : SB.chip, font: `${active ? 600 : 400} 13px 'Inter'`, cursor: "pointer", outline: "none" }}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

const BTN_PRIMARY = "inline-flex items-center justify-center gap-2 h-10 px-4 rounded-lg text-sm font-semibold text-primary-foreground bg-primary hover:opacity-90 active:scale-[.98] transition-all";

function App({ db, user }: any) {
  const { toast } = BeaUI.useToast();
  const bootstrapped = useRef(false);
  const [ready, setReady] = useState(false);
  const [bootErr, setBootErr] = useState<string | null>(null);
  const [cardsRaw, setCardsRaw] = useState<any[]>([]);
  const [bankRaw, setBankRaw] = useState<any[]>([]);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [budgets, setBudgets] = useState<Record<string, number>>({});
  const [saldos, setSaldos] = useState<any[]>([]);
  const [tab, setTab] = useState<string>("overview");
  const [mobileNav, setMobileNav] = useState(false);
  const [periodPreset, setPeriodPreset] = useState<string>("all");
  const [periodFrom, setPeriodFrom] = useState("");
  const [periodTo, setPeriodTo] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [showBudgets, setShowBudgets] = useState(false);
  const [reclassifying, setReclassifying] = useState<any>(null);
  const [newCatInput, setNewCatInput] = useState("");
  const [newCatSelect, setNewCatSelect] = useState("");
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [dataRowId, setDataRowId] = useState<number | null>(null);
  const canEdit = user.role === "admin" || user.role === "builder";

  // Carrega a fonte Inter (texto + números) uma única vez
  useEffect(() => {
    const id = "fin-fonts-inter";
    if (document.getElementById(id)) return;
    const l = document.createElement("link");
    l.id = id; l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap";
    document.head.appendChild(l);
  }, []);

  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    (async () => {
      try {
        await db.execute(`CREATE TABLE IF NOT EXISTS app_data_${HASH} (id SERIAL PRIMARY KEY, owner_id TEXT NOT NULL, cards_json TEXT NOT NULL DEFAULT '[]', bank_json TEXT NOT NULL DEFAULT '[]', saldos_json TEXT NOT NULL DEFAULT '[]', overrides_json TEXT NOT NULL DEFAULT '{}', budgets_json TEXT NOT NULL DEFAULT '{}', updated_at TIMESTAMP DEFAULT NOW())`);
        await db.execute(`CREATE INDEX IF NOT EXISTS idx_d_${HASH} ON app_data_${HASH}(owner_id)`);
        await db.execute(`ALTER TABLE app_data_${HASH} ADD COLUMN IF NOT EXISTS budgets_json TEXT NOT NULL DEFAULT '{}'`);
        await loadData();
        setReady(true);
      } catch (e) { setBootErr(e instanceof Error ? e.message : String(e)); }
    })();
  }, []);

  async function loadData() {
    const rows = await db.query(`SELECT id, cards_json, bank_json, saldos_json, overrides_json, budgets_json FROM app_data_${HASH} WHERE owner_id = $1 LIMIT 1`, [user.id]);
    if (Array.isArray(rows) && rows.length > 0) {
      const r: any = rows[0];
      setDataRowId(r.id);
      try { setCardsRaw(JSON.parse(r.cards_json || "[]")); } catch { setCardsRaw([]); }
      try { setBankRaw(JSON.parse(r.bank_json || "[]")); } catch { setBankRaw([]); }
      try { setSaldos(JSON.parse(r.saldos_json || "[]")); } catch { setSaldos([]); }
      try { setOverrides(JSON.parse(r.overrides_json || "{}")); } catch { setOverrides({}); }
      try { setBudgets(JSON.parse(r.budgets_json || "{}")); } catch { setBudgets({}); }
    } else {
      setDataRowId(null);
      setCardsRaw([]); setBankRaw([]); setSaldos([]); setOverrides({}); setBudgets({});
    }
  }

  async function saveData(newCards: any[], newBank: any[], newSaldos: any[], newOverrides: Record<string, string>, newBudgets?: Record<string, number>) {
    const cardsJ = JSON.stringify(newCards);
    const bankJ = JSON.stringify(newBank);
    const saldosJ = JSON.stringify(newSaldos);
    const ovJ = JSON.stringify(newOverrides);
    const budJ = JSON.stringify(newBudgets !== undefined ? newBudgets : budgets);
    if (dataRowId == null) {
      const r = await db.execute(`INSERT INTO app_data_${HASH} (owner_id, cards_json, bank_json, saldos_json, overrides_json, budgets_json) VALUES ($1, $2, $3, $4, $5, $6)`, [user.id, cardsJ, bankJ, saldosJ, ovJ, budJ]);
      const rows = await db.query(`SELECT id FROM app_data_${HASH} WHERE owner_id = $1 LIMIT 1`, [user.id]);
      if (Array.isArray(rows) && rows.length > 0) setDataRowId((rows[0] as any).id);
    } else {
      await db.execute(`UPDATE app_data_${HASH} SET cards_json = $1, bank_json = $2, saldos_json = $3, overrides_json = $4, budgets_json = $5, updated_at = NOW() WHERE id = $6`, [cardsJ, bankJ, saldosJ, ovJ, budJ, dataRowId]);
    }
  }

  // Apply overrides on top of raw cards/bank
  const cards = useMemo(() => (Array.isArray(cardsRaw)?cardsRaw:[]).map(t => {
    const k = `card:${t.merchant}`;
    const ov = overrides[k];
    return ov && ov !== t.category ? { ...t, orig_category: t.category, category: ov } : { ...t, orig_category: null };
  }), [cardsRaw, overrides]);

  const bank = useMemo(() => (Array.isArray(bankRaw)?bankRaw:[]).filter(t => t.section === "principal" || !t.section).map(t => {
    const k = t.counterparty ? `bank:${t.counterparty}` : `bank-type:${t.type}`;
    const ov = overrides[k];
    return ov && ov !== t.category ? { ...t, orig_category: t.category, category: ov } : { ...t, orig_category: null };
  }), [bankRaw, overrides]);

  async function handlePDFUpload(fileList: FileList | File[]) {
    const arr = Array.from(fileList);
    if (!arr.length) return;
    setUploadProgress("Carregando pdfjs (primeira vez baixa do CDN)...");
    let pdfjsLib: any;
    try { pdfjsLib = await loadPdfjs(); }
    catch (e) { toast(`pdfjs falhou: ${e instanceof Error ? e.message : e}`, "error"); setUploadProgress(null); return; }

    const newCards: any[] = [];
    const newBank: any[] = [];
    const newSaldos: any[] = [];
    const errs: string[] = [];

    for (let i = 0; i < arr.length; i++) {
      const f = arr[i];
      setUploadProgress(`Lendo PDF ${i + 1}/${arr.length}: ${f.name}`);
      try {
        const pages = await readPDFPages(pdfjsLib, f);
        const fn = f.name.toLowerCase();
        if (fn.startsWith("extrato")) {
          const { trx, saldos: sl } = parseBankPDF(pages);
          for (const t of trx) {
            if (!isValidDate(t.date) || !t.type || t.amount == null || t.amount === 0) continue;
            const cp = mapCounterparty(t);
            const cat = categorizeBank({ ...t, counterparty: cp });
            const fp = `${t.date}|${t.type}|${t.docto || "X"}|${t.amount}|${t.section}|${cp || "X"}`;
            newBank.push({ ...t, counterparty: cp, category: cat, fingerprint: fp });
          }
          for (const s of sl) { if (isValidDate(s.date) && s.saldo != null) newSaldos.push(s); }
        } else {
          const fnInfo = parseFilename(f.name);
          if (!fnInfo) { errs.push(`${f.name}: nome inválido`); continue; }
          const trx = parseCardPDF(pages, fnInfo.card, fnInfo.month, fnInfo.year);
          for (const t of trx) {
            if (!isValidDate(t.date) || t.amount == null || t.amount === 0) continue;
            const merchant = normalizeMerchant(t.description);
            const cat = categorizeCard(t.description);
            const fp = `${fnInfo.card}|${t.date}|${merchant}|${t.amount}|${t.installment || "X"}`;
            newCards.push({ ...t, merchant, category: cat, fingerprint: fp });
          }
        }
      } catch (e) { errs.push(`${f.name}: ${e instanceof Error ? e.message : e}`); }
    }

    // Merge com existentes (dedup por fingerprint, último vence)
    setUploadProgress("Salvando...");
    const cardMap = new Map<string, any>();
    (Array.isArray(cardsRaw)?cardsRaw:[]).forEach(t => { if (t.fingerprint) cardMap.set(t.fingerprint, t); });
    (Array.isArray(newCards)?newCards:[]).forEach(t => cardMap.set(t.fingerprint, t));
    const mergedCards = [...cardMap.values()];

    const bankMap = new Map<string, any>();
    (Array.isArray(bankRaw)?bankRaw:[]).forEach(t => { if (t.fingerprint) bankMap.set(t.fingerprint, t); });
    (Array.isArray(newBank)?newBank:[]).forEach(t => bankMap.set(t.fingerprint, t));
    const mergedBank = [...bankMap.values()];

    const saldoMap = new Map<string, any>();
    (Array.isArray(saldos)?saldos:[]).forEach(s => saldoMap.set(s.date, s));
    (Array.isArray(newSaldos)?newSaldos:[]).forEach(s => saldoMap.set(s.date, s));
    const mergedSaldos = [...saldoMap.values()].sort((a, b) => a.date.localeCompare(b.date));

    try {
      await saveData(mergedCards, mergedBank, mergedSaldos, overrides);
      setCardsRaw(mergedCards);
      setBankRaw(mergedBank);
      setSaldos(mergedSaldos);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("SAVE ERROR:", e);
      toast(`Erro ao salvar: ${msg.substring(0, 300)}`, "error");
      setUploadProgress(null);
      return;
    }

    setUploadProgress(null);
    const addedCards = mergedCards.length - cardsRaw.length;
    const addedBank = mergedBank.length - bankRaw.length;
    toast(`+${addedCards} cartão · +${addedBank} extrato · ${mergedSaldos.length} saldos${errs.length ? ` · ${errs.length} erros` : ""}`, "success");
    errs.slice(0, 2).forEach(e => toast(e, "error"));
    setShowImport(false);
  }

  async function saveOverride(key: string, category: string) {
    const newOv = { ...overrides, [key]: category };
    try { await saveData(cardsRaw, bankRaw, saldos, newOv); setOverrides(newOv); toast("Categoria atualizada", "success"); }
    catch (e) { toast(`Erro: ${e instanceof Error ? e.message : e}`, "error"); }
  }
  async function clearOverride(key: string) {
    const newOv = { ...overrides }; delete newOv[key];
    try { await saveData(cardsRaw, bankRaw, saldos, newOv); setOverrides(newOv); toast("Regra removida", "success"); }
    catch (e) { toast(`Erro: ${e instanceof Error ? e.message : e}`, "error"); }
  }
  async function clearAllOverrides() {
    if (!window.confirm("Remover todas as regras?")) return;
    try { await saveData(cardsRaw, bankRaw, saldos, {}); setOverrides({}); toast("Regras limpas", "success"); }
    catch (e) { toast(`Erro: ${e instanceof Error ? e.message : e}`, "error"); }
  }
  async function saveBudgets(newBud: Record<string, number>) {
    try { await saveData(cardsRaw, bankRaw, saldos, overrides, newBud); setBudgets(newBud); toast("Orçamentos salvos", "success"); }
    catch (e) { toast(`Erro: ${e instanceof Error ? e.message : e}`, "error"); }
  }
  async function clearAllData() {
    if (!window.confirm("APAGAR todas as transações?")) return;
    try { await saveData([], [], [], {}, {}); setCardsRaw([]); setBankRaw([]); setSaldos([]); setOverrides({}); setBudgets({}); toast("Dados removidos", "success"); }
    catch (e) { toast(`Erro: ${e instanceof Error ? e.message : e}`, "error"); }
  }

  const allMonths = useMemo(() => { const s = new Set<string>(); (Array.isArray(cards)?cards:[]).forEach(t => s.add(t.statement_month)); (Array.isArray(bank)?bank:[]).forEach(t => s.add(t.statement_month)); return [...s].filter(Boolean).sort(); }, [cards, bank]);
  const activeMonths = useMemo(() => {
    if (!allMonths.length) return new Set<string>();
    if (periodPreset === "all") return new Set(allMonths);
    if (periodPreset === "last1") return new Set(allMonths.slice(-1));
    if (periodPreset === "last3") return new Set(allMonths.slice(-3));
    if (periodPreset === "last6") return new Set(allMonths.slice(-6));
    if (periodPreset === "last12") return new Set(allMonths.slice(-12));
    if (periodPreset === "custom" && periodFrom && periodTo) return new Set((Array.isArray(allMonths)?allMonths:[]).filter(m => m >= periodFrom && m <= periodTo));
    return new Set(allMonths);
  }, [allMonths, periodPreset, periodFrom, periodTo]);
  const fCards = useMemo(() => (Array.isArray(cards)?cards:[]).filter(t => activeMonths.has(t.statement_month) && t.category !== "Pagamento Fatura"), [cards, activeMonths]);
  const fBank = useMemo(() => (Array.isArray(bank)?bank:[]).filter(t => activeMonths.has(t.statement_month)), [bank, activeMonths]);
  const nMonths = activeMonths.size || 1;

  const cardInsights = useMemo(() => {
    const byCat: Record<string, number> = {}, byOwner: Record<string, number> = {}, byCard: Record<string, number> = {};
    const mm: Record<string, Set<string>> = {}, mv: Record<string, number[]> = {};
    let total = 0;
    for (const t of fCards) {
      total += t.amount;
      byCat[t.category] = (byCat[t.category] || 0) + t.amount;
      byOwner[t.holder] = (byOwner[t.holder] || 0) + t.amount;
      byCard[t.card] = (byCard[t.card] || 0) + t.amount;
      if (!mm[t.merchant]) { mm[t.merchant] = new Set(); mv[t.merchant] = []; }
      mm[t.merchant].add(t.statement_month);
      mv[t.merchant].push(t.amount);
    }
    const recurring: any[] = [];
    for (const m of Object.keys(mm)) {
      const mc = mm[m].size;
      if (mc >= 3) { const tot = mv[m].reduce((a, b) => a + b, 0); recurring.push({ merchant: m, months: mc, total: tot, avg: tot / mc, count: mv[m].length }); }
    }
    recurring.sort((a, b) => b.total - a.total);
    return { total, byCat, byOwner, byCard, recurring };
  }, [fCards]);

  const bankInsights = useMemo(() => {
    const byCat: Record<string, number> = {}, byMonth: Record<string, any> = {};
    const co: Record<string, any> = {}, ci: Record<string, any> = {};
    for (const t of fBank) {
      byCat[t.category] = (byCat[t.category] || 0) + Math.abs(t.amount);
      const m = t.statement_month;
      if (!byMonth[m]) byMonth[m] = { in: 0, out: 0 };
      byMonth[m][t.amount > 0 ? "in" : "out"] += Math.abs(t.amount);
      if (t.counterparty) {
        const b = t.amount < 0 ? co : ci;
        if (!b[t.counterparty]) b[t.counterparty] = { name: t.counterparty, total: 0, count: 0, months: new Set() };
        b[t.counterparty].total += Math.abs(t.amount);
        b[t.counterparty].count++;
        b[t.counterparty].months.add(m);
      }
    }
    const toList = (b: any) => Object.values(b).map((v: any) => ({ name: v.name, total: v.total, count: v.count, months: v.months.size })).sort((a: any, b: any) => b.total - a.total);
    return { byCat, byMonth, topOut: toList(co), topIn: toList(ci) };
  }, [fBank]);

  // ===== Visão unificada de despesas (cartão + extrato real), normalizada por categoria =====
  const unifiedExpenses = useMemo(() => {
    const rows: { date: string; month: string; category: string; amount: number; source: string; label: string }[] = [];
    for (const t of fCards) {
      rows.push({ date: t.date, month: t.statement_month, category: t.category, amount: t.amount, source: "cartao", label: t.merchant });
    }
    for (const t of fBank) {
      if (t.amount >= 0) continue;
      if (t.category === "Investimento (aporte)" || t.category === "Cartão de crédito" || t.category.startsWith("Transf.")) continue;
      // limpa prefixo "PIX enviado: " pra unificar com categorias de cartão quando possível
      const cleanCat = t.category.replace(/^PIX enviado:\s*/, "");
      rows.push({ date: t.date, month: t.statement_month, category: cleanCat, amount: Math.abs(t.amount), source: "extrato", label: t.counterparty || t.type });
    }
    return rows;
  }, [fCards, fBank]);

  const knownCats = useMemo(() => { const s = new Set<string>(); (Array.isArray(cardsRaw)?cardsRaw:[]).forEach(t => s.add(t.category)); (Array.isArray(bankRaw)?bankRaw:[]).forEach(t => s.add(t.category)); Object.values(overrides).forEach(c => s.add(c)); return [...s].filter(Boolean).sort(); }, [cardsRaw, bankRaw, overrides]);

  // categorias de despesa unificada (para orçamento)
  const expenseCats = useMemo(() => { const s = new Set<string>(); (Array.isArray(unifiedExpenses)?unifiedExpenses:[]).forEach(r => s.add(r.category)); return [...s].filter(Boolean).sort(); }, [unifiedExpenses]);

  function openReclassify(key: string, label: string, cat: string, origCat?: string | null) {
    setReclassifying({ key, label, cat, origCat });
    setNewCatInput(""); setNewCatSelect("");
  }

  if (bootErr) return (<div style={{ ...ROOT_STYLE, background: SB.bg }} className="fin-app min-h-screen flex items-center justify-center p-6"><style>{APP_CSS}</style><BeaUI.Banner variant="destructive" title="Erro ao iniciar">{bootErr}</BeaUI.Banner></div>);
  if (!ready) return (<div style={{ ...ROOT_STYLE, background: SB.bg }} className="fin-app min-h-screen flex items-center justify-center"><style>{APP_CSS}</style><BeaUI.LoadingState message="Carregando seus dados..." /></div>);

  const hasData = cardsRaw.length > 0 || bankRaw.length > 0;
  const monthsSorted = [...activeMonths].sort() as string[];
  const rangeLabel = monthsSorted.length ? (monthsSorted.length === 1 ? monthLabel(monthsSorted[0]) : `${monthLabel(monthsSorted[0])} → ${monthLabel(monthsSorted[monthsSorted.length - 1])}`) : "—";
  const currentNav = NAV.find(n => n.value === tab) || NAV[0];

  function renderTab() {
    switch (tab) {
      case "expenses": return <Expenses unifiedExpenses={unifiedExpenses} nMonths={nMonths} activeMonths={activeMonths} budgets={budgets} />;
      case "trends": return <Trends fCards={fCards} fBank={fBank} unifiedExpenses={unifiedExpenses} activeMonths={activeMonths} />;
      case "insights": return <Insights fCards={fCards} fBank={fBank} unifiedExpenses={unifiedExpenses} cardInsights={cardInsights} bankInsights={bankInsights} saldos={saldos} nMonths={nMonths} activeMonths={activeMonths} budgets={budgets} />;
      case "budgets": return <Budgets unifiedExpenses={unifiedExpenses} budgets={budgets} nMonths={nMonths} activeMonths={activeMonths} canEdit={canEdit} onEdit={() => setShowBudgets(true)} />;
      case "cards": return <Cards fCards={fCards} cardInsights={cardInsights} nMonths={nMonths} activeMonths={activeMonths} canEdit={canEdit} openReclassify={openReclassify} />;
      case "bank": return <Bank fBank={fBank} bankInsights={bankInsights} saldos={saldos} nMonths={nMonths} canEdit={canEdit} openReclassify={openReclassify} />;
      default: return <Overview fCards={fCards} fBank={fBank} cardInsights={cardInsights} bankInsights={bankInsights} unifiedExpenses={unifiedExpenses} nMonths={nMonths} activeMonths={activeMonths} budgets={budgets} />;
    }
  }

  const navButtons = (
    <>
      {(Array.isArray(NAV) ? NAV : []).map(n => {
        const active = tab === n.value;
        return (
          <button key={n.value} onClick={() => { setTab(n.value); setMobileNav(false); }} className="fin-nav"
            style={{ display: "flex", alignItems: "center", gap: 13, padding: "11px 12px", borderRadius: 7, border: 0, borderLeft: `2px solid ${active ? SB.accent : "transparent"}`, background: active ? "rgba(255,255,255,.09)" : "transparent", font: `${active ? 600 : 400} 13.5px 'Inter'`, color: active ? "#fff" : SB.navIdle, cursor: "pointer", textAlign: "left", width: "100%", outline: "none" }}>
            <BeaUI.Icon name={n.icon} size={17} />
            <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{n.label}</span>
          </button>
        );
      })}
    </>
  );

  const sidebarActions = canEdit ? (
    <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 14, paddingTop: 20, borderTop: "1px solid rgba(255,255,255,.1)" }}>
      <button onClick={() => { setShowImport(true); setMobileNav(false); }} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 9, padding: 12, border: 0, borderRadius: 7, background: SB.accent, color: "#fff", font: "600 13px 'Inter'", cursor: "pointer" }}>
        <BeaUI.Icon name="upload" size={15} /> Importar PDFs
      </button>
      <div style={{ display: "flex", gap: 20, padding: "0 8px" }}>
        <button onClick={() => { setShowBudgets(true); setMobileNav(false); }} style={{ background: "none", border: 0, padding: 0, color: SB.navMute, font: "400 12px 'Inter'", cursor: "pointer" }}>Orçamentos</button>
        <button onClick={() => { setShowRules(true); setMobileNav(false); }} style={{ background: "none", border: 0, padding: 0, color: SB.navMute, font: "400 12px 'Inter'", cursor: "pointer" }}>Regras</button>
      </div>
    </div>
  ) : null;

  const sidebarInner = (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 13, padding: "0 8px 30px" }}>
        <div className="fin-serif" style={{ width: 38, height: 38, borderRadius: 7, background: SB.accent, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600, fontSize: 19, flex: "none" }}>F</div>
        <div style={{ minWidth: 0 }}>
          <div className="fin-serif" style={{ fontWeight: 600, fontSize: 16, lineHeight: 1.05, color: "#fff" }}>Finanças Pessoais</div>
          <div style={{ font: "400 11px 'Inter'", color: SB.navMute, marginTop: 2 }}>Painel de controle</div>
        </div>
      </div>
      <div style={{ font: "500 10px 'Inter'", letterSpacing: ".14em", color: SB.sect, textTransform: "uppercase", padding: "0 12px 10px" }}>Painel</div>
      <nav style={{ display: "flex", flexDirection: "column", gap: 2 }}>{navButtons}</nav>
      {sidebarActions}
    </>
  );

  return (
    <div style={{ ...ROOT_STYLE, background: SB.bg, color: SB.ink }} className="fin-app min-h-screen">
      <style>{APP_CSS}</style>

      {/* ============ SIDEBAR (desktop) ============ */}
      <aside className="hidden lg:flex lg:flex-col lg:fixed lg:inset-y-0 lg:left-0 lg:w-64 z-30" style={{ background: SB.side, padding: "28px 18px" }}>
        {sidebarInner}
      </aside>

      {/* ============ Drawer (mobile) ============ */}
      {mobileNav && (
        <div className="lg:hidden fixed inset-0 z-50 fin-fade">
          <div className="absolute inset-0" style={{ background: "rgba(28,43,70,.5)" }} onClick={() => setMobileNav(false)} />
          <aside className="absolute inset-y-0 left-0 flex flex-col" style={{ width: 264, maxWidth: "85%", background: SB.side, padding: "24px 18px" }}>
            <button onClick={() => setMobileNav(false)} style={{ position: "absolute", top: 18, right: 16, background: "none", border: 0, color: SB.navMute, cursor: "pointer" }}><BeaUI.Icon name="x" size={20} /></button>
            {sidebarInner}
          </aside>
        </div>
      )}

      {/* ============ MAIN ============ */}
      <div className="lg:pl-64">
        {/* Topbar mobile (hambúrguer) */}
        <div className="lg:hidden sticky top-0 z-20 flex items-center gap-3 h-14 px-4" style={{ background: SB.card, borderBottom: `1px solid ${SB.border}` }}>
          <button onClick={() => setMobileNav(true)} style={{ background: "none", border: 0, color: SB.ink, cursor: "pointer", display: "flex" }}><BeaUI.Icon name="menu" size={22} /></button>
          <div className="fin-serif" style={{ fontWeight: 600, fontSize: 16, color: SB.ink }}>Finanças Pessoais</div>
        </div>

        <main className="px-5 sm:px-8 lg:px-10 py-6 lg:py-8" style={{ maxWidth: 1320, margin: "0 auto" }}>
          {/* Cabeçalho da seção */}
          <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 20, marginBottom: 24, paddingBottom: 22, borderBottom: `1px solid ${SB.border}` }}>
            <div style={{ minWidth: 0 }}>
              <div className="fin-serif" style={{ fontSize: 30, lineHeight: 1.1, fontWeight: 600, color: SB.ink }}>{currentNav.label}</div>
              <div style={{ font: "400 14px 'Inter'", color: SB.muted, marginTop: 6 }}>{currentNav.sub}</div>
            </div>
            {hasData && (
              <div style={{ textAlign: "right", flex: "none" }} className="hidden sm:block">
                <div style={{ font: "400 11px 'Inter'", letterSpacing: ".1em", color: SB.faint, textTransform: "uppercase" }}>Período analisado</div>
                <div className="font-mono" style={{ fontSize: 16, fontWeight: 500, color: SB.ink, marginTop: 4 }}>{rangeLabel}</div>
                <div style={{ font: "400 12px 'Inter'", color: SB.faint, marginTop: 2 }}>{activeMonths.size} {activeMonths.size === 1 ? "mês" : "meses"}</div>
              </div>
            )}
          </header>

          {!hasData ? (
            <div className="fin-fade" style={{ background: SB.card, border: `1px solid ${SB.border}`, borderRadius: 10, padding: "48px 36px" }}>
              <BeaUI.EmptyStateIllustrated illustration="data" title="Comece importando seus PDFs"
                description="Faça upload das faturas (Elo, Master) e do extrato bancário. Tudo é processado no seu browser e salvo na sua conta."
                action={canEdit ? <button onClick={() => setShowImport(true)} className={BTN_PRIMARY}><BeaUI.Icon name="upload" size={14} /> Importar PDFs</button> : null} />
            </div>
          ) : (
            <>
              <div className="fin-fade" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 22 }}>
                <PeriodChips value={periodPreset} onChange={(v: string) => setPeriodPreset(v)}
                  options={[{ value: "all", label: "Tudo" }, { value: "last1", label: "Último mês" }, { value: "last3", label: "3 meses" }, { value: "last6", label: "6 meses" }, { value: "last12", label: "12 meses" }, { value: "custom", label: "Personalizado" }]} />
                {periodPreset === "custom" ? (
                  <div className="fin-fade" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ font: "400 13px 'Inter'", color: SB.muted }}>De</span>
                    <input type="month" value={periodFrom} onChange={e => setPeriodFrom(e.target.value)} style={{ height: 38, padding: "0 12px", borderRadius: 8, border: `1px solid #d6d4ca`, background: SB.card, font: "400 13px 'Inter'", color: SB.ink }} />
                    <span style={{ font: "400 13px 'Inter'", color: SB.muted }}>até</span>
                    <input type="month" value={periodTo} onChange={e => setPeriodTo(e.target.value)} style={{ height: 38, padding: "0 12px", borderRadius: 8, border: `1px solid #d6d4ca`, background: SB.card, font: "400 13px 'Inter'", color: SB.ink }} />
                  </div>
                ) : (
                  <span className="sm:hidden font-mono" style={{ fontSize: 13, color: SB.ink }}>{rangeLabel}</span>
                )}
              </div>

              <div key={tab} className="fin-fade">{renderTab()}</div>
            </>
          )}
        </main>
      </div>

      {reclassifying && (
        <BeaUI.Dialog open={true} onClose={() => setReclassifying(null)} title="Reclassificar categoria">
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Mudar categoria de <strong className="text-foreground">{reclassifying.label}</strong></p>
            <BeaUI.FormField label="Categoria atual"><input className="w-full h-9 px-3 rounded-lg border border-input bg-muted text-sm text-foreground" value={reclassifying.cat} disabled /></BeaUI.FormField>
            <BeaUI.FormField label="Nova categoria">
              <select className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring" value={newCatSelect} onChange={e => setNewCatSelect(e.target.value)}>
                <option value="">— Escolha —</option>
                {(Array.isArray(knownCats)?knownCats:[]).filter(c => c !== reclassifying.cat).map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </BeaUI.FormField>
            <BeaUI.FormField label="Ou digite uma nova"><input type="text" className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring" placeholder="ex: Saúde mental, Cartão Jordana..." value={newCatInput} onChange={e => setNewCatInput(e.target.value)} /></BeaUI.FormField>
            <p className="text-xs text-muted-foreground">A regra vale para todas as transações deste estabelecimento.</p>
            <div className="flex gap-2 justify-end pt-2">
              <BeaUI.Button variant="ghost" onClick={() => setReclassifying(null)}>Cancelar</BeaUI.Button>
              {reclassifying.origCat && <BeaUI.Button variant="destructive" onClick={() => { clearOverride(reclassifying.key); setReclassifying(null); }}>Remover regra</BeaUI.Button>}
              <BeaUI.Button onClick={() => { const cat = newCatInput.trim() || newCatSelect; if (!cat) { toast("Escolha ou digite uma categoria", "error"); return; } saveOverride(reclassifying.key, cat); setReclassifying(null); }}>Salvar</BeaUI.Button>
            </div>
          </div>
        </BeaUI.Dialog>
      )}

      {showBudgets && (
        <BudgetEditor open={showBudgets} onClose={() => setShowBudgets(false)} cats={expenseCats} budgets={budgets} onSave={saveBudgets} />
      )}

      {showRules && (
        <BeaUI.Dialog open={showRules} onClose={() => setShowRules(false)} title="Gerenciar regras de categoria">
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Suas regras personalizadas têm prioridade sobre a categorização automática.</p>
            {Object.keys(overrides).length === 0 ? (
              <BeaUI.EmptyState icon={<BeaUI.Icon name="sliders-horizontal" size={48} />} title="Nenhuma regra criada" description="Clique em Reclassificar em qualquer transação para começar." />
            ) : (
              <div className="max-h-96 overflow-y-auto space-y-2">
                {Object.entries(overrides).sort().map(([k, c]) => (
                  <div key={k} className="flex items-center gap-3 p-3 rounded-lg border border-border bg-muted/40 hover:bg-muted transition-colors">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{k.replace(/^card:|^bank:|^bank-type:/, "")}</p>
                      <p className="text-xs text-muted-foreground truncate">{k.startsWith("card:") ? "Cartão" : k.startsWith("bank-type:") ? "Tipo bancário" : "Contraparte"} → <strong className="text-primary">{c}</strong></p>
                    </div>
                    <button onClick={() => clearOverride(k)} className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-destructive/10 text-destructive transition-colors" title="Remover"><BeaUI.Icon name="trash-2" size={14} /></button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2 justify-end pt-2 border-t border-border">
              {Object.keys(overrides).length > 0 && <BeaUI.Button variant="destructive" onClick={clearAllOverrides}>Limpar todas</BeaUI.Button>}
              <BeaUI.Button onClick={() => setShowRules(false)}>Fechar</BeaUI.Button>
            </div>
          </div>
        </BeaUI.Dialog>
      )}

      {showImport && (
        <BeaUI.Dialog open={showImport} onClose={() => uploadProgress ? null : setShowImport(false)} title="Importar PDFs">
          <div className="space-y-4">
            <BeaUI.Banner variant="info" icon={<BeaUI.Icon name="info" size={16} />}>
              Faça upload das faturas (<code>Elo Maio.pdf</code>, <code>Master Janeiro.pdf</code>) e do extrato (<code>Extrato.pdf</code>). Tudo é parseado no browser e salvo em UMA única operação no banco.
            </BeaUI.Banner>
            <label className="block">
              <input type="file" multiple accept=".pdf,application/pdf" disabled={!!uploadProgress} onChange={e => { if (e.target.files) handlePDFUpload(e.target.files); }} className="block w-full text-sm text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-primary file:text-primary-foreground hover:file:opacity-90 disabled:opacity-50" />
            </label>
            {uploadProgress && (
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 flex items-center gap-3 fin-fade">
                <BeaUI.Spinner size="md" />
                <span className="text-sm text-foreground">{uploadProgress}</span>
              </div>
            )}
            <div className="border-t border-border pt-3 flex justify-between items-center">
              <BeaUI.Button variant="destructive" size="sm" onClick={clearAllData} disabled={!!uploadProgress}><BeaUI.Icon name="trash-2" size={14} /> Apagar dados</BeaUI.Button>
              <BeaUI.Button variant="ghost" onClick={() => setShowImport(false)} disabled={!!uploadProgress}>Fechar</BeaUI.Button>
            </div>
          </div>
        </BeaUI.Dialog>
      )}
    </div>
  );
}

// ============================ VISÃO GERAL ============================
function Overview({ fCards, fBank, cardInsights, bankInsights, unifiedExpenses, nMonths, activeMonths, budgets }: any) {
  const cardTotal = cardInsights.total;
  const renda = (Array.isArray(fBank)?fBank:[]).filter((t: any) => t.category === "PIX recebido: Renda").reduce((s: number, t: any) => s + t.amount, 0);
  const despReais = (Array.isArray(fBank)?fBank:[]).filter((t: any) => t.amount < 0 && t.category !== "Investimento (aporte)" && !t.category.startsWith("Transf.") && t.category !== "Cartão de crédito").reduce((s: number, t: any) => s + Math.abs(t.amount), 0);
  const aportes = bankInsights.byCat["Investimento (aporte)"] || 0;
  const total = cardTotal + despReais;
  const monthsArr = [...activeMonths].sort() as string[];
  const monthsLabels = (Array.isArray(monthsArr)?monthsArr:[]).map(monthLabel);
  const cardPerMonth = (Array.isArray(monthsArr)?monthsArr:[]).map(m => (Array.isArray(fCards)?fCards:[]).filter((t: any) => t.statement_month === m).reduce((s: number, t: any) => s + t.amount, 0));
  const bankExpPerMonth = (Array.isArray(monthsArr)?monthsArr:[]).map(m => (Array.isArray(fBank)?fBank:[]).filter((t: any) => t.statement_month === m && t.amount < 0 && t.category !== "Investimento (aporte)" && !t.category.startsWith("Transf.") && t.category !== "Cartão de crédito").reduce((s: number, t: any) => s + Math.abs(t.amount), 0));
  const rendaPerMonth = (Array.isArray(monthsArr)?monthsArr:[]).map(m => (Array.isArray(fBank)?fBank:[]).filter((t: any) => t.statement_month === m && t.category === "PIX recebido: Renda").reduce((s: number, t: any) => s + t.amount, 0));
  const totalExpPerMonth = (Array.isArray(monthsArr)?monthsArr:[]).map((_, i) => cardPerMonth[i] + bankExpPerMonth[i]);
  const savingsRate = renda > 0 ? ((renda - total) / renda) * 100 : 0;

  // despesa unificada por categoria
  const expByCat: Record<string, number> = {};
  (Array.isArray(unifiedExpenses)?unifiedExpenses:[]).forEach((r: any) => { expByCat[r.category] = (expByCat[r.category] || 0) + r.amount; });
  const topCats = Object.entries(expByCat).sort((a: any, b: any) => b[1] - a[1]).slice(0, 12);
  const totalBudget = Object.values(budgets || {}).reduce((s: number, v: any) => s + (v || 0), 0);
  const aluguel = bankInsights.byCat["Moradia (Aluguel/Cond)"] || 0;
  const mercado = (expByCat["Mercado"] || 0);
  const maxCat = topCats.length ? (topCats[0][1] as number) : 1;

  return (
    <div className="space-y-4">
      <StatGroup>
        <StatCard label="Renda recebida" value={fmtBRL(renda)} accent="success" hint={`PIX de terceiros · ${nMonths}m`} />
        <StatCard label="Despesas totais" value={fmtBRL(total)} accent="destructive" hint="Cartão + extrato bancário" />
        <StatCard label="Saldo líquido" value={fmtBRL(renda - total)} accent={renda - total >= 0 ? "success" : "destructive"} hint={renda > 0 ? `Taxa de poupança ${savingsRate.toFixed(0)}%` : ""} />
        <StatCard label="Aportes investimento" value={fmtBRL(aportes)} accent="primary" hint={`${fmtBRL(aportes / nMonths)} / mês`} />
      </StatGroup>

      <StatGroup>
        <StatCard label="Média gastos/mês" value={fmtBRL(total / nMonths)} accent="neutral" />
        <StatCard label="Gasto no cartão" value={fmtBRL(cardTotal)} accent="neutral" hint={total > 0 ? `${((cardTotal / total) * 100).toFixed(0)}% do total` : ""} />
        <StatCard label="Gasto via conta" value={fmtBRL(despReais)} accent="neutral" hint={total > 0 ? `${((despReais / total) * 100).toFixed(0)}% do total` : ""} />
        <StatCard label="Orçamento definido" value={totalBudget > 0 ? fmtBRL(totalBudget) : "—"} accent={totalBudget > 0 && (total / nMonths) > totalBudget ? "destructive" : "success"} hint={totalBudget > 0 ? `Realizado ${fmtBRL(total / nMonths)}/mês` : "Defina no Orçamento"} />
      </StatGroup>

      <div className="fin-grid-2">
        <Panel title="Fluxo mensal" description="Renda × despesas no período">
          <div className="h-72"><BeaUI.BarChart data={{ labels: monthsLabels, datasets: [{ label: "Renda", data: rendaPerMonth, backgroundColor: SB.green }, { label: "Cartões", data: (Array.isArray(cardPerMonth)?cardPerMonth:[]).map(v => -v), backgroundColor: SB.side }, { label: "Outras saídas", data: (Array.isArray(bankExpPerMonth)?bankExpPerMonth:[]).map(v => -v), backgroundColor: SB.red }] }} /></div>
        </Panel>
        <Panel title="Para onde vai o dinheiro" description="Todas as despesas por categoria">
          <div className="space-y-3">
            {(Array.isArray(topCats)?topCats:[]).slice(0, 6).map(([cat, val]: any, i: number) => {
              const share = total > 0 ? (val / total) * 100 : 0;
              return (
                <div key={cat}>
                  <div className="flex justify-between" style={{ marginBottom: 6 }}>
                    <span style={{ font: "400 13px 'Inter'", color: SB.ink }}>{cat}</span>
                    <span className="font-mono" style={{ fontSize: 13, color: SB.chip }}>{share.toFixed(0)}%</span>
                  </div>
                  <div style={{ height: 7, background: SB.bInner, borderRadius: 4, overflow: "hidden" }}>
                    <div style={{ width: `${(val / maxCat) * 100}%`, height: "100%", background: catColor(cat, i) }} />
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 22, paddingTop: 16, borderTop: `1px solid ${SB.bInner}`, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={{ font: "400 11px 'Inter'", letterSpacing: ".07em", color: SB.faint, textTransform: "uppercase" }}>Total de despesas</span>
            <span className="font-mono" style={{ fontSize: 20, fontWeight: 500, color: SB.ink }}>{fmtBRL(total)}</span>
          </div>
        </Panel>
      </div>

      <Panel title="Gasto total mês a mês" description="Soma de cartões + conta">
        <div className="h-64"><BeaUI.LineChart data={{ labels: monthsLabels, datasets: [{ label: "Despesas totais", data: totalExpPerMonth, borderColor: SB.red, backgroundColor: "rgba(176,58,48,0.10)", fill: true, tension: 0.3 } as any, { label: "Renda", data: rendaPerMonth, borderColor: SB.green, backgroundColor: "rgba(46,125,82,0.05)", fill: false, tension: 0.3 } as any] }} /></div>
      </Panel>

      <Panel title="Resumo do período">
        <div className="space-y-3">
          <BeaUI.Banner variant="info" icon={<BeaUI.Icon name="info" size={16} />}><strong>Renda × Despesas:</strong> {fmtBRL(renda)} de recebimentos × {fmtBRL(total)} em saídas. Diferença: <strong>{fmtBRL(renda - total)}</strong> em {nMonths} {nMonths === 1 ? "mês" : "meses"}{renda > 0 ? ` · taxa de poupança ${savingsRate.toFixed(0)}%` : ""}.</BeaUI.Banner>
          {total > 0 && <BeaUI.Banner variant="warning" icon={<BeaUI.Icon name="pie-chart" size={16} />}><strong>Composição:</strong> Cartões {fmtBRL(cardTotal)} ({((cardTotal / total) * 100).toFixed(0)}%) + Outras saídas {fmtBRL(despReais)} ({((despReais / total) * 100).toFixed(0)}%). Maiores blocos: {(Array.isArray(topCats)?topCats:[]).slice(0, 4).map(([k, v]: any) => `${k} ${fmtBRL(v)}`).join(" · ")}.</BeaUI.Banner>}
          {(aluguel + mercado) > 0 && <BeaUI.Banner variant="success" icon={<BeaUI.Icon name="lightbulb" size={16} />}><strong>Média mensal das principais:</strong> {(Array.isArray(topCats)?topCats:[]).slice(0, 5).map(([k, v]: any) => `${k} ${fmtBRL(v / nMonths)}`).join(" · ")}.</BeaUI.Banner>}
        </div>
      </Panel>
    </div>
  );
}

// ============================ DESPESAS (unificadas) ============================
function Expenses({ unifiedExpenses, nMonths, activeMonths, budgets }: any) {
  const [fcat, setFcat] = useState("all"), [fsrc, setFsrc] = useState("all"), [sortBy, setSortBy] = useState("date");
  const cats = [...new Set((Array.isArray(unifiedExpenses)?unifiedExpenses:[]).map((r: any) => r.category))].sort() as string[];

  const byCat: Record<string, number> = {};
  (Array.isArray(unifiedExpenses)?unifiedExpenses:[]).forEach((r: any) => { byCat[r.category] = (byCat[r.category] || 0) + r.amount; });
  const byCatArr = Object.entries(byCat).sort((a: any, b: any) => b[1] - a[1]);
  const totalExp = (Array.isArray(unifiedExpenses)?unifiedExpenses:[]).reduce((s: number, r: any) => s + r.amount, 0);

  const filtered = (Array.isArray(unifiedExpenses)?unifiedExpenses:[]).filter((r: any) => (fcat === "all" || r.category === fcat) && (fsrc === "all" || r.source === fsrc));
  const sorted = [...filtered].sort((a, b) => sortBy === "amount" ? b.amount - a.amount : b.date.localeCompare(a.date));
  const filteredTotal = (Array.isArray(filtered)?filtered:[]).reduce((s: number, r: any) => s + r.amount, 0);
  const maxCat = byCatArr.length ? (byCatArr[0][1] as number) : 1;

  return (
    <div className="space-y-4">
      <StatGroup>
        <StatCard label="Total no período" value={fmtBRL(totalExp)} accent="destructive" hint={`${unifiedExpenses.length} lançamentos`} />
        <StatCard label="Média mensal" value={fmtBRL(totalExp / nMonths)} accent="neutral" />
        <StatCard label="Categorias ativas" value={String(cats.length)} accent="neutral" />
        <StatCard label="Maior categoria" value={byCatArr.length ? (byCatArr[0][0] as string) : "—"} accent="warning" hint={byCatArr.length ? fmtBRL(byCatArr[0][1] as number) : ""} />
      </StatGroup>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-3">
          <Panel title="Ranking de categorias" description="Onde você mais gasta">
            <div className="space-y-3">
              {(Array.isArray(byCatArr)?byCatArr:[]).slice(0, 14).map(([cat, val]: any, i: number) => {
                const pct = (val / maxCat) * 100;
                const share = totalExp > 0 ? (val / totalExp) * 100 : 0;
                const bud = (budgets || {})[cat];
                const budMonthly = bud ? bud * nMonths : null;
                const over = budMonthly != null && val > budMonthly;
                return (
                  <div key={cat} className="space-y-1">
                    <div className="flex items-center justify-between" style={{ font: "400 13px 'Inter'" }}>
                      <span style={{ color: SB.ink, display: "flex", alignItems: "center", gap: 8 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: catColor(cat, i) }} />{cat}</span>
                      <span className="font-mono" style={{ color: SB.ink }}>{fmtBRL(val)} <span style={{ color: SB.faint }}>({share.toFixed(0)}%)</span></span>
                    </div>
                    <div style={{ height: 7, background: SB.bInner, borderRadius: 4, overflow: "hidden" }}>
                      <div style={{ width: `${pct}%`, height: "100%", background: over ? SB.red : catColor(cat, i) }} />
                    </div>
                    {budMonthly != null && (
                      <p style={{ font: "400 12px 'Inter'", color: over ? SB.red : SB.muted }}>{over ? "Acima do limite · " : "Dentro · "}{fmtBRL(val / nMonths)}/mês vs orçamento {fmtBRL(bud)}/mês</p>
                    )}
                  </div>
                );
              })}
            </div>
          </Panel>
        </div>
        <div className="lg:col-span-2">
          <Panel title="Distribuição">
            <div className="h-72 flex items-center justify-center"><BeaUI.DonutChart data={byCatArr.slice(0, 10).map(([label, value]: any, i: number) => ({ label, value, color: catColor(label, i) }))} centerLabel="Total" centerValue={fmtBRL(totalExp).replace("R$", "").trim()} height={240} /></div>
          </Panel>
        </div>
      </div>

      <Panel title="Todos os lançamentos" description="Cartão + conta unificados">
        <div className="flex flex-wrap gap-3 items-center mb-4">
          <PillSel label="Categoria" value={fcat} onChange={setFcat} options={[{ value: "all", label: "Todas" }, ...cats.map(c => ({ value: c, label: c }))]} />
          <PillSel label="Origem" value={fsrc} onChange={setFsrc} options={[{ value: "all", label: "Todas" }, { value: "cartao", label: "Cartão" }, { value: "extrato", label: "Conta" }]} />
          <PillSel label="Ordenar" value={sortBy} onChange={setSortBy} options={[{ value: "date", label: "Data" }, { value: "amount", label: "Valor" }]} />
          <span className="ml-auto" style={{ font: "400 13px 'Inter'", color: SB.muted }}>Total filtrado: <strong className="font-mono" style={{ color: SB.ink }}>{fmtBRL(filteredTotal)}</strong></span>
        </div>
        <BeaUI.DataTable data={sorted} searchable pageSize={30} columns={[
          { key: "date", header: "Data", render: (v: any) => <span className="font-mono text-xs" style={{ color: SB.muted }}>{new Date(v).toLocaleDateString("pt-BR")}</span> },
          { key: "label", header: "Descrição", render: (v: any) => <span style={{ color: SB.ink }}>{v}</span> },
          { key: "category", header: "Categoria", render: (v: string, _r: any, i: number) => <CatTag cat={v} idx={i || 0} /> },
          { key: "source", header: "Origem", render: (v: string) => <span style={{ font: "400 13px 'Inter'", color: SB.chip }}>{v === "cartao" ? "Cartão" : "Conta"}</span> },
          { key: "amount", header: "Valor", render: (v: number) => <span className="font-mono" style={{ color: SB.ink }}>{fmtNum(v)}</span>, className: "text-right" },
        ]} emptyMessage="Nenhuma despesa" />
      </Panel>
    </div>
  );
}

// ============================ EVOLUÇÃO / TENDÊNCIAS ============================
function Trends({ fCards, fBank, unifiedExpenses, activeMonths }: any) {
  const monthsArr = [...activeMonths].sort() as string[];
  const monthsLabels = (Array.isArray(monthsArr)?monthsArr:[]).map(monthLabel);

  const byCat: Record<string, number> = {};
  (Array.isArray(unifiedExpenses)?unifiedExpenses:[]).forEach((r: any) => { byCat[r.category] = (byCat[r.category] || 0) + r.amount; });
  const topCats = Object.entries(byCat).sort((a: any, b: any) => b[1] - a[1]).slice(0, 6).map(([k]) => k);

  const datasetsStacked = (Array.isArray(topCats)?topCats:[]).map((cat, i) => ({
    label: cat,
    data: (Array.isArray(monthsArr)?monthsArr:[]).map(m => (Array.isArray(unifiedExpenses)?unifiedExpenses:[]).filter((r: any) => r.month === m && r.category === cat).reduce((s: number, r: any) => s + r.amount, 0)),
    backgroundColor: catColor(cat, i),
  }));

  const totalPerMonth = (Array.isArray(monthsArr)?monthsArr:[]).map(m => (Array.isArray(unifiedExpenses)?unifiedExpenses:[]).filter((r: any) => r.month === m).reduce((s: number, r: any) => s + r.amount, 0));
  const avg = totalPerMonth.length ? (Array.isArray(totalPerMonth)?totalPerMonth:[]).reduce((a, b) => a + b, 0) / totalPerMonth.length : 0;
  const avgLine = (Array.isArray(monthsArr)?monthsArr:[]).map(() => avg);

  const deltas = (Array.isArray(monthsArr)?monthsArr:[]).map((m, i) => {
    if (i === 0) return null;
    const prev = totalPerMonth[i - 1], cur = totalPerMonth[i];
    const pct = prev > 0 ? ((cur - prev) / prev) * 100 : 0;
    return { month: monthLabel(m), prev, cur, delta: cur - prev, pct };
  }).filter(Boolean);

  const firstM = monthsArr[0], lastM = monthsArr[monthsArr.length - 1];
  const compare = monthsArr.length >= 2 ? (Array.isArray(topCats)?topCats:[]).map((cat, i) => {
    const fv = (Array.isArray(unifiedExpenses)?unifiedExpenses:[]).filter((r: any) => r.month === firstM && r.category === cat).reduce((s: number, r: any) => s + r.amount, 0);
    const lv = (Array.isArray(unifiedExpenses)?unifiedExpenses:[]).filter((r: any) => r.month === lastM && r.category === cat).reduce((s: number, r: any) => s + r.amount, 0);
    return { cat, fv, lv, delta: lv - fv, pct: fv > 0 ? ((lv - fv) / fv) * 100 : 0, color: catColor(cat, i) };
  }) : [];

  return (
    <div className="space-y-4">
      <Panel title="Evolução das despesas por categoria" description="Composição mês a mês">
        <div className="h-96"><BeaUI.BarChart data={{ labels: monthsLabels, datasets: datasetsStacked }} options={{ scales: { x: { stacked: true }, y: { stacked: true } } } as any} /></div>
      </Panel>

      <Panel title="Gasto total + média do período" description="Linha tracejada = média mensal">
        <div className="h-72"><BeaUI.LineChart data={{ labels: monthsLabels, datasets: [{ label: "Total mensal", data: totalPerMonth, borderColor: SB.accent, backgroundColor: "rgba(200,112,42,0.10)", fill: true, tension: 0.3 } as any, { label: "Média", data: avgLine, borderColor: SB.red, borderDash: [6, 6], fill: false, pointRadius: 0 } as any] }} /></div>
      </Panel>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel title="Variação mês a mês" description="Quanto subiu ou caiu">
          {deltas.length === 0 ? (
            <BeaUI.EmptyState icon={<BeaUI.Icon name="bar-chart-3" size={40} />} title="Período curto" description="Selecione mais de um mês para ver variações." />
          ) : (
            <div className="space-y-2">
              {(Array.isArray(deltas)?deltas:[]).map((d: any) => (
                <div key={d.month} className="flex items-center justify-between" style={{ padding: "13px 14px", borderRadius: 8, border: `1px solid ${SB.row}`, background: "#fcfcfa" }}>
                  <span style={{ font: "500 14px 'Inter'", color: SB.ink }}>{d.month}</span>
                  <div className="flex items-center gap-3">
                    <span className="font-mono" style={{ fontSize: 14, color: SB.ink }}>{fmtBRL(d.cur)}</span>
                    <span className="font-mono" style={{ fontSize: 13, fontWeight: 500, color: d.delta > 0 ? SB.red : SB.green }}>{d.delta > 0 ? "▲" : "▼"} {Math.abs(d.pct).toFixed(0)}%</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title={`Comparativo ${monthsArr.length >= 2 ? monthLabel(firstM) + " → " + monthLabel(lastM) : ""}`} description="Top categorias: início vs fim">
          {compare.length === 0 ? (
            <BeaUI.EmptyState icon={<BeaUI.Icon name="git-compare" size={40} />} title="Período curto" description="Selecione mais de um mês para comparar." />
          ) : (
            <div className="space-y-2">
              {(Array.isArray(compare)?compare:[]).map((c: any) => (
                <div key={c.cat} className="flex items-center justify-between" style={{ padding: "13px 14px", borderRadius: 8, border: `1px solid ${SB.row}`, background: "#fcfcfa" }}>
                  <span style={{ font: "500 14px 'Inter'", color: SB.ink, display: "flex", alignItems: "center", gap: 8 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: c.color }} />{c.cat}</span>
                  <div className="flex items-center gap-3" style={{ fontSize: 12 }}>
                    <span className="font-mono" style={{ color: SB.muted }}>{fmtBRL(c.fv)} → {fmtBRL(c.lv)}</span>
                    {c.fv > 0 && <span className="font-mono" style={{ fontWeight: 500, color: c.delta > 0 ? SB.red : SB.green }}>{c.delta > 0 ? "▲" : "▼"} {Math.abs(c.pct).toFixed(0)}%</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

// ============================ INSIGHTS (automáticos) ============================
function Insights({ fCards, fBank, unifiedExpenses, cardInsights, bankInsights, saldos, nMonths, activeMonths, budgets }: any) {
  const parseLocal = (s: string) => { const [y, m, d] = (s || "").split("-").map(Number); return new Date(y || 2000, (m || 1) - 1, d || 1); };

  const exp = Array.isArray(unifiedExpenses) ? unifiedExpenses : [];
  const totalExp = (Array.isArray(exp)?exp:[]).reduce((s: number, r: any) => s + r.amount, 0);

  if (exp.length === 0) {
    return (
      <div style={{ background: SB.card, border: `1px solid ${SB.border}`, borderRadius: 10, padding: "48px 36px" }}>
        <BeaUI.EmptyState icon={<BeaUI.Icon name="lightbulb" size={48} />} title="Sem dados no período" description="Ajuste o filtro de período ou importe PDFs para ver insights." />
      </div>
    );
  }

  const biggest = (Array.isArray(exp)?exp:[]).reduce((mx: any, r: any) => (!mx || r.amount > mx.amount ? r : mx), null);
  const ticket = totalExp / exp.length;

  const byCat: Record<string, number> = {};
  (Array.isArray(exp)?exp:[]).forEach((r: any) => { byCat[r.category] = (byCat[r.category] || 0) + r.amount; });
  const byCatArr = Object.entries(byCat).sort((a: any, b: any) => (b[1] as number) - (a[1] as number));
  const top3 = byCatArr.slice(0, 3).reduce((s, [, v]: any) => s + v, 0);
  const concentration = totalExp > 0 ? (top3 / totalExp) * 100 : 0;

  const byDay: Record<string, number> = {};
  (Array.isArray(exp)?exp:[]).forEach((r: any) => { byDay[r.date] = (byDay[r.date] || 0) + r.amount; });
  const topDay = Object.entries(byDay).sort((a: any, b: any) => (b[1] as number) - (a[1] as number))[0] || null;

  const DOW = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  const byDow = [0, 0, 0, 0, 0, 0, 0];
  (Array.isArray(exp)?exp:[]).forEach((r: any) => { byDow[parseLocal(r.date).getDay()] += r.amount; });
  const maxDow = byDow.indexOf(Math.max(...byDow));
  const weekend = byDow[0] + byDow[6];
  const weekendPct = totalExp > 0 ? (weekend / totalExp) * 100 : 0;

  const assinaturas = (Array.isArray(fCards)?fCards:[]).filter((t: any) => t.category === "Assinaturas").reduce((s: number, t: any) => s + t.amount, 0);
  const assinaturasMensal = assinaturas / nMonths;

  let parcelasFuturas = 0, qtdParcelas = 0;
  (Array.isArray(fCards)?fCards:[]).forEach((t: any) => {
    if (t.installment) { const [a, b] = String(t.installment).split("/").map(Number); if (a && b && b > a) { parcelasFuturas += t.amount * (b - a); qtdParcelas++; } }
  });

  const projAnual = (totalExp / nMonths) * 12;
  const renda = (Array.isArray(fBank)?fBank:[]).filter((t: any) => t.category === "PIX recebido: Renda").reduce((s: number, t: any) => s + t.amount, 0);
  const savingsRate = renda > 0 ? ((renda - totalExp) / renda) * 100 : 0;

  const byLabel: Record<string, number> = {};
  (Array.isArray(exp)?exp:[]).forEach((r: any) => { byLabel[r.label] = (byLabel[r.label] || 0) + r.amount; });
  const topLabel = Object.entries(byLabel).sort((a: any, b: any) => (b[1] as number) - (a[1] as number))[0] || null;
  const topLabelShare = topLabel && totalExp > 0 ? ((topLabel[1] as number) / totalExp) * 100 : 0;

  const monthsArr = [...activeMonths].sort() as string[];
  let grower: any = null, shrinker: any = null;
  if (monthsArr.length >= 2) {
    const lastM = monthsArr[monthsArr.length - 1], prevM = monthsArr[monthsArr.length - 2];
    const diffs = (Array.isArray(byCatArr)?byCatArr:[]).map(([cat]: any) => {
      const lv = (Array.isArray(exp)?exp:[]).filter((r: any) => r.month === lastM && r.category === cat).reduce((s: number, r: any) => s + r.amount, 0);
      const pv = (Array.isArray(exp)?exp:[]).filter((r: any) => r.month === prevM && r.category === cat).reduce((s: number, r: any) => s + r.amount, 0);
      return { cat, lv, pv, delta: lv - pv, pct: pv > 0 ? ((lv - pv) / pv) * 100 : (lv > 0 ? 100 : 0) };
    });
    grower = (Array.isArray(diffs)?diffs:[]).filter(d => d.delta > 0).sort((a, b) => b.delta - a.delta)[0] || null;
    shrinker = (Array.isArray(diffs)?diffs:[]).filter(d => d.delta < 0).sort((a, b) => a.delta - b.delta)[0] || null;
  }

  // Cartões de insight no estilo sóbrio (ícone + título serifado + texto)
  const insightCards: any[] = [];
  const pushIns = (icon: string, color: string, title: string, body: any) => insightCards.push({ icon, color, title, body });
  if (biggest) pushIns("flame", SB.red, "Maior despesa do período", <>{fmtBRL(biggest.amount)} em <strong style={{ color: SB.ink }}>{biggest.label}</strong> ({biggest.category}) no dia {parseLocal(biggest.date).toLocaleDateString("pt-BR")}.</>);
  pushIns("pie-chart", SB.accent, "Concentração de gastos", <>{concentration.toFixed(0)}% de tudo está em apenas 3 categorias: {byCatArr.slice(0, 3).map(([k, v]: any) => `${k} ${fmtBRL(v)}`).join(" · ")}.</>);
  pushIns("calendar", SB.side, "Padrão semanal", <>{DOW[maxDow] === "Sáb" || DOW[maxDow] === "Dom" ? "O fim de semana" : DOW[maxDow]} é o dia de maior gasto. {weekendPct.toFixed(0)}% do total acontece nos finais de semana ({fmtBRL(weekend)}).</>);
  if (assinaturasMensal > 0) pushIns("repeat", SB.accent, "Assinaturas recorrentes", <>~{fmtBRL(assinaturasMensal)}/mês em serviços recorrentes — isso dá <strong style={{ color: SB.ink }}>{fmtBRL(assinaturasMensal * 12)}</strong> por ano. Vale revisar o que ainda usa.</>);
  if (parcelasFuturas > 0) pushIns("hourglass", SB.side, "Compromisso futuro", <>Estimativa de <strong style={{ color: SB.ink }}>{fmtBRL(parcelasFuturas)}</strong> ainda a vencer em {qtdParcelas} compras parceladas.</>);
  if (topLabel) pushIns("store", SB.green, "Maior recebedor", <><strong style={{ color: SB.ink }}>{topLabel[0]}</strong> concentra {fmtBRL(topLabel[1] as number)} ({topLabelShare.toFixed(0)}% das despesas) no período.</>);
  if (grower && grower.delta > 0) pushIns("trending-up", SB.red, "Maior alta recente", <><strong style={{ color: SB.ink }}>{grower.cat}</strong> subiu {fmtBRL(grower.delta)} ({grower.pv > 0 ? `+${grower.pct.toFixed(0)}%` : "novo"}) do mês anterior para o último mês.</>);
  if (shrinker && shrinker.delta < 0) pushIns("trending-down", SB.green, "Maior queda recente", <><strong style={{ color: SB.ink }}>{shrinker.cat}</strong> caiu {fmtBRL(Math.abs(shrinker.delta))} ({shrinker.pct.toFixed(0)}%) no último mês — bom trabalho.</>);
  if (renda > 0) pushIns("piggy-bank", savingsRate >= 0 ? SB.green : SB.red, "Saúde financeira", <>Você {savingsRate >= 0 ? "guardou" : "gastou além da renda em"} {Math.abs(savingsRate).toFixed(0)}% da renda ({fmtBRL(renda - totalExp)} de diferença entre {fmtBRL(renda)} de renda e {fmtBRL(totalExp)} de despesas).</>);

  return (
    <div className="space-y-4">
      <StatGroup>
        <StatCard label="Maior gasto único" value={biggest ? fmtBRL(biggest.amount) : "—"} accent="destructive" hint={biggest ? biggest.label : ""} />
        <StatCard label="Ticket médio" value={fmtBRL(ticket)} accent="neutral" hint={`${exp.length} lançamentos`} />
        <StatCard label="Concentração top 3" value={`${concentration.toFixed(0)}%`} accent="warning" hint={byCatArr.slice(0, 3).map(([k]) => k).join(", ")} />
        <StatCard label="Projeção anual" value={fmtBRL(projAnual)} accent="neutral" hint={`Base ${fmtBRL(totalExp / nMonths)}/mês`} />
      </StatGroup>

      <StatGroup>
        <StatCard label="Assinaturas/mês" value={fmtBRL(assinaturasMensal)} accent="primary" hint={`~${fmtBRL(assinaturasMensal * 12)}/ano`} />
        <StatCard label="Parcelas a vencer" value={fmtBRL(parcelasFuturas)} accent="warning" hint={qtdParcelas > 0 ? `${qtdParcelas} compras parceladas` : "Nenhuma detectada"} />
        <StatCard label="Dia mais caro" value={topDay ? fmtBRL(topDay[1] as number) : "—"} accent="destructive" hint={topDay ? parseLocal(topDay[0]).toLocaleDateString("pt-BR") : ""} />
        <StatCard label="Taxa de poupança" value={renda > 0 ? `${savingsRate.toFixed(0)}%` : "—"} accent={savingsRate >= 0 ? "success" : "destructive"} hint={renda > 0 ? `Renda ${fmtBRL(renda)}` : "Sem renda no período"} />
      </StatGroup>

      <Panel title="Gasto por dia da semana" description="Em que dias você mais gasta">
        <div className="h-64"><BeaUI.BarChart data={{ labels: DOW, datasets: [{ label: "Gasto", data: byDow, backgroundColor: (Array.isArray(DOW)?DOW:[]).map((_, i) => i === maxDow ? SB.red : SB.side) }] }} options={{ plugins: { legend: { display: false } } } as any} /></div>
      </Panel>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {(Array.isArray(insightCards)?insightCards:[]).map((ins: any, i: number) => (
          <div key={i} style={{ background: SB.card, border: `1px solid ${SB.border}`, borderRadius: 10, padding: "22px 24px", display: "flex", gap: 16 }}>
            <div style={{ width: 40, height: 40, borderRadius: 8, background: SB.bg, display: "flex", alignItems: "center", justifyContent: "center", flex: "none", color: ins.color }}><BeaUI.Icon name={ins.icon} size={18} /></div>
            <div style={{ minWidth: 0 }}>
              <div className="fin-serif" style={{ fontSize: 16, fontWeight: 600, color: SB.ink, marginBottom: 6 }}>{ins.title}</div>
              <div style={{ font: "400 13.5px/1.5 'Inter'", color: SB.chip }}>{ins.body}</div>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

// ============================ ORÇAMENTO ============================
function Budgets({ unifiedExpenses, budgets, nMonths, activeMonths, canEdit, onEdit }: any) {
  const budgetEntries = Object.entries(budgets || {}).filter(([, v]: any) => v > 0);
  const byCat: Record<string, number> = {};
  (Array.isArray(unifiedExpenses)?unifiedExpenses:[]).forEach((r: any) => { byCat[r.category] = (byCat[r.category] || 0) + r.amount; });

  if (budgetEntries.length === 0) {
    return (
      <div style={{ background: SB.card, border: `1px solid ${SB.border}`, borderRadius: 10, padding: "48px 36px" }}>
        <BeaUI.EmptyStateIllustrated illustration="empty" title="Nenhum orçamento definido"
          description="Defina limites mensais por categoria para acompanhar se está dentro do planejado. As barras vão mostrar o realizado vs o orçado."
          action={canEdit ? <button onClick={onEdit} className={BTN_PRIMARY}><BeaUI.Icon name="target" size={14} /> Definir orçamentos</button> : null} />
      </div>
    );
  }

  const rows = (Array.isArray(budgetEntries)?budgetEntries:[]).map(([cat, bud]: any, i: number) => {
    const spent = byCat[cat] || 0;
    const spentMonthly = spent / nMonths;
    const pct = bud > 0 ? (spentMonthly / bud) * 100 : 0;
    return { cat, bud, spent, spentMonthly, pct, color: catColor(cat, i), over: spentMonthly > bud };
  }).sort((a, b) => b.pct - a.pct);

  const totalBudget = (Array.isArray(rows)?rows:[]).reduce((s, r) => s + r.bud, 0);
  const totalSpentMonthly = (Array.isArray(rows)?rows:[]).reduce((s, r) => s + r.spentMonthly, 0);
  const overCount = (Array.isArray(rows)?rows:[]).filter(r => r.over).length;

  return (
    <div className="space-y-4">
      <StatGroup>
        <StatCard label="Orçado (mês)" value={fmtBRL(totalBudget)} accent="primary" />
        <StatCard label="Realizado (mês)" value={fmtBRL(totalSpentMonthly)} accent={totalSpentMonthly > totalBudget ? "destructive" : "success"} hint={totalBudget > 0 ? `${((totalSpentMonthly / totalBudget) * 100).toFixed(0)}% do orçado` : ""} />
        <StatCard label="Disponível" value={fmtBRL(totalBudget - totalSpentMonthly)} accent={totalBudget - totalSpentMonthly >= 0 ? "success" : "destructive"} />
        <StatCard label="Categorias estouradas" value={`${overCount}/${rows.length}`} accent={overCount > 0 ? "destructive" : "success"} />
      </StatGroup>

      <Panel title="Limites por categoria" description="Realizado (média mensal) vs orçado"
        action={canEdit ? <button onClick={onEdit} className={BTN_PRIMARY} style={{ height: 36, padding: "0 14px" }}><BeaUI.Icon name="pencil" size={14} /> Editar</button> : null}>
        <div>
          {(Array.isArray(rows)?rows:[]).map((r: any, i: number) => (
            <div key={r.cat} style={{ padding: "18px 0", borderBottom: i < rows.length - 1 ? `1px solid ${SB.row}` : "none" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 9 }}>
                <span style={{ font: "500 15px 'Inter'", color: SB.ink, display: "flex", alignItems: "center", gap: 9 }}><span style={{ width: 9, height: 9, borderRadius: 2, background: r.color }} />{r.cat}</span>
                <span className="font-mono" style={{ fontSize: 13, color: r.over ? SB.red : SB.chip }}>{fmtBRL(r.spentMonthly)} / {fmtBRL(r.bud)} <span style={{ fontWeight: 500, color: r.over ? SB.red : SB.faint }}>{r.pct.toFixed(0)}%</span></span>
              </div>
              <div style={{ height: 8, background: SB.bInner, borderRadius: 5, overflow: "hidden" }}>
                <div style={{ width: `${Math.min(r.pct, 100)}%`, height: "100%", background: r.over ? SB.red : r.pct > 80 ? "#a8743a" : r.color }} />
              </div>
              {r.over ? <div style={{ font: "400 12px 'Inter'", color: SB.red, marginTop: 7 }}>Estourou o limite em {fmtBRL(r.spentMonthly - r.bud)}/mês</div>
                : <div style={{ font: "400 12px 'Inter'", color: SB.green, marginTop: 7 }}>Folga de {fmtBRL(r.bud - r.spentMonthly)}/mês</div>}
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function BudgetEditor({ open, onClose, cats, budgets, onSave }: any) {
  const [local, setLocal] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    (Array.isArray(cats)?cats:[]).forEach((c: string) => { init[c] = budgets[c] != null ? String(budgets[c]) : ""; });
    Object.keys(budgets || {}).forEach(c => { if (init[c] === undefined) init[c] = String(budgets[c]); });
    return init;
  });

  const allCats = [...new Set([...(Array.isArray(cats) ? cats : []), ...Object.keys(budgets || {})])].sort();

  function handleSave() {
    const out: Record<string, number> = {};
    Object.entries(local).forEach(([k, v]) => { const n = parseFloat(String(v).replace(",", ".")); if (!isNaN(n) && n > 0) out[k] = n; });
    onSave(out);
    onClose();
  }

  const totalOrcado = Object.values(local).reduce((s, v) => { const n = parseFloat(String(v).replace(",", ".")); return s + (isNaN(n) ? 0 : n); }, 0);

  return (
    <BeaUI.Dialog open={open} onClose={onClose} title="Definir orçamentos mensais">
      <div className="space-y-3">
        <BeaUI.Banner variant="info" icon={<BeaUI.Icon name="info" size={16} />}>Defina um limite mensal (R$) por categoria. Deixe em branco para não acompanhar. O app compara com a média mensal realizada no período selecionado.</BeaUI.Banner>
        {allCats.length === 0 ? (
          <BeaUI.EmptyState icon={<BeaUI.Icon name="inbox" size={40} />} title="Sem categorias" description="Importe transações primeiro para definir orçamentos." />
        ) : (
          <div className="max-h-96 overflow-y-auto space-y-2 pr-1">
            {(Array.isArray(allCats)?allCats:[]).map((cat: string, i: number) => (
              <div key={cat} className="flex items-center gap-3 p-2 rounded-lg border border-border bg-muted/30">
                <span className="flex-1 text-sm font-medium text-foreground flex items-center gap-2 min-w-0"><span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: catColor(cat, i) }} /><span className="truncate">{cat}</span></span>
                <div className="flex items-center gap-1 shrink-0">
                  <span className="text-xs text-muted-foreground">R$</span>
                  <input type="number" inputMode="decimal" min="0" step="50" placeholder="0" value={local[cat] || ""} onChange={e => setLocal({ ...local, [cat]: e.target.value })} className="w-28 h-9 px-3 rounded-lg border border-input bg-background text-sm text-foreground text-right font-mono focus:outline-none focus:ring-2 focus:ring-ring" />
                  <span className="text-xs text-muted-foreground">/mês</span>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between pt-2 border-t border-border">
          <span className="text-sm text-muted-foreground">Total orçado: <strong className="text-foreground font-mono">{fmtBRL(totalOrcado)}</strong>/mês</span>
          <div className="flex gap-2">
            <BeaUI.Button variant="ghost" onClick={onClose}>Cancelar</BeaUI.Button>
            <BeaUI.Button onClick={handleSave}><BeaUI.Icon name="check" size={14} /> Salvar</BeaUI.Button>
          </div>
        </div>
      </div>
    </BeaUI.Dialog>
  );
}

// ============================ CARTÕES ============================
function Cards({ fCards, cardInsights, nMonths, activeMonths, canEdit, openReclassify }: any) {
  const [fc, setFc] = useState("all"), [fh, setFh] = useState("all"), [fcat, setFcat] = useState("all");
  const filtered = (Array.isArray(fCards)?fCards:[]).filter((t: any) => (fc === "all" || t.card === fc) && (fh === "all" || t.holder === fh) && (fcat === "all" || t.category === fcat));
  const total = (Array.isArray(filtered)?filtered:[]).reduce((s: number, t: any) => s + t.amount, 0);
  const elo = (Array.isArray(filtered)?filtered:[]).filter((t: any) => t.card === "Elo").reduce((s: number, t: any) => s + t.amount, 0);
  const master = (Array.isArray(filtered)?filtered:[]).filter((t: any) => t.card === "Master").reduce((s: number, t: any) => s + t.amount, 0);
  const cardsSet = [...new Set((Array.isArray(fCards)?fCards:[]).map((t: any) => t.card))] as string[];
  const holders = [...new Set((Array.isArray(fCards)?fCards:[]).map((t: any) => t.holder))] as string[];
  const categories = [...new Set((Array.isArray(fCards)?fCards:[]).map((t: any) => t.category))].sort() as string[];
  const monthsArr = [...activeMonths].sort() as string[];
  const monthlyByCard: Record<string, number[]> = {};
  (Array.isArray(cardsSet)?cardsSet:[]).forEach(c => { monthlyByCard[c] = (Array.isArray(monthsArr)?monthsArr:[]).map(m => (Array.isArray(filtered)?filtered:[]).filter((t: any) => t.statement_month === m && t.card === c).reduce((s: number, t: any) => s + t.amount, 0)); });
  const byCatArr = Object.entries(cardInsights.byCat).sort((a: any, b: any) => b[1] - a[1]);
  const byMerchant: Record<string, number> = {};
  (Array.isArray(filtered)?filtered:[]).forEach((t: any) => { byMerchant[t.merchant] = (byMerchant[t.merchant] || 0) + t.amount; });
  const topMerch = Object.entries(byMerchant).sort((a, b) => (b[1] as number) - (a[1] as number)).slice(0, 15);

  const cardMeta: [string, string][] = [["Elo", SB.accent], ["Master", SB.side]];
  return (
    <div className="space-y-4">
      <StatGroup>
        <StatCard label="Total no período" value={fmtBRL(total)} accent="primary" hint={`${filtered.length} transações`} />
        <StatCard label="Média mensal" value={fmtBRL(total / nMonths)} accent="neutral" />
        <StatCard label="Elo" value={fmtBRL(elo)} accent="warning" hint={total > 0 ? `${((elo / total) * 100).toFixed(0)}%` : ""} />
        <StatCard label="Master" value={fmtBRL(master)} accent="neutral" hint={total > 0 ? `${((master / total) * 100).toFixed(0)}%` : ""} />
      </StatGroup>

      <section className="flex flex-col sm:flex-row gap-4">
        {(Array.isArray(cardMeta)?cardMeta:[]).map(([nm, col]) => {
          const tot = nm === "Elo" ? elo : master;
          return (
            <div key={nm} style={{ flex: 1, background: "linear-gradient(135deg,#243652 0%,#1c2b46 100%)", borderRadius: 12, padding: "24px 26px", color: "#fff", position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", right: -30, top: -30, width: 120, height: 120, borderRadius: "50%", background: "rgba(255,255,255,.05)" }} />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span className="fin-serif" style={{ fontSize: 16, fontWeight: 600, color: "#fff" }}>Cartão {nm}</span>
                <BeaUI.Icon name="credit-card" size={18} className="text-white" />
              </div>
              <div style={{ font: "400 11px 'Inter'", letterSpacing: ".07em", color: SB.navMute, textTransform: "uppercase", margin: "26px 0 8px" }}>Gasto no período</div>
              <div className="font-mono" style={{ fontSize: 26, fontWeight: 500, color: "#fff" }}>{fmtBRL(tot)}</div>
              <div style={{ height: 6, background: "rgba(255,255,255,.12)", borderRadius: 4, overflow: "hidden", margin: "16px 0 8px" }}>
                <div style={{ width: `${total > 0 ? Math.round((tot / total) * 100) : 0}%`, height: "100%", background: col }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", font: "400 12px 'Inter'", color: SB.navIdle }}>
                <span>{total > 0 ? Math.round((tot / total) * 100) : 0}% do total</span>
                <span className="font-mono">{fmtBRL(tot / nMonths)}/mês</span>
              </div>
            </div>
          );
        })}
      </section>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", background: SB.card, border: `1px solid ${SB.border}`, borderRadius: 10, padding: "14px 18px" }}>
        <span style={{ font: "500 10.5px 'Inter'", letterSpacing: ".07em", color: SB.faint, textTransform: "uppercase" }}>Filtros</span>
        <PillSel label="Cartão" value={fc} onChange={setFc} options={[{ value: "all", label: "Todos" }, ...cardsSet.map(c => ({ value: c, label: c }))]} />
        <PillSel label="Pessoa" value={fh} onChange={setFh} options={[{ value: "all", label: "Todas" }, ...holders.map(h => ({ value: h, label: h }))]} />
        <PillSel label="Categoria" value={fcat} onChange={setFcat} options={[{ value: "all", label: "Todas" }, ...categories.map(c => ({ value: c, label: c }))]} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel title="Gasto mensal por cartão">
          <div className="h-72"><BeaUI.BarChart data={{ labels: (Array.isArray(monthsArr)?monthsArr:[]).map(monthLabel), datasets: (Array.isArray(cardsSet)?cardsSet:[]).map((c) => ({ label: c, data: monthlyByCard[c], backgroundColor: c === "Elo" ? SB.accent : c === "Master" ? SB.side : "#3a5a8c" })) }} options={{ scales: { x: { stacked: true }, y: { stacked: true } } } as any} /></div>
        </Panel>
        <Panel title="Distribuição por categoria">
          <div className="h-72 flex items-center justify-center"><BeaUI.DonutChart data={byCatArr.slice(0, 10).map(([label, value]: any, i: number) => ({ label, value, color: catColor(label, i) }))} centerLabel="Total" centerValue={fmtBRL(total).replace("R$", "").trim()} height={240} /></div>
        </Panel>
      </div>

      <Panel title="Top 15 estabelecimentos">
        <div className="h-96"><BeaUI.BarChart data={{ labels: (Array.isArray(topMerch)?topMerch:[]).map(([m]) => m.length > 30 ? m.slice(0, 30) + "…" : m), datasets: [{ label: "Total", data: (Array.isArray(topMerch)?topMerch:[]).map(([, v]) => v), backgroundColor: SB.side }] }} options={{ indexAxis: "y" as any, plugins: { legend: { display: false } } } as any} /></div>
      </Panel>

      {cardInsights.recurring.length > 0 && (
        <Panel title="Recorrências detectadas" description="3+ meses">
          <BeaUI.DataTable data={cardInsights.recurring} pageSize={10} columns={[
            { key: "merchant", header: "Estabelecimento", render: (v: any, r: any) => (<div className="flex items-center gap-2"><span style={{ fontWeight: 500, color: SB.ink }}>{v}</span>{canEdit && <button onClick={() => openReclassify(`card:${r.merchant}`, r.merchant, "(múltiplas)", null)} className="text-xs text-primary hover:underline">Reclassificar</button>}</div>) },
            { key: "months", header: "Meses", className: "text-right" },
            { key: "avg", header: "Média/mês", render: (v: number) => <span className="font-mono">{fmtBRL(v)}</span>, className: "text-right" },
            { key: "total", header: "Total", render: (v: number) => <span className="font-mono">{fmtBRL(v)}</span>, className: "text-right" },
            { key: "avg", header: "Projeção anual", render: (v: number) => <span className="font-mono" style={{ color: SB.muted }}>{fmtBRL(v * 12)}</span>, className: "text-right" },
          ]} emptyMessage="Nenhuma recorrência" />
        </Panel>
      )}

      <Panel title="Transações">
        <BeaUI.DataTable data={filtered} searchable pageSize={25} columns={[
          { key: "date", header: "Data", render: (v: any) => <span className="font-mono text-xs" style={{ color: SB.muted }}>{new Date(v).toLocaleDateString("pt-BR")}</span> },
          { key: "card", header: "Cartão", render: (v: string) => <CatTag cat={v} color={v === "Elo" ? SB.accent : SB.side} /> },
          { key: "holder", header: "Pessoa", render: (v: any) => <span style={{ color: SB.chip }}>{v}</span> },
          { key: "merchant", header: "Estabelecimento", render: (v: any) => <span style={{ color: SB.ink }}>{v}</span> },
          { key: "category", header: "Categoria", render: (v: string, r: any) => (<div className="flex items-center gap-1"><CatTag cat={v} />{r.orig_category && <span style={{ color: SB.accent, fontSize: 12 }} title="Reclassificado">●</span>}</div>) },
          { key: "installment", header: "Parcela", render: (v: any) => v || "" },
          { key: "amount", header: "Valor", render: (v: number) => <span className="font-mono" style={{ color: SB.ink }}>{fmtNum(v)}</span>, className: "text-right" },
          ...(canEdit ? [{ key: "id", header: "", render: (_v: any, r: any) => (<button onClick={() => openReclassify(`card:${r.merchant}`, r.merchant, r.category, r.orig_category)} className="text-xs px-2 py-1 rounded-lg border border-border hover:border-primary hover:text-primary transition-colors">Reclassificar</button>) }] : [])
        ]} emptyMessage="Nenhuma transação" />
      </Panel>
    </div>
  );
}

// ============================ CONTA CORRENTE ============================
function Bank({ fBank, bankInsights, saldos, nMonths, canEdit, openReclassify }: any) {
  const txs = fBank;
  const invOut = bankInsights.byCat["Investimento (aporte)"] || 0;
  const transfProp = (Array.isArray(txs)?txs:[]).filter((t: any) => t.category === "Transf. própria" || t.category === "PIX recebido: Transf. própria").reduce((s: number, t: any) => s + Math.abs(t.amount), 0);
  const renda = (Array.isArray(txs)?txs:[]).filter((t: any) => t.category === "PIX recebido: Renda").reduce((s: number, t: any) => s + t.amount, 0);
  const despReais = (Array.isArray(txs)?txs:[]).filter((t: any) => t.amount < 0 && t.category !== "Investimento (aporte)" && !t.category.startsWith("Transf.")).reduce((s: number, t: any) => s + Math.abs(t.amount), 0);
  const monthsArr = Object.keys(bankInsights.byMonth).sort();
  const inV = (Array.isArray(monthsArr)?monthsArr:[]).map(m => bankInsights.byMonth[m].in);
  const outV = (Array.isArray(monthsArr)?monthsArr:[]).map(m => bankInsights.byMonth[m].out);
  const netV = (Array.isArray(monthsArr)?monthsArr:[]).map((_, i) => inV[i] - outV[i]);
  const realCats = Object.entries(bankInsights.byCat).filter(([k]: any) => !k.startsWith("PIX recebido") && !k.startsWith("Investimento") && k !== "Transf. própria").sort((a: any, b: any) => b[1] - a[1]);
  return (
    <div className="space-y-4">
      <StatGroup>
        <StatCard label="Entradas (renda)" value={fmtBRL(renda)} accent="success" />
        <StatCard label="Despesas reais" value={fmtBRL(despReais)} accent="destructive" hint="Excl. investimentos" />
        <StatCard label="Aportes investimento" value={fmtBRL(invOut)} accent="primary" />
        <StatCard label="Transf. própria" value={fmtBRL(transfProp)} accent="neutral" />
      </StatGroup>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel title="Fluxo de caixa mensal">
          <div className="h-72"><BeaUI.BarChart data={{ labels: (Array.isArray(monthsArr)?monthsArr:[]).map(monthLabel), datasets: [{ label: "Entradas", data: inV, backgroundColor: SB.green }, { label: "Saídas", data: (Array.isArray(outV)?outV:[]).map((v: number) => -v), backgroundColor: SB.red }, { label: "Líquido", data: netV, type: "line", borderColor: SB.accent, backgroundColor: SB.accent, fill: false, tension: 0.3 } as any] }} /></div>
        </Panel>
        <Panel title="Distribuição das saídas reais">
          <div className="h-72 flex items-center justify-center"><BeaUI.DonutChart data={realCats.slice(0, 10).map(([label, value]: any, i: number) => ({ label, value, color: catColor(label, i) }))} centerLabel="Despesas" centerValue={fmtBRL(despReais).replace("R$", "").trim()} height={240} /></div>
        </Panel>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel title="Top destinatários PIX">
          <div className="h-96"><BeaUI.BarChart data={{ labels: bankInsights.topOut.slice(0, 15).map((o: any) => o.name.length > 25 ? o.name.slice(0, 25) + "…" : o.name), datasets: [{ label: "Total", data: bankInsights.topOut.slice(0, 15).map((o: any) => o.total), backgroundColor: SB.red }] }} options={{ indexAxis: "y" as any, plugins: { legend: { display: false } } } as any} /></div>
        </Panel>
        <Panel title="Top remetentes">
          <div className="h-96"><BeaUI.BarChart data={{ labels: bankInsights.topIn.slice(0, 15).map((o: any) => o.name.length > 25 ? o.name.slice(0, 25) + "…" : o.name), datasets: [{ label: "Total", data: bankInsights.topIn.slice(0, 15).map((o: any) => o.total), backgroundColor: SB.green }] }} options={{ indexAxis: "y" as any, plugins: { legend: { display: false } } } as any} /></div>
        </Panel>
      </div>

      {saldos.length > 0 && (
        <Panel title="Saldo Invest Fácil ao longo do tempo">
          <div className="h-64"><BeaUI.LineChart data={{ labels: (Array.isArray(saldos)?saldos:[]).map((s: any) => new Date(s.date).toLocaleDateString("pt-BR")), datasets: [{ label: "Saldo", data: (Array.isArray(saldos)?saldos:[]).map((s: any) => s.saldo), borderColor: SB.accent, backgroundColor: "rgba(200,112,42,0.10)", fill: true, tension: 0.3 } as any] }} /></div>
        </Panel>
      )}

      {bankInsights.topOut.filter((o: any) => o.months >= 3).length > 0 && (
        <Panel title="PIX recorrentes" description="3+ meses">
          <BeaUI.DataTable data={bankInsights.topOut.filter((o: any) => o.months >= 3)} pageSize={15} columns={[
            { key: "name", header: "Destinatário", render: (v: any, r: any) => (<div className="flex items-center gap-2"><span style={{ fontWeight: 500, color: SB.ink }}>{v}</span>{canEdit && <button onClick={() => openReclassify(`bank:${r.name}`, r.name, "(múltiplas)", null)} className="text-xs text-primary hover:underline">Reclassificar</button>}</div>) },
            { key: "count", header: "Trx", className: "text-right" },
            { key: "months", header: "Meses", className: "text-right" },
            { key: "total", header: "Total", render: (v: number) => <span className="font-mono">{fmtBRL(v)}</span>, className: "text-right" },
            { key: "total", header: "Média/mês", render: (_v: number, r: any) => <span className="font-mono">{fmtBRL(r.total / r.months)}</span>, className: "text-right" },
          ]} emptyMessage="Nenhuma recorrência" />
        </Panel>
      )}

      <Panel title="Transações da conta">
        <BeaUI.DataTable data={txs} searchable pageSize={25} columns={[
          { key: "date", header: "Data", render: (v: any) => <span className="font-mono text-xs" style={{ color: SB.muted }}>{new Date(v).toLocaleDateString("pt-BR")}</span> },
          { key: "type", header: "Tipo", render: (v: any) => <span style={{ color: SB.ink }}>{v}</span> },
          { key: "counterparty", header: "Contraparte", render: (v: any) => <span style={{ color: SB.chip }}>{v || ""}</span> },
          { key: "category", header: "Categoria", render: (v: string, r: any) => (<div className="flex items-center gap-1"><CatTag cat={v} />{r.orig_category && <span style={{ color: SB.accent, fontSize: 12 }} title="Reclassificado">●</span>}</div>) },
          { key: "amount", header: "Valor", render: (v: number) => <span className="font-mono" style={{ color: v >= 0 ? SB.green : SB.red }}>{fmtNum(v)}</span>, className: "text-right" },
          { key: "saldo", header: "Saldo", render: (v: any) => <span className="font-mono" style={{ color: SB.muted }}>{v != null ? fmtNum(v) : ""}</span>, className: "text-right" },
          ...(canEdit ? [{ key: "id", header: "", render: (_v: any, r: any) => { const key = r.counterparty ? `bank:${r.counterparty}` : `bank-type:${r.type}`; return (<button onClick={() => openReclassify(key, r.counterparty || r.type, r.category, r.orig_category)} className="text-xs px-2 py-1 rounded-lg border border-border hover:border-primary hover:text-primary transition-colors">Reclassificar</button>); } }] : [])
        ]} emptyMessage="Nenhuma transação" />
      </Panel>
    </div>
  );
}

// Tag de categoria: quadradinho colorido + nome (estilo "Banco Sóbrio")
function CatTag({ cat, idx = 0, color }: any) {
  const c = color || catColor(cat, idx);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, font: "400 13px 'Inter'", color: SB.ink }}>
      <span style={{ width: 8, height: 8, borderRadius: 2, background: c, flex: "none" }} />{cat}
    </span>
  );
}

function PillSel({ label, value, onChange, options }: any) {
  return (
    <div className="flex items-center gap-2">
      <span style={{ font: "400 12px 'Inter'", color: SB.muted }}>{label}:</span>
      <select value={value} onChange={e => onChange(e.target.value)} style={{ height: 34, padding: "0 12px", borderRadius: 8, border: `1px solid #d6d4ca`, background: SB.card, font: "400 12px 'Inter'", color: SB.ink, outline: "none" }}>
        {(Array.isArray(options)?options:[]).map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}
