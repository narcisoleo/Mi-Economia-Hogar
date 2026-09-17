from __future__ import annotations
import json, sys
from pathlib import Path

BASE = Path(__file__).resolve().parent
VENDOR = BASE / "vendor"
if str(VENDOR) not in sys.path:
    sys.path.insert(0, str(VENDOR))

try:
    from pypdf import PdfReader
except Exception as exc:
    print(json.dumps({"ok": False, "error": f"No se pudo cargar el lector PDF: {exc}"}, ensure_ascii=False))
    raise SystemExit(0)


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "Falta el PDF."}, ensure_ascii=False))
        return

    pdf_path = Path(sys.argv[1])
    try:
        reader = PdfReader(str(pdf_path))
        pages = []
        for page in reader.pages:
            pages.append(page.extract_text() or "")
        text = "\n".join(pages).strip()
        print(json.dumps({
            "ok": True,
            "text": text,
            "pageCount": len(reader.pages),
            "textLength": len(text),
        }, ensure_ascii=False))
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
