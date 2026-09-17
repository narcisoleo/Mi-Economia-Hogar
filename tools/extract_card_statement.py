from __future__ import annotations
import json, re, sys, os, unicodedata
from pathlib import Path

BASE = Path(__file__).resolve().parent
VENDOR = BASE / 'vendor'
if str(VENDOR) not in sys.path:
    sys.path.insert(0, str(VENDOR))

try:
    from pypdf import PdfReader
except Exception as exc:
    print(json.dumps({"ok": False, "error": f"No se pudo cargar el lector PDF: {exc}"}, ensure_ascii=False))
    raise SystemExit(0)

MONTHS = {
    'ene':1,'enero':1,'jan':1,
    'feb':2,'febrero':2,
    'mar':3,'marzo':3,
    'abr':4,'abril':4,'apr':4,
    'may':5,'mayo':5,
    'jun':6,'junio':6,
    'jul':7,'julio':7,
    'ago':8,'agosto':8,'aug':8,
    'sep':9,'sept':9,'set':9,'septiembre':9,'setiembre':9,
    'oct':10,'octubre':10,
    'nov':11,'noviembre':11,
    'dic':12,'diciembre':12,'dec':12,
}
MONTH_NAMES = {1:'Enero',2:'Febrero',3:'Marzo',4:'Abril',5:'Mayo',6:'Junio',7:'Julio',8:'Agosto',9:'Septiembre',10:'Octubre',11:'Noviembre',12:'Diciembre'}

def strip_accents(s: str) -> str:
    return ''.join(ch for ch in unicodedata.normalize('NFD', s) if unicodedata.category(ch) != 'Mn')

def clean_spaces(s: str) -> str:
    return re.sub(r'\s+', ' ', s or '').strip()

def parse_money(raw: str | None) -> float | None:
    if raw is None:
        return None
    s = raw.strip().replace('$','').replace(' ','')
    neg = s.startswith('-') or s.endswith('-')
    s = s.strip('-')
    # AR format 1.234.567,89. If only comma, decimal comma.
    if ',' in s:
        s = s.replace('.', '').replace(',', '.')
    else:
        # Treat dot as thousands when exactly 3 digits groups; otherwise decimal.
        if re.fullmatch(r'\d{1,3}(?:\.\d{3})+', s):
            s = s.replace('.', '')
    try:
        value = float(s)
        return -value if neg else value
    except Exception:
        return None

def iso_date(day: int, month: int, year: int) -> str:
    if year < 100:
        year += 2000
    return f'{year:04d}-{month:02d}-{day:02d}'

def parse_spanish_date(raw: str | None) -> str | None:
    if not raw:
        return None
    s = clean_spaces(raw).replace('.', '')
    # dd-Mon-yy / dd Mon yy
    m = re.search(r'(\d{1,2})[- /]([A-Za-zÁÉÍÓÚáéíóúÑñ]+)[- /](\d{2,4})', s)
    if not m:
        return None
    d = int(m.group(1)); mon = strip_accents(m.group(2)).lower(); y = int(m.group(3))
    month = MONTHS.get(mon) or MONTHS.get(mon[:3])
    if not month:
        return None
    return iso_date(d, month, y)

def month_period_token_to_iso(token: str) -> str | None:
    m = re.match(r'([A-Za-zÁÉÍÓÚáéíóú]+)[/-](\d{2,4})', token.strip())
    if not m:
        return None
    mon = strip_accents(m.group(1)).lower(); y = int(m.group(2)); month = MONTHS.get(mon) or MONTHS.get(mon[:3])
    if not month:
        return None
    if y < 100: y += 2000
    return f'{y:04d}-{month:02d}-01'

def month_start(date_iso: str | None) -> str | None:
    if not date_iso: return None
    return date_iso[:7] + '-01'

def last_money(line: str) -> float | None:
    # Match AR amounts, prefer last token.
    vals = re.findall(r'-?\d[\d.]*,\d{2}-?', line)
    return parse_money(vals[-1]) if vals else None

def extract_installment(text: str):
    # Visa C.04/09; Mastercard 07/18
    m = re.search(r'(?:C\.)?(\d{1,2})/(\d{1,2})', text, re.I)
    if not m:
        return None, None
    cur, total = int(m.group(1)), int(m.group(2))
    if 0 < cur <= total <= 99:
        return cur, total
    return None, None

def clean_merchant(text: str) -> str:
    s = text
    s = re.sub(r'\bC\.\d{1,2}/\d{1,2}\b', '', s, flags=re.I)
    s = re.sub(r'\b\d{9,}\b', '', s)
    s = re.sub(r'\s+', ' ', s).strip(' *-')
    return s

def future_installments(text: str):
    # Search local windows after "Cuotas a vencer".
    out = []
    for match in re.finditer(r'Cuotas a vencer\s*:?', text, re.I):
        snippet = text[match.end(): match.end()+800]
        period_tokens = re.findall(r'(?:Enero|Febrero|Marzo|Abril|Mayo|Junio|Julio|Agosto|Septiembre|Setiembre|Octubre|Noviembre|Diciembre)[/-]\d{2,4}', snippet, re.I)
        amounts = re.findall(r'\$\s*([\d.]+,\d{2})', snippet)
        # Stop at obvious narrative if too many amounts; first N correspond to periods in both samples.
        n = min(len(period_tokens), len(amounts))
        if n:
            for p,a in zip(period_tokens[:n], amounts[:n]):
                pi = month_period_token_to_iso(p)
                val = parse_money(a)
                if pi and val is not None:
                    out.append({"periodMonth": pi, "label": p, "amount": val})
            break
    return out

def parse_visa(text: str, filename: str):
    first = text[:7000]
    def find_date(pattern):
        m = re.search(pattern, first, re.I)
        return parse_spanish_date(m.group(1)) if m else None

    closing = find_date(r'CIERRE\s+(\d{1,2}\s+[A-Za-zÁÉÍÓÚáéíóú]+\s+\d{2,4})')
    due = find_date(r'VENCIMIENTO\s+(\d{1,2}\s+[A-Za-zÁÉÍÓÚáéíóú]+\s+\d{2,4})')
    prev_close = find_date(r'Cierre\s+Ant\.:\s*(\d{1,2}\s+[A-Za-zÁÉÍÓÚáéíóú]+\s+\d{2,4})')
    prev_due = find_date(r'Vto\.\s*Ant\.:\s*(\d{1,2}\s+[A-Za-zÁÉÍÓÚáéíóú]+\s+\d{2,4})')
    next_close = find_date(r'Prox\.Cierre:\s*(\d{1,2}\s+[A-Za-zÁÉÍÓÚáéíóú]+\s+\d{2,4})')
    next_due = find_date(r'Prox\.Vto\.:\s*(\d{1,2}\s+[A-Za-zÁÉÍÓÚáéíóú]+\s+\d{2,4})')

    m = re.search(r'LIMITES:\s*COMPRA\s*\$\s*([\d.]+,\d{2})', first, re.I)
    purchase_limit = parse_money(m.group(1)) if m else None
    m = re.search(r'FINANCIACION\s*\$\s*([\d.]+,\d{2})', first, re.I)
    financing_limit = parse_money(m.group(1)) if m else None
    m = re.search(r'Tarjeta\s+(\d{4})\s+Total Consumos.*?([\d.]+,\d{2})', text, re.I)
    card_last4 = m.group(1) if m else None
    total_purchases = parse_money(m.group(2)) if m else None
    if not card_last4:
        fm = re.search(r'(\d{4})(?!.*\d)', filename)
        card_last4 = fm.group(1) if fm else None

    m = re.search(r'DEBITAREMOS[^\n]*?SUMA DE\s*\$\s*([\d.]+,\d{2})', text, re.I)
    balance = parse_money(m.group(1)) if m else None
    if balance is None:
        # fallback: last SALDO ACTUAL-like amount
        ms = re.findall(r'SALDO ACTUAL[^\n]*?([\d.]+,\d{2})', text, re.I)
        balance = parse_money(ms[-1]) if ms else None
    m = re.search(r'pago m[ií]nimo de\s*\$\s*([\d.]+,\d{2})', text, re.I)
    min_payment = parse_money(m.group(1)) if m else None
    if min_payment is None:
        # page 6 usually contains isolated min payment; avoid unreliable if unavailable
        ms = re.findall(r'PAGO MINIMO[^\n]*?([\d.]+,\d{2})', text, re.I)
        min_payment = parse_money(ms[-1]) if ms else None

    holder = None
    hm = re.search(r'\n\s*([A-ZÁÉÍÓÚÑ]+,[A-ZÁÉÍÓÚÑ ]+)\s*\n', first)
    if hm: holder = clean_spaces(hm.group(1)).title()

    purchases = []
    cur_year = None; cur_month = None
    stop = False
    lines = text.splitlines()
    for line in lines:
        if re.search(r'Tarjeta\s+\d{4}\s+Total Consumos', line, re.I):
            stop = True
        if stop:
            continue
        # Date prefix may be year+month or inherited.
        # Full pattern: 26 Agosto 07 539021 V Spotify 5.499,00
        m = re.match(r'^\s*(?:(\d{2})\s+([A-Za-zÁÉÍÓÚáéíóú]+)\s+)?(\d{2})\s+(\d{6})\s+([*A-Za-z])\s+(.*?)\s+([\d.]+,\d{2})\s*$', line)
        if not m:
            continue
        yy, mon_raw, day, coupon, marker, desc, amount_raw = m.groups()
        if yy and mon_raw:
            mon_key = strip_accents(mon_raw).lower()
            mm = MONTHS.get(mon_key) or MONTHS.get(mon_key[:3])
            if not mm: continue
            cur_year = 2000 + int(yy)
            cur_month = mm
        if cur_year is None or cur_month is None:
            continue
        date = iso_date(int(day), cur_month, cur_year)
        amount = parse_money(amount_raw)
        if amount is None or amount <= 0: continue
        inst_cur, inst_total = extract_installment(desc)
        merchant = clean_merchant(desc)
        purchases.append({
            "date": date,
            "merchant": merchant,
            "amount": amount,
            "installmentCurrent": inst_cur,
            "installmentTotal": inst_total,
            "kind": "purchase",
            "raw": clean_spaces(line),
        })

    charges = []
    labels = [
        ('IMPUESTO DE SELLOS','tax'),('INTERESES FINANCIACION','interest'),('PUNIT. PAG.MIN.ANTERIOR','interest'),
        ('IIBB PERCEP-BSAS','tax'),('IVA RG 4240','tax'),('DB.RG 5617','tax')
    ]
    for line in lines:
        up = strip_accents(line).upper()
        for label, ctype in labels:
            if strip_accents(label).upper() in up:
                amount = last_money(line)
                if amount is not None and amount > 0:
                    charges.append({"date": closing, "merchant": clean_spaces(label), "amount": amount, "kind": "charge", "chargeType": ctype, "raw": clean_spaces(line)})
                break

    return {
        "issuer": "Banco Provincia", "brand": "Visa", "holderName": holder,
        "cardLast4": card_last4,
        "closingDate": closing, "dueDate": due,
        "previousClosingDate": prev_close, "previousDueDate": prev_due,
        "nextClosingDate": next_close, "nextDueDate": next_due,
        "purchaseLimit": purchase_limit, "financingLimit": financing_limit,
        "statementBalance": balance, "minimumPayment": min_payment, "totalPurchases": total_purchases,
        "purchases": purchases, "charges": charges, "futureInstallments": future_installments(text),
    }

def parse_mastercard(text: str, filename: str):
    def md(pattern):
        m = re.search(pattern, text, re.I)
        return parse_spanish_date(m.group(1)) if m else None
    statement_date = md(r'Estado del cuenta al:\s*(\d{1,2}-[A-Za-zÁÉÍÓÚáéíóú]+-\d{2,4})')
    due = md(r'Vencimiento actual:\s*(\d{1,2}-[A-Za-zÁÉÍÓÚáéíóú]+-\d{2,4})')
    prev_close = md(r'Cierre Anterior:\s*(\d{1,2}-[A-Za-zÁÉÍÓÚáéíóú]+-\d{2,4})')
    prev_due = md(r'Vencimiento Anterior:\s*(\d{1,2}-[A-Za-zÁÉÍÓÚáéíóú]+-\d{2,4})')
    next_close = md(r'Pr[oó]ximo Cierre:\s*(\d{1,2}-[A-Za-zÁÉÍÓÚáéíóú]+-\d{2,4})')
    next_due = md(r'Pr[oó]ximo Vencimiento:\s*(\d{1,2}-[A-Za-zÁÉÍÓÚáéíóú]+-\d{2,4})')
    # Mastercard layout uses statement date as current closing date.
    closing = statement_date
    m = re.search(r'Saldo actual:\s*\$\s*([\d.]+,\d{2})', text, re.I); balance = parse_money(m.group(1)) if m else None
    m = re.search(r'Pago M[ií]nimo:\s*\$\s*([\d.]+,\d{2})', text, re.I); min_payment = parse_money(m.group(1)) if m else None
    m = re.search(r'L[ií]mite Cr[eé]dito\s*\$\s*([\d.]+,\d{2})', text, re.I); purchase_limit = parse_money(m.group(1)) if m else None
    m = re.search(r'TOTAL CONSUMOS DEL MES\s*([\d.]+,\d{2})', text, re.I); total_purchases = parse_money(m.group(1)) if m else None
    hm = re.search(r'\n\s*([A-ZÁÉÍÓÚÑ]+(?:\s+[A-ZÁÉÍÓÚÑ]+){1,4})\s+Hoja', text)
    holder = clean_spaces(hm.group(1)).title() if hm else None
    all4 = re.findall(r'(?<!\d)(\d{4})(?!\d)', filename)
    card_last4 = all4[0] if all4 else None

    lines = text.splitlines()
    purchases = []
    in_detail = False
    for line in lines:
        if 'COMPRAS DEL MES' in line.upper() or 'CUOTAS DEL MES' in line.upper():
            in_detail = True
            continue
        if in_detail and 'TOTAL TITULAR' in line.upper():
            break
        if not in_detail: continue
        m = re.match(r'^\s*(\d{1,2}-[A-Za-zÁÉÍÓÚáéíóú]+-\d{2,4})\s+(.*?)\s+(\d{5})\s+([\d.]+,\d{2})\s*$', line)
        if not m:
            continue
        date_raw, desc, coupon, amount_raw = m.groups()
        date = parse_spanish_date(date_raw)
        amount = parse_money(amount_raw)
        if not date or amount is None or amount <= 0: continue
        inst_cur, inst_total = extract_installment(desc)
        merchant = clean_merchant(desc)
        purchases.append({"date": date, "merchant": merchant, "amount": amount,
                          "installmentCurrent": inst_cur, "installmentTotal": inst_total,
                          "kind":"purchase", "raw": clean_spaces(line)})

    charges = []
    charge_patterns = [
        ('INTERESES COMPENSATORIOS','interest'),('INTERESES PUNITORIOS','interest'),('IMPUESTO DE SELLOS','tax')
    ]
    for line in lines:
        up = strip_accents(line).upper().strip()
        for label, ctype in charge_patterns:
            # Sólo filas contables del resumen, no textos institucionales sobre tasas.
            if up.startswith(strip_accents(label).upper()):
                amount = last_money(line)
                if amount is not None and amount > 0:
                    charges.append({"date": closing, "merchant": label.title(), "amount": amount, "kind":"charge", "chargeType":ctype, "raw":clean_spaces(line)})
                break

    return {
        "issuer":"Banco Provincia", "brand":"Mastercard", "holderName":holder, "cardLast4":card_last4,
        "closingDate":closing, "dueDate":due, "previousClosingDate":prev_close, "previousDueDate":prev_due,
        "nextClosingDate":next_close, "nextDueDate":next_due,
        "purchaseLimit":purchase_limit, "financingLimit":None,
        "statementBalance":balance, "minimumPayment":min_payment, "totalPurchases":total_purchases,
        "purchases":purchases, "charges":charges, "futureInstallments":future_installments(text),
    }

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"ok":False,"error":"Falta archivo PDF"}, ensure_ascii=False)); return
    path = Path(sys.argv[1])
    original_name = sys.argv[2] if len(sys.argv) > 2 else path.name
    try:
        reader = PdfReader(str(path))
        text = '\n'.join((page.extract_text() or '') for page in reader.pages)
    except Exception as exc:
        print(json.dumps({"ok":False,"error":f"No se pudo leer el PDF: {exc}"}, ensure_ascii=False)); return
    upper = strip_accents(text).upper()
    try:
        if 'MASTERCARD' in upper:
            data = parse_mastercard(text, original_name)
        elif 'VISA' in upper or re.search(r'Tarjeta\s+\d{4}\s+Total Consumos', text, re.I):
            data = parse_visa(text, original_name)
        else:
            print(json.dumps({"ok":False,"error":"Formato todavía no reconocido. v2.0 reconoce inicialmente Visa y Mastercard de Banco Provincia.", "textPreview": clean_spaces(text[:1200])}, ensure_ascii=False)); return
        data['filename'] = original_name
        data['pageCount'] = len(reader.pages)
        data['textLength'] = len(text)
        data['rawTextPreview'] = clean_spaces(text[:1600])
        print(json.dumps({"ok":True,"data":data}, ensure_ascii=False))
    except Exception as exc:
        print(json.dumps({"ok":False,"error":f"El PDF se leyó pero no se pudo interpretar: {exc}"}, ensure_ascii=False)); return

if __name__ == '__main__':
    main()
