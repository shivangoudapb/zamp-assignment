"""Generate the demo invoice PDFs into public/samples/.

Each vendor gets a deliberately different layout so extraction can't rely on a template:
  happy-acme.pdf        clean text PDF, explicit PO, 0.8% over PO (freight)  -> APPROVE
  split-globex.pdf      second invoice against a PO that is 60% consumed   -> HOLD
  duplicate-initech.pdf re-send of INV-0457 numbered "INV0457"             -> REJECT
  scanned-northwind.pdf image-only scan, no PO number printed              -> HOLD (PO inferred)
  fraud-stark.pdf       vendor-name variant + changed bank details         -> HOLD (fraud check)

Run:  python scripts/make_invoices.py
"""
import os
import random

from PIL import Image, ImageDraw, ImageFilter, ImageFont
from reportlab.lib import colors
from reportlab.lib.pagesizes import LETTER
from reportlab.pdfgen import canvas

OUT = os.path.join(os.path.dirname(__file__), "..", "public", "samples")
os.makedirs(OUT, exist_ok=True)
W, H = LETTER


def money(x):
    return f"${x:,.2f}"


def line_table(c, x, y, items, col_x, header_fill, font="Helvetica", size=9.5):
    """Draw an itemised table. col_x = x positions for [desc, qty, unit, amount]."""
    c.setFillColor(header_fill)
    c.rect(x, y - 4, col_x[3] + 70 - x, 18, stroke=0, fill=1)
    c.setFillColor(colors.white if header_fill != colors.white else colors.black)
    c.setFont(font + "-Bold", size)
    for label, cx in zip(["Description", "Qty", "Unit price", "Amount"], col_x):
        c.drawString(cx, y + 1, label)
    c.setFillColor(colors.black)
    c.setFont("Times-Roman" if font == "Times" else font, size)
    y -= 20
    for desc, qty, unit in items:
        c.drawString(col_x[0], y, desc)
        c.drawRightString(col_x[1] + 25, y, f"{qty:g}")
        c.drawRightString(col_x[2] + 55, y, money(unit))
        c.drawRightString(col_x[3] + 60, y, money(qty * unit))
        c.setStrokeColor(colors.HexColor("#dddddd"))
        c.line(x, y - 5, col_x[3] + 70, y - 5)
        y -= 18
    return y


def totals_block(c, x_label, x_val, y, rows, bold_last=True):
    for i, (label, val) in enumerate(rows):
        last = i == len(rows) - 1
        c.setFont("Helvetica-Bold" if (last and bold_last) else "Helvetica", 10.5 if last else 9.5)
        c.drawRightString(x_label, y, label)
        c.drawRightString(x_val, y, val)
        y -= 16
    return y


# ---------------------------------------------------------------- 1. Acme (happy path)
def acme():
    items = [
        ("Safety helmets, ANSI Type I", 200, 22.50),
        ("Hi-vis safety vests, Class 2", 250, 9.00),
        ("Steel-toe work boots", 40, 62.50),
    ]
    sub = sum(q * u for _, q, u in items)  # 9,250
    tax = round(sub * 0.08, 2)  # 740
    freight = 90.00
    total = sub + tax + freight  # 10,080

    c = canvas.Canvas(os.path.join(OUT, "happy-acme.pdf"), pagesize=LETTER)
    c.setFillColor(colors.HexColor("#1f3a8a"))
    c.rect(0, H - 90, W, 90, stroke=0, fill=1)
    c.setFillColor(colors.white)
    c.setFont("Helvetica-Bold", 20)
    c.drawString(40, H - 50, "ACME INDUSTRIAL SUPPLIES INC.")
    c.setFont("Helvetica", 9)
    c.drawString(40, H - 68, "1200 Foundry Road, Cleveland, OH 44114  |  billing@acme-industrial.com  |  EIN 84-2210457")
    c.setFont("Helvetica-Bold", 26)
    c.drawRightString(W - 40, H - 55, "INVOICE")

    c.setFillColor(colors.black)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(40, H - 125, "Bill to")
    c.setFont("Helvetica", 10)
    for i, l in enumerate(["Brightline Manufacturing Pvt Ltd", "Accounts Payable", "45 Harbor Street, Boston, MA 02110"]):
        c.drawString(40, H - 140 - i * 13, l)

    meta = [("Invoice #", "INV-0512"), ("Invoice date", "2026-11-06"), ("Due date", "2026-12-06"),
            ("PO number", "PO-1001"), ("Terms", "Net 30")]
    for i, (k, v) in enumerate(meta):
        c.setFont("Helvetica-Bold", 10)
        c.drawString(360, H - 125 - i * 15, k)
        c.setFont("Helvetica", 10)
        c.drawRightString(W - 40, H - 125 - i * 15, v)

    y = line_table(c, 40, H - 230, items, [45, 330, 390, 470], colors.HexColor("#1f3a8a"))
    totals_block(c, 470, W - 52, y - 15, [
        ("Subtotal", money(sub)), ("Sales tax (8%)", money(tax)), ("Freight", money(freight)),
        ("TOTAL DUE (USD)", money(total)),
    ])
    c.setFont("Helvetica", 8.5)
    c.drawString(40, 110, "Remit to: First Federal Bank  |  Account ****4821  |  Routing 041000124")
    c.drawString(40, 96, "Thank you for your business. Please reference the invoice number with your payment.")
    c.save()


# ---------------------------------------------------------------- 2. Globex (split PO)
def globex():
    items = [
        ("Warehousing - pallet storage, November", 1, 2000.00),
        ("LTL freight - outbound, 6 shipments", 1, 2300.00),
        ("Handling & cross-dock fees", 1, 500.00),
    ]
    total = sum(q * u for _, q, u in items)  # 4,800

    c = canvas.Canvas(os.path.join(OUT, "split-globex.pdf"), pagesize=LETTER)
    c.setFont("Helvetica-Bold", 16)
    c.drawString(40, H - 55, "Globex Logistics LLC")
    c.setFont("Helvetica", 9)
    c.drawString(40, H - 70, "88 Terminal Ave, Newark NJ 07114 · ar@globexlogistics.com · Tax ID 46-3381902")
    c.setStrokeColor(colors.HexColor("#0f766e"))
    c.setLineWidth(2)
    c.line(40, H - 82, W - 40, H - 82)

    c.setFont("Helvetica-Bold", 13)
    c.setFillColor(colors.HexColor("#0f766e"))
    c.drawString(40, H - 110, "TAX INVOICE  GLX-2231")
    c.setFillColor(colors.black)
    c.setFont("Helvetica", 10)
    c.drawString(40, H - 128, "Issued: 05 Nov 2026        Payment due: 05 Dec 2026")
    c.drawString(40, H - 143, "Your order ref: PO 1002   (part shipment 2 of 2)")
    c.drawString(40, H - 165, "Customer: Brightline Manufacturing, 45 Harbor Street, Boston MA")

    y = line_table(c, 40, H - 205, items, [45, 330, 390, 470], colors.HexColor("#0f766e"))
    totals_block(c, 470, W - 52, y - 15, [
        ("Net amount", money(total)), ("VAT / sales tax", "exempt (services)"),
        ("Amount payable", money(total)),
    ])
    c.setFont("Helvetica", 8.5)
    c.drawString(40, 100, "Bank: Chase Business · Acct ending 7730 · ACH preferred")
    c.save()


# ---------------------------------------------------------------- 3. Initech (duplicate re-send)
def initech():
    c = canvas.Canvas(os.path.join(OUT, "duplicate-initech.pdf"), pagesize=LETTER)
    c.setFont("Times-Bold", 22)
    c.drawString(40, H - 60, "INITECH")
    c.setFont("Times-Roman", 10)
    c.drawString(40, H - 75, "Initech Software Solutions · 4120 Freidrich Lane, Austin TX 78744")
    c.drawString(40, H - 88, "invoices@initech.io · EIN 91-1876543")

    c.setFont("Times-Bold", 12)
    rows = [("Invoice No.", "INV0457"), ("Date", "November 2, 2026"), ("Customer PO", "PO-1003"),
            ("Billing period", "Q4 FY26"), ("Currency", "USD")]
    for i, (k, v) in enumerate(rows):
        c.setFont("Times-Bold", 11)
        c.drawString(360, H - 60 - i * 15, k + ":")
        c.setFont("Times-Roman", 11)
        c.drawString(460, H - 60 - i * 15, v)

    c.setFont("Times-Roman", 11)
    c.drawString(40, H - 150, "Billed to: Brightline Manufacturing Pvt Ltd — Accounts Payable")

    items = [("ERP platform licence - quarterly instalment (1 of 3)", 1, 8000.00)]
    y = line_table(c, 40, H - 190, items, [45, 330, 390, 470], colors.HexColor("#444444"), font="Times")
    c.setFont("Times-Bold", 12)
    c.drawRightString(470, y - 20, "Total (tax included):")
    c.drawRightString(W - 52, y - 20, money(8000))
    c.setFont("Times-Italic", 9)
    c.drawString(40, 120, "Payment by wire to Silicon Valley Bank, account ending 1190.")
    c.drawString(40, 106, "This invoice was generated by our new billing system.")
    c.save()


# ---------------------------------------------------------------- 4. Northwind (scanned, no PO)
def northwind_scanned():
    # Rendered straight to an image so there is NO text layer — like a real scan.
    img = Image.new("RGB", (1700, 2200), (250, 249, 245))
    d = ImageDraw.Draw(img)
    fdir = os.path.join(os.environ.get("WINDIR", "C:/Windows"), "Fonts")

    def f(name, size):
        try:
            return ImageFont.truetype(os.path.join(fdir, name), size)
        except OSError:
            return ImageFont.load_default()

    big, mid, reg, mono = f("arialbd.ttf", 64), f("arialbd.ttf", 34), f("arial.ttf", 30), f("cour.ttf", 30)
    d.text((110, 110), "NORTHWIND TRADERS", font=big, fill=(30, 30, 30))
    d.text((110, 190), "Office supplies & print consumables", font=reg, fill=(60, 60, 60))
    d.text((110, 230), "77 Commerce Way, Providence RI 02903   Tax ID 27-5543210", font=reg, fill=(60, 60, 60))
    d.text((1150, 120), "INVOICE", font=big, fill=(30, 30, 30))
    d.text((1150, 210), "No:   NW-3388", font=mono, fill=(20, 20, 20))
    d.text((1150, 250), "Date: 11/05/2026", font=mono, fill=(20, 20, 20))
    d.text((110, 340), "SOLD TO: Brightline Manufacturing - Facilities Dept", font=reg, fill=(20, 20, 20))
    d.text((110, 380), "Attn: J. Moreno (ordered by phone)", font=reg, fill=(20, 20, 20))

    y = 480
    d.rectangle([100, y, 1600, y + 50], fill=(220, 220, 215))
    for label, x in [("ITEM", 120), ("QTY", 960), ("PRICE", 1140), ("TOTAL", 1380)]:
        d.text((x, y + 8), label, font=mid, fill=(20, 20, 20))
    items = [("HP 89A black toner cartridge", 10, 115.00), ("A4 copy paper 80gsm (box/5 reams)", 20, 28.00)]
    y += 80
    for desc, q, u in items:
        d.text((120, y), desc, font=reg, fill=(25, 25, 25))
        d.text((980, y), str(q), font=reg, fill=(25, 25, 25))
        d.text((1140, y), f"{u:,.2f}", font=reg, fill=(25, 25, 25))
        d.text((1380, y), f"{q * u:,.2f}", font=reg, fill=(25, 25, 25))
        y += 60
    sub = sum(q * u for _, q, u in items)  # 1,710
    tax = round(sub * 0.07, 2)  # 119.70
    y += 40
    d.line([1000, y, 1600, y], fill=(80, 80, 80), width=3)
    for label, val in [("Subtotal", sub), ("Sales tax 7%", tax), ("TOTAL USD", sub + tax)]:
        y += 20
        d.text((1000, y), label, font=mid if label.startswith("TOTAL") else reg, fill=(20, 20, 20))
        d.text((1380, y), f"{val:,.2f}", font=mid if label.startswith("TOTAL") else reg, fill=(20, 20, 20))
        y += 40
    d.text((110, 1900), "Pay to: Bank of RI, acct ending 5562.  Thank you!", font=reg, fill=(40, 40, 40))
    # A handwritten-ish note, as people do on paper invoices
    d.text((900, 1650), "rec'd 11/6  - JM", font=f("segoesc.ttf", 40), fill=(30, 60, 160))

    # Make it look scanned: speckle noise, slight skew, blur, grayscale
    rnd = random.Random(7)
    px = img.load()
    for _ in range(25000):
        x, yy = rnd.randrange(1700), rnd.randrange(2200)
        g = rnd.randrange(150, 230)
        px[x, yy] = (g, g, g)
    img = img.rotate(-1.4, resample=Image.BICUBIC, expand=False, fillcolor=(235, 235, 230))
    img = img.filter(ImageFilter.GaussianBlur(0.9)).convert("L")
    img.save(os.path.join(OUT, "scanned-northwind.pdf"), "PDF", resolution=200.0)


# ---------------------------------------------------------------- 5. Stark (bank details changed)
def stark():
    items = [("LED high-bay fixtures, 150W", 24, 150.00)]
    total = sum(q * u for _, q, u in items)  # 3,600
    c = canvas.Canvas(os.path.join(OUT, "fraud-stark.pdf"), pagesize=LETTER)
    c.setFillColor(colors.HexColor("#b91c1c"))
    c.rect(40, H - 75, 8, 40, stroke=0, fill=1)
    c.setFillColor(colors.black)
    c.setFont("Helvetica-Bold", 18)
    c.drawString(58, H - 55, "Stark Electrical Contractors Ltd")
    c.setFont("Helvetica", 9)
    c.drawString(58, H - 70, "Unit 4, 300 Voltage Park, Pittsburgh PA 15222 · accounts@starkelectrical.com")

    c.setFont("Helvetica-Bold", 11)
    c.drawString(40, H - 115, "Invoice SEC-1140")
    c.setFont("Helvetica", 10)
    c.drawString(40, H - 131, "Date: 2026-11-06     Due: on receipt")
    c.drawString(40, H - 146, "Purchase order: PO-1006 (lighting retrofit — fixtures delivered)")

    y = line_table(c, 40, H - 185, items, [45, 330, 390, 470], colors.HexColor("#b91c1c"))
    totals_block(c, 470, W - 52, y - 15, [("Subtotal", money(total)), ("Tax", money(0)), ("Total due USD", money(total))])

    c.setFillColor(colors.HexColor("#fef2f2"))
    c.rect(40, 120, W - 80, 70, stroke=0, fill=1)
    c.setFillColor(colors.HexColor("#991b1b"))
    c.setFont("Helvetica-Bold", 10)
    c.drawString(52, 172, "IMPORTANT: OUR BANK DETAILS HAVE CHANGED")
    c.setFont("Helvetica", 9.5)
    c.drawString(52, 156, "Please update your records and remit to: Meridian Trust Bank, Account 0099 1882 9917,")
    c.drawString(52, 142, "Routing 067014822. Payments to the old account will be returned.")
    c.save()


if __name__ == "__main__":
    acme()
    globex()
    initech()
    northwind_scanned()
    stark()
    print("Wrote:", sorted(os.listdir(OUT)))
