// A payment receipt as a standalone printable document.
//
// Printing the on-screen dialog never worked: the receipt lives inside a fixed
// overlay in an app whose root is height-constrained, so hiding the rest of the
// page by visibility left the printer with an empty sheet. A receipt is also a
// document an operator may hand to a bookkeeper, and it should look like one
// rather than like a screenshot of a dialog.
//
// So the receipt is built here as its own HTML document — its own page size,
// margins, fonts and colours, independent of the app's stylesheet — and handed
// to a print window (desktop) or an iframe (website).
//
// Only system fonts are used. A hidden print window may have no network, and a
// webfont that fails to load silently changes the whole document.

const BRAND = "#0c66e4";
const NAVY = "#0b1220";
const BODY = "#4b5563";
const MUTED = "#8b92a6";
const LINE = "#e2e5eb";

// Receipt fields pass through payment providers before they reach us, so every
// one of them is escaped rather than trusted.
function esc(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatReceiptMoney(centavos, currency) {
  if (centavos === null || centavos === undefined) return "—";
  const amount = centavos / 100;
  try {
    return new Intl.NumberFormat("en-PH", { style: "currency", currency: currency || "PHP" }).format(amount);
  } catch {
    return `${currency || "PHP"} ${amount.toFixed(2)}`;
  }
}

export function formatReceiptDate(iso, withTime = false) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const date = d.toLocaleDateString("en-PH", { day: "numeric", month: "long", year: "numeric" });
  return withTime ? `${date}, ${d.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}` : date;
}

/**
 * @param {object}  receipt     a row from subscription_payments
 * @param {string}  billedTo    the operator's email
 * @param {string}  billedName  the operator's name or company, optional
 * @param {string}  logoDataUrl the logo inlined; omitted falls back to a wordmark
 */
export function buildReceiptHtml({ receipt, billedTo, billedName, logoDataUrl }) {
  const total = formatReceiptMoney(receipt.amount_centavos, receipt.currency);
  const period = receipt.period_end
    ? `${formatReceiptDate(receipt.period_start)} – ${formatReceiptDate(receipt.period_end)}`
    : "—";

  const brandMark = logoDataUrl
    ? `<img src="${esc(logoDataUrl)}" alt="Studio Photuna" class="logo" />`
    : `<div class="wordmark">Studio Photuna</div>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Receipt ${esc(receipt.receipt_number)} — Studio Photuna</title>
<style>
  @page { size: A4; margin: 16mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: "Segoe UI", -apple-system, BlinkMacSystemFont, Roboto, Helvetica, Arial, sans-serif;
    color: ${BODY};
    font-size: 12px;
    line-height: 1.5;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .sheet { max-width: 190mm; margin: 0 auto; padding: 8mm 0; }

  /* A single brand rule across the top rather than a filled banner: it survives
     a black-and-white printer and does not drink ink. */
  .rule { height: 4px; background: ${BRAND}; border-radius: 2px; }

  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; margin-top: 18px; }
  .logo { height: 38px; width: auto; display: block; }
  .wordmark { font-size: 20px; font-weight: 800; color: ${NAVY}; letter-spacing: -0.2px; }
  .seller { margin-top: 10px; font-size: 11px; color: ${MUTED}; line-height: 1.6; }
  .seller strong { display: block; color: ${NAVY}; font-size: 12px; font-weight: 700; }

  .docmeta { text-align: right; flex-shrink: 0; }
  .doctype { font-size: 10px; font-weight: 800; letter-spacing: 1.6px; text-transform: uppercase; color: ${MUTED}; }
  .docno { font-size: 22px; font-weight: 800; color: ${NAVY}; margin-top: 2px; letter-spacing: -0.3px; }
  .paid {
    display: inline-block; margin-top: 8px; padding: 4px 12px; border-radius: 999px;
    background: #e8f7ee; color: #16794a; font-size: 10px; font-weight: 800;
    letter-spacing: 1.2px; text-transform: uppercase;
  }

  .panels {
    display: flex; gap: 28px; margin-top: 26px;
    background: #f7f8fa; border: 1px solid #eef0f4; border-radius: 10px;
    padding: 16px 20px;
  }
  .panel { flex: 1; }
  .label { font-size: 9px; font-weight: 800; letter-spacing: 1.4px; text-transform: uppercase; color: ${MUTED}; }
  .value { margin-top: 5px; font-size: 12px; color: ${NAVY}; }
  .value strong { font-weight: 700; }

  table { width: 100%; border-collapse: collapse; margin-top: 26px; }
  thead th {
    text-align: left; font-size: 9px; font-weight: 800; letter-spacing: 1.4px;
    text-transform: uppercase; color: ${MUTED};
    border-bottom: 1px solid ${LINE}; padding: 0 0 8px;
  }
  thead th.right, tbody td.right { text-align: right; }
  tbody td { padding: 14px 0; border-bottom: 1px solid ${LINE}; vertical-align: top; color: ${NAVY}; }
  tbody td .sub { display: block; color: ${MUTED}; font-size: 11px; margin-top: 2px; }
  .amount { font-variant-numeric: tabular-nums; white-space: nowrap; }

  .totals { margin-top: 18px; display: flex; justify-content: flex-end; }
  .totals .box {
    width: 280px; background: #f3f7fe; border: 1px solid #dbe7fb;
    border-radius: 10px; padding: 14px 18px;
    display: flex; align-items: baseline; justify-content: space-between; gap: 16px;
  }
  .totals .k { font-size: 10px; font-weight: 800; letter-spacing: 1.2px; text-transform: uppercase; color: ${BRAND}; }
  .totals .v { font-size: 21px; font-weight: 800; color: ${NAVY}; }

  .note {
    margin-top: 32px; padding-top: 14px; border-top: 1px solid ${LINE};
    font-size: 10px; color: ${MUTED}; line-height: 1.6;
  }
  .note strong { color: ${BODY}; }
  .footrule { height: 3px; background: ${BRAND}; border-radius: 2px; margin-top: 22px; opacity: 0.85; }
</style>
</head>
<body>
  <div class="sheet">
    <div class="rule"></div>

    <div class="head">
      <div>
        ${brandMark}
        <div class="seller">
          <strong>Studio Photuna</strong>
          studiophotuna.com<br />
          support@studiophotuna.com
        </div>
      </div>
      <div class="docmeta">
        <div class="doctype">Payment receipt</div>
        <div class="docno">${esc(receipt.receipt_number)}</div>
        <div class="paid">Paid</div>
      </div>
    </div>

    <div class="panels">
      <div class="panel">
        <div class="label">Billed to</div>
        <div class="value">
          ${billedName ? `<strong>${esc(billedName)}</strong><br />` : ""}
          ${esc(billedTo || "—")}
        </div>
      </div>
      <div class="panel">
        <div class="label">Date paid</div>
        <div class="value">${esc(formatReceiptDate(receipt.paid_at, true))}</div>
      </div>
      <div class="panel">
        <div class="label">Paid with</div>
        <div class="value">${esc(receipt.method || receipt.provider || "—")}</div>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Description</th>
          <th>Period covered</th>
          <th class="right">Amount</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <strong>${esc(receipt.description || "Photuna subscription")}</strong>
            <span class="sub">Subscription</span>
          </td>
          <td>${esc(period)}</td>
          <td class="right amount">${esc(total)}</td>
        </tr>
      </tbody>
    </table>

    <div class="totals">
      <div class="box">
        <span class="k">Total paid</span>
        <span class="v amount">${esc(total)}</span>
      </div>
    </div>

    <div class="note">
      <strong>Reference:</strong> ${esc(receipt.reference || "—")}<br />
      This is a payment receipt for your records. It is not a BIR Official Receipt.<br />
      Questions about this payment? Email support@studiophotuna.com and quote ${esc(receipt.receipt_number)}.
    </div>
    <div class="footrule"></div>
  </div>
</body>
</html>`;
}

// The logo has to travel inside the document: a print window has no app origin
// to resolve /logo-dark.png against, and may have no network at all.
export async function loadLogoDataUrl() {
  try {
    const url = `${process.env.PUBLIC_URL || ""}/logo-dark.png`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}
