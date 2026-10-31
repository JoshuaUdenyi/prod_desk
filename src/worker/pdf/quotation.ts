/**
 * Client-facing quotation PDF.
 *
 * Hard rule (PRD §7): nothing internal reaches this document. No supplier
 * rates, no cost lines, no overhead, no margin, no profit. The only numbers
 * here are the prices the client is being asked to pay.
 *
 * Fonts: pdf-lib's standard fonts use WinAnsi encoding, which has no naira
 * glyph, so amounts are printed as "NGN 1,350,000.00". That is unambiguous and
 * avoids shipping a Unicode font into the Worker bundle.
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 48;
const CONTENT_WIDTH = A4.width - MARGIN * 2;

const INK = rgb(0.09, 0.1, 0.12);
const MUTED = rgb(0.42, 0.45, 0.5);
const RULE = rgb(0.87, 0.88, 0.9);
const ACCENT = rgb(0.05, 0.35, 0.42);

export interface QuotationPdfItem {
  description: string;
  quantityMilli: number;
  unitLabel: string;
  unitRateKobo: number;
  totalKobo: number;
}

export interface QuotationPdfInput {
  company: {
    name: string;
    email: string;
    phone: string;
    address: string;
    bankDetails: string;
    paymentTerms: string;
  };
  client: { name: string; contact: string; email: string };
  project: {
    name: string;
    reference: string;
    description: string;
    eventDate: string | null;
    location: string;
    productionDays: number;
  };
  quotation: {
    reference: string;
    issuedOn: string;
    validUntil: string | null;
    layout: 'detailed' | 'package';
  };
  items: QuotationPdfItem[];
  subtotalKobo: number;
  vatRateBp: number;
  vatKobo: number;
  totalKobo: number;
  depositPercentBp: number;
  clientNotes: string;
  logo?: { bytes: Uint8Array; type: 'png' | 'jpg' } | null;
}

/** WinAnsi-safe text: replace glyphs the standard fonts cannot encode. */
function safeText(value: string): string {
  const normalised = value
    .replace(/₦/g, 'NGN ')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/ /g, ' ');

  return [...normalised]
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code === 10 || (code >= 32 && code <= 255);
    })
    .join('');
}

function money(kobo: number): string {
  const negative = kobo < 0;
  const absolute = Math.abs(kobo);
  const naira = Math.trunc(absolute / 100);
  const minor = String(absolute % 100).padStart(2, '0');
  return `${negative ? '-' : ''}NGN ${new Intl.NumberFormat('en-NG').format(naira)}.${minor}`;
}

function quantity(quantityMilli: number): string {
  const whole = Math.trunc(quantityMilli / 1000);
  const fraction = String(quantityMilli % 1000).padStart(3, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
}

function percent(basisPoints: number): string {
  const value = (basisPoints / 100).toFixed(2);
  return `${value.replace(/\.?0+$/, '')}%`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

interface TextOptions {
  size?: number;
  font?: PDFFont;
  color?: typeof INK;
  align?: 'left' | 'right';
  x?: number;
  maxWidth?: number;
}

/**
 * The regular face, set once per document at the top of `buildQuotationPdf`.
 * Callers pass `font` only when they want the bold face; everything else falls
 * back to this one. A module-level binding is safe because a PDF is laid out
 * top to bottom in a single synchronous pass and the page order is serial.
 */
let bodyFont: PDFFont | null = null;

function drawText(page: PDFPage, text: string, x: number, y: number, options: TextOptions = {}) {
  const size = options.size ?? 10;
  const font = options.font ?? bodyFont;
  if (!font) throw new Error('buildQuotationPdf must set the body font before drawing');
  const content = safeText(text);

  let positionX = x;
  if (options.align === 'right') {
    const width = font.widthOfTextAtSize(content, size);
    positionX = x - width;
  }

  page.drawText(content, {
    x: positionX,
    y,
    size,
    font,
    color: options.color ?? INK,
  });
}

/** Break a string into lines that fit `maxWidth`. */
function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = safeText(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

export async function buildQuotationPdf(input: QuotationPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Quotation ${input.quotation.reference}`);
  doc.setAuthor(safeText(input.company.name || 'ProductionDesk'));
  doc.setCreator('ProductionDesk');

  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([A4.width, A4.height]);

  bodyFont = regular;

  let y = A4.height - MARGIN;

  // -------------------------------------------------------------------------
  // Header
  // -------------------------------------------------------------------------

  let headerX = MARGIN;

  if (input.logo) {
    try {
      const image =
        input.logo.type === 'png'
          ? await doc.embedPng(input.logo.bytes)
          : await doc.embedJpg(input.logo.bytes);

      const scale = Math.min(110 / image.width, 46 / image.height, 1);
      const width = image.width * scale;
      const height = image.height * scale;

      page.drawImage(image, { x: MARGIN, y: y - height + 10, width, height });
      headerX = MARGIN + width + 16;
    } catch {
      // An unreadable logo must not stop a quotation being issued.
    }
  }

  drawText(page, input.company.name || 'ProductionDesk', headerX, y - 4, { size: 18, font: bold });
  y -= 22;

  const contactLines = [input.company.address, input.company.phone, input.company.email]
    .filter(Boolean)
    .join('  ·  ');
  if (contactLines) {
    drawText(page, contactLines, headerX, y, { size: 8.5, color: MUTED });
    y -= 12;
  }

  y = Math.min(y, A4.height - MARGIN - 52);
  y -= 10;

  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: A4.width - MARGIN, y },
    thickness: 1.5,
    color: ACCENT,
  });
  y -= 28;

  // -------------------------------------------------------------------------
  // Title and references
  // -------------------------------------------------------------------------

  drawText(page, 'QUOTATION', MARGIN, y, { size: 16, font: bold, color: ACCENT });

  drawText(page, 'Reference', A4.width - MARGIN, y + 12, {
    size: 8,
    color: MUTED,
    align: 'right',
  });
  drawText(page, input.quotation.reference, A4.width - MARGIN, y, {
    size: 10,
    font: bold,
    align: 'right',
  });
  drawText(page, `Issued ${formatDate(input.quotation.issuedOn)}`, A4.width - MARGIN, y - 14, {
    size: 8.5,
    color: MUTED,
    align: 'right',
  });
  if (input.quotation.validUntil) {
    drawText(page, `Valid until ${formatDate(input.quotation.validUntil)}`, A4.width - MARGIN, y - 25, {
      size: 8.5,
      color: MUTED,
      align: 'right',
    });
  }

  y -= 34;

  // -------------------------------------------------------------------------
  // Client and event details
  // -------------------------------------------------------------------------

  const leftColumn = CONTENT_WIDTH / 2 - 8;

  drawText(page, 'PREPARED FOR', MARGIN, y, { size: 7.5, color: MUTED, font: bold });
  drawText(page, 'PRODUCTION', MARGIN + CONTENT_WIDTH / 2 + 8, y, {
    size: 7.5,
    color: MUTED,
    font: bold,
  });
  y -= 14;

  const clientLines = [input.client.name, input.client.contact, input.client.email].filter(Boolean);
  let clientY = y;
  for (const line of clientLines.flatMap((value) => wrap(value, regular, 9.5, leftColumn))) {
    drawText(page, line, MARGIN, clientY, { size: 9.5 });
    clientY -= 12;
  }

  const projectLines = [
    input.project.name,
    input.project.eventDate
      ? `Event date: ${formatDate(input.project.eventDate)}`
      : 'Event date: to be confirmed',
    input.project.location ? `Location: ${input.project.location}` : '',
    `${input.project.productionDays} production day${input.project.productionDays === 1 ? '' : 's'}`,
  ].filter(Boolean);

  let projectY = y;
  for (const line of projectLines.flatMap((value) => wrap(value, regular, 9.5, leftColumn))) {
    drawText(page, line, MARGIN + CONTENT_WIDTH / 2 + 8, projectY, { size: 9.5 });
    projectY -= 12;
  }

  y = Math.min(clientY, projectY) - 10;

  if (input.project.description) {
    for (const line of wrap(input.project.description, regular, 9.5, CONTENT_WIDTH)) {
      drawText(page, line, MARGIN, y, { size: 9.5, color: MUTED });
      y -= 12;
    }
  }

  y -= 12;

  // -------------------------------------------------------------------------
  // Items table
  // -------------------------------------------------------------------------

  const columns = {
    description: MARGIN,
    quantity: MARGIN + CONTENT_WIDTH - 250,
    rate: MARGIN + CONTENT_WIDTH - 140,
    amount: MARGIN + CONTENT_WIDTH,
  };

  drawText(page, 'Description', columns.description, y, { size: 8, color: MUTED, font: bold });
  if (input.quotation.layout === 'detailed') {
    drawText(page, 'Qty', columns.quantity, y, { size: 8, color: MUTED, font: bold });
    drawText(page, 'Unit price', columns.rate, y, { size: 8, color: MUTED, font: bold });
  }
  drawText(page, 'Amount', columns.amount, y, {
    size: 8,
    color: MUTED,
    font: bold,
    align: 'right',
  });

  y -= 6;
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: A4.width - MARGIN, y },
    thickness: 0.75,
    color: RULE,
  });
  y -= 16;

  const descriptionWidth = input.quotation.layout === 'detailed' ? 250 : 380;

  for (const item of input.items) {
    const lines = wrap(item.description, regular, 9.5, descriptionWidth);

    drawText(page, lines[0] ?? '', columns.description, y, { size: 9.5 });
    if (input.quotation.layout === 'detailed') {
      drawText(
        page,
        `${quantity(item.quantityMilli)} ${item.unitLabel}`.trim(),
        columns.quantity,
        y,
        { size: 9 },
      );
      drawText(page, money(item.unitRateKobo), columns.rate, y, { size: 9 });
    }
    drawText(page, money(item.totalKobo), columns.amount, y, { size: 9.5, align: 'right' });

    y -= 13;
    for (const line of lines.slice(1)) {
      drawText(page, line, columns.description, y, { size: 9.5 });
      y -= 13;
    }
    y -= 5;
  }

  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: A4.width - MARGIN, y },
    thickness: 0.75,
    color: RULE,
  });
  y -= 20;

  // -------------------------------------------------------------------------
  // Totals
  // -------------------------------------------------------------------------

  const totalsLabelX = A4.width - MARGIN - 150;

  drawText(page, 'Subtotal', totalsLabelX, y, { size: 9.5, color: MUTED });
  drawText(page, money(input.subtotalKobo), columns.amount, y, { size: 9.5, align: 'right' });
  y -= 15;

  drawText(page, `VAT (${percent(input.vatRateBp)})`, totalsLabelX, y, { size: 9.5, color: MUTED });
  drawText(page, money(input.vatKobo), columns.amount, y, { size: 9.5, align: 'right' });
  y -= 10;

  page.drawLine({
    start: { x: totalsLabelX, y },
    end: { x: A4.width - MARGIN, y },
    thickness: 0.75,
    color: RULE,
  });
  y -= 18;

  drawText(page, 'Total payable   ', totalsLabelX, y, { size: 11, font: bold });
  drawText(page, money(input.totalKobo), columns.amount, y, {
    size: 11,
    font: bold,
    align: 'right',
  });
  y -= 30;

  // -------------------------------------------------------------------------
  // Terms
  // -------------------------------------------------------------------------

  const depositKobo = Math.round((input.totalKobo * input.depositPercentBp) / 10_000);
  const balanceKobo = input.totalKobo - depositKobo;

  const termLines = [
    `Payment terms: ${percent(input.depositPercentBp)} deposit (${money(depositKobo)}) on acceptance, balance of ${money(balanceKobo)} before the event.`,
  ];
  if (input.company.paymentTerms) termLines.push(input.company.paymentTerms);

  for (const term of termLines) {
    for (const line of wrap(term, regular, 8.5, CONTENT_WIDTH)) {
      if (y < MARGIN + 120) break;
      drawText(page, line, MARGIN, y, { size: 8.5, color: MUTED });
      y -= 11;
    }
    y -= 3;
  }

  if (input.company.bankDetails) {
    y -= 4;
    drawText(page, 'BANK DETAILS', MARGIN, y, { size: 7.5, font: bold, color: MUTED });
    y -= 12;
    for (const line of input.company.bankDetails.split('\n')) {
      for (const wrapped of wrap(line, regular, 8.5, CONTENT_WIDTH)) {
        if (y < MARGIN + 90) break;
        drawText(page, wrapped, MARGIN, y, { size: 8.5 });
        y -= 11;
      }
    }
  }

  if (input.clientNotes) {
    y -= 8;
    drawText(page, 'NOTES', MARGIN, y, { size: 7.5, font: bold, color: MUTED });
    y -= 12;
    for (const line of wrap(input.clientNotes, regular, 8.5, CONTENT_WIDTH)) {
      if (y < MARGIN + 70) break;
      drawText(page, line, MARGIN, y, { size: 8.5 });
      y -= 11;
    }
  }

  // Footer
  page.drawLine({
    start: { x: MARGIN, y: MARGIN + 34 },
    end: { x: A4.width - MARGIN, y: MARGIN + 34 },
    thickness: 0.5,
    color: RULE,
  });
  drawText(
    page,
    input.quotation.validUntil
      ? `This quotation is valid until ${formatDate(input.quotation.validUntil)}. Prices are in Nigerian Naira.`
      : 'Prices are in Nigerian Naira.',
    MARGIN,
    MARGIN + 20,
    { size: 7.5, color: MUTED },
  );
  drawText(page, 'Thank you for your business.', A4.width - MARGIN, MARGIN + 20, {
    size: 7.5,
    color: MUTED,
    align: 'right',
  });

  return doc.save();
}
