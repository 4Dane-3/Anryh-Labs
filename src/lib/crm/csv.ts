// A small RFC 4180 CSV parser for the clients import: quoted fields, "" escapes, commas and newlines
// inside quotes, CRLF or LF line ends, a leading BOM, and ; or tab delimiters (Excel in some locales).
// Pure, so the browser parses the file and only the mapped rows go to the server.

export function detectDelimiter(text: string): string {
  const firstLine = text.slice(0, text.search(/\r?\n/) === -1 ? undefined : text.search(/\r?\n/));
  const counts = [",", ";", "\t"].map((d) => [d, firstLine.split(d).length - 1] as const);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ",";
}

export function parseCsv(input: string, delimiter = detectDelimiter(input)): string[][] {
  const text = input.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"' && field === "") {
      quoted = true;
      i++;
    } else if (c === delimiter) {
      row.push(field);
      field = "";
      i++;
    } else if (c === "\r" || c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += c === "\r" && text[i + 1] === "\n" ? 2 : 1;
    } else {
      field += c;
      i++;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  // Drop blank lines (a trailing newline, or empty rows Excel leaves)
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

/** Guesses which field a CSV header means, e.g. "E-mail Address" → email. */
export function guessField(header: string): "name" | "first" | "last" | "email" | "phone" | "company" | "status" | "note" | null {
  const h = header.toLowerCase().replace(/[^a-z]/g, "");
  if (/^(fullname|name|clientname|contactname|contact)$/.test(h)) return "name";
  if (/^(first|firstname|givenname|fname)$/.test(h)) return "first";
  if (/^(last|lastname|surname|familyname|lname)$/.test(h)) return "last";
  if (h.includes("email")) return "email";
  if (/(phone|mobile|cell|tel)/.test(h)) return "phone";
  if (/(company|business|organization|organisation|agency|employer)/.test(h)) return "company";
  if (/^(status|stage)$/.test(h)) return "status";
  if (/(note|comment)/.test(h)) return "note";
  return null;
}

export const phoneDigits = (p: string) => p.replace(/\D/g, "");
