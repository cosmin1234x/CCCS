// Paper output for the waste counter: an A4 PDF built without any library
// (Helvetica, two columns RAW/FULL, notes on the last page) plus the data
// used by the printable sheet. Ported from the standalone Hayle Waste Counter.

export function formatSheetDate(date) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function dateForFilename(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

export function pdfSafeText(value) {
  return String(value)
    .replace(/[–—−]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/·/g, "-")
    .replace(/…/g, "...")
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "");
}

export function pdfEscape(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

export function wrapPdfText(value, maxChars = 86) {
  const words = pdfSafeText(value).split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  words.forEach((word) => {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  });
  if (current) lines.push(current);
  return lines;
}

export function chunkArray(values, size) {
  if (!Array.isArray(values) || values.length === 0) return [[]];
  const chunks = [];
  for (let i = 0; i < values.length; i += size) chunks.push(values.slice(i, i + size));
  return chunks;
}

// Normalises a saved sheet (or the current count) for paper output.
export function paperData(sheet) {
  const entries = (Array.isArray(sheet?.entries) ? sheet.entries : [])
    .filter((e) => e && Number(e.count) > 0)
    .map((e) => ({ ...e, count: Math.floor(Number(e.count)) }));
  const raw = entries.filter((e) => e.type === "raw");
  const full = entries.filter((e) => e.type === "full");
  const rawTotal = raw.reduce((n, e) => n + e.count, 0);
  const fullTotal = full.reduce((n, e) => n + e.count, 0);
  const created = new Date(sheet?.createdAt || Date.now());
  return {
    entries,
    raw,
    full,
    rawTotal,
    fullTotal,
    total: rawTotal + fullTotal,
    label: String(sheet?.label || "").trim() || "Hayle Waste",
    notes: String(sheet?.notes || "").trim(),
    date: Number.isFinite(created.getTime()) ? created : new Date(),
  };
}

export function buildPdfPages(data) {
  // Match the A4 paper layout. A4 in PDF points: 595 x 842, 40 pt margins.
  const PAGE_W = 595;
  const MARGIN = 40;
  const CONTENT_RIGHT = PAGE_W - MARGIN;
  const COLUMN_GAP = 31;
  const COLUMN_W = (PAGE_W - MARGIN * 2 - COLUMN_GAP) / 2;
  const LEFT_X = MARGIN;
  const RIGHT_X = LEFT_X + COLUMN_W + COLUMN_GAP;
  const CATEGORY_TOP = 690;
  const CATEGORY_HEAD_H = 31;
  const ROW_H = 26;
  const MAX_ROWS_PER_PAGE = 20;

  const safe = (value) => pdfSafeText(String(value ?? ""));
  const pages = [];
  const rawChunks = chunkArray(data.raw || [], MAX_ROWS_PER_PAGE);
  const fullChunks = chunkArray(data.full || [], MAX_ROWS_PER_PAGE);
  const pageCount = Math.max(rawChunks.length, fullChunks.length, 1);

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
    const commands = [];
    const text = (value, x, y, size = 10, bold = false) => {
      commands.push(`BT /${bold ? "F2" : "F1"} ${size} Tf ${x.toFixed(1)} ${y.toFixed(1)} Td (${pdfEscape(safe(value))}) Tj ET`);
    };
    const line = (x1, y1, x2, y2, width = 0.7, gray = 0) => {
      commands.push(`q ${gray} G ${width} w ${x1.toFixed(1)} ${y1.toFixed(1)} m ${x2.toFixed(1)} ${y2.toFixed(1)} l S Q`);
    };
    const strokeRect = (x, y, w, h, width = 1, gray = 0) => {
      commands.push(`q ${gray} G ${width} w ${x.toFixed(1)} ${y.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)} re S Q`);
    };
    const fillRect = (x, y, w, h, gray = 0.95) => {
      commands.push(`q ${gray} g ${x.toFixed(1)} ${y.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)} re f Q`);
    };

    text("HAYLE - WASTE RECORD", MARGIN, 798, 8.5, true);
    text("Waste Sheet", MARGIN, 765, 24, true);
    text(`${safe(data.label || "Hayle Waste")} - ${formatSheetDate(data.date)}`, MARGIN, 744, 9.5, false);

    const totalBoxW = 108;
    const totalBoxH = 52;
    const totalBoxX = CONTENT_RIGHT - totalBoxW;
    const totalBoxY = 754;
    strokeRect(totalBoxX, totalBoxY, totalBoxW, totalBoxH, 1.5, 0);
    text("TOTAL WASTE", totalBoxX + 21, totalBoxY + 35, 7.5, true);
    const totalString = String(data.total ?? 0);
    const totalOffset = Math.max(0, (totalString.length - 1) * 5.5);
    text(totalString, totalBoxX + 48 - totalOffset, totalBoxY + 11, 22, true);

    line(MARGIN, 728, CONTENT_RIGHT, 728, 2, 0);
    if (pageCount > 1) text(`Page ${pageIndex + 1} of ${pageCount}`, CONTENT_RIGHT - 72, 714, 7.5, false);

    const drawCategory = (x, title, total, entries) => {
      const headY = CATEGORY_TOP - CATEGORY_HEAD_H;
      fillRect(x, headY, COLUMN_W, CATEGORY_HEAD_H, 0.95);
      strokeRect(x, headY, COLUMN_W, CATEGORY_HEAD_H, 1.5, 0);
      text(title, x + 9, headY + 9, 14, true);
      const totalText = String(total ?? 0);
      text(totalText, x + COLUMN_W - 16 - totalText.length * 7.1, headY + 9, 13, true);

      let rowTop = headY;
      if (!entries.length) {
        const rowBottom = rowTop - 33;
        line(x, rowTop, x, rowBottom, 0.7, 0.62);
        line(x + COLUMN_W, rowTop, x + COLUMN_W, rowBottom, 0.7, 0.62);
        line(x, rowBottom, x + COLUMN_W, rowBottom, 0.7, 0.62);
        text(pageCount > 1 ? "No more waste recorded" : "No waste recorded", x + 8, rowBottom + 11, 9.5, false);
        return rowBottom;
      }
      entries.forEach((entry) => {
        const rowBottom = rowTop - ROW_H;
        line(x, rowTop, x, rowBottom, 0.6, 0.62);
        line(x + COLUMN_W, rowTop, x + COLUMN_W, rowBottom, 0.6, 0.62);
        line(x, rowBottom, x + COLUMN_W, rowBottom, 0.6, 0.62);
        const itemName = `${safe(entry.name)} -`;
        const fontSize = itemName.length > 39 ? 8.5 : itemName.length > 33 ? 9.2 : 10.2;
        text(itemName, x + 8, rowBottom + 8, fontSize, false);
        const countText = String(entry.count ?? 0);
        text(countText, x + COLUMN_W - 9 - countText.length * 6.2, rowBottom + 8, 10.5, true);
        rowTop = rowBottom;
      });
      return rowTop;
    };

    const rawBottom = drawCategory(LEFT_X, "RAW", data.rawTotal, rawChunks[pageIndex] || []);
    const fullBottom = drawCategory(RIGHT_X, "FULL", data.fullTotal, fullChunks[pageIndex] || []);

    if (pageIndex === pageCount - 1 && String(data.notes || "").trim()) {
      const noteLines = wrapPdfText(data.notes, 104).slice(0, 6);
      const notesH = 31 + noteLines.length * 13;
      const desiredTop = Math.min(rawBottom, fullBottom) - 31;
      let notesBottom = desiredTop - notesH;
      if (notesBottom < MARGIN) notesBottom = MARGIN;
      const notesTop = notesBottom + notesH;
      strokeRect(MARGIN, notesBottom, PAGE_W - MARGIN * 2, notesH, 0.8, 0.55);
      text("NOTES", MARGIN + 9, notesTop - 17, 8.5, true);
      let noteY = notesTop - 32;
      noteLines.forEach((note) => {
        text(note, MARGIN + 9, noteY, 9.2, false);
        noteY -= 13;
      });
    }
    pages.push(commands.join("\n"));
  }
  return pages;
}

const encoder = new TextEncoder();
const byteLength = (value) => encoder.encode(value).length;

export function makeSimplePDF(pageStreams) {
  const objects = [];
  const addObject = (body) => {
    objects.push(body);
    return objects.length;
  };
  const fontRegular = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const fontBold = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
  const pagesId = addObject("PAGES_PLACEHOLDER");
  const pageIds = [];
  pageStreams.forEach((stream) => {
    const streamId = addObject(`<< /Length ${byteLength(stream)} >>\nstream\n${stream}\nendstream`);
    const pageId = addObject(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >> >> /Contents ${streamId} 0 R >>`,
    );
    pageIds.push(pageId);
  });
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  const catalogId = addObject(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

  let pdf = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets = [0];
  objects.forEach((obj, i) => {
    offsets.push(byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefOffset = byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i <= objects.length; i++) pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return encoder.encode(pdf);
}

// Returns { bytes, filename, data } or null when nothing was counted.
export function createPaperPdf(sheet) {
  const data = paperData(sheet);
  if (!data.entries.length) return null;
  const bytes = makeSimplePDF(buildPdfPages(data));
  return { bytes, filename: `hayle-waste-paper-${dateForFilename(data.date)}.pdf`, data };
}
