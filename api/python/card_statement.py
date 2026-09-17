from __future__ import annotations

import base64
import io
import json
import os
from http.server import BaseHTTPRequestHandler

from pypdf import PdfReader
from tools.extract_card_statement import (
    clean_spaces,
    parse_mastercard,
    parse_visa,
    strip_accents,
)


def _json(handler: BaseHTTPRequestHandler, status: int, payload: dict):
    raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(raw)))
    handler.end_headers()
    handler.wfile.write(raw)


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        expected = os.environ.get("ECO_PARSER_INTERNAL_SECRET", "")
        supplied = self.headers.get("x-eco-parser-secret", "")
        if not expected or supplied != expected:
            _json(self, 401, {"ok": False, "error": "Acceso no autorizado al lector PDF."})
            return

        try:
            length = int(self.headers.get("content-length", "0"))
            if length <= 0 or length > 4_400_000:
                _json(self, 413, {"ok": False, "error": "El archivo supera el tamaño permitido por el lector en la nube."})
                return

            body = json.loads(self.rfile.read(length).decode("utf-8"))
            filename = str(body.get("filename") or "resumen.pdf")
            encoded = body.get("data")
            if not isinstance(encoded, str) or not encoded:
                _json(self, 400, {"ok": False, "error": "Falta el contenido del PDF."})
                return

            pdf_bytes = base64.b64decode(encoded, validate=True)
            reader = PdfReader(io.BytesIO(pdf_bytes))
            text = "\n".join((page.extract_text() or "") for page in reader.pages)
            upper = strip_accents(text).upper()

            if "MASTERCARD" in upper:
                data = parse_mastercard(text, filename)
            elif "VISA" in upper or "TOTAL CONSUMOS" in upper:
                data = parse_visa(text, filename)
            else:
                _json(
                    self,
                    422,
                    {
                        "ok": False,
                        "error": "Formato todavía no reconocido. ECO HOGAR reconoce inicialmente Visa y Mastercard de Banco Provincia.",
                        "textPreview": clean_spaces(text[:1200]),
                    },
                )
                return

            data["filename"] = filename
            data["pageCount"] = len(reader.pages)
            data["textLength"] = len(text)
            data["rawTextPreview"] = clean_spaces(text[:1600])
            _json(self, 200, {"ok": True, "data": data})
        except Exception as exc:
            _json(self, 500, {"ok": False, "error": f"No se pudo interpretar el resumen en la nube: {exc}"})
