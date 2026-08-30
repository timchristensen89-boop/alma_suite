#!/usr/bin/env python3
"""
Builds the staff-facing "first stocktake on the venue iPad" guide as a PDF.

Every screen name, button label and error message quoted in the guide is the
real string from the app, so this script lives next to the code it documents:
when the iPad stocktake screens change, change the copy here and re-run it.

  Source screens
    apps/venue-ipad-dashboard/src/pages/StocktakePage.tsx  (list / areas / count)
    apps/venue-ipad-dashboard/src/auth.tsx                 (device sign-in, PIN)
    apps/stock-web/src/pages/StocktakePage.tsx             (the manager half)

  Run:  python3 scripts/build-stocktake-guide.py
  Out:  docs/guides/stocktake-first-time-ipad.pdf
"""

from datetime import date
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    KeepTogether,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

# Alma accent, lifted from apps/venue-ipad-dashboard/src/styles.css
ACCENT = colors.HexColor("#2f6f52")
ACCENT_SOFT = colors.HexColor("#e4f2ea")
WARN = colors.HexColor("#8a5a00")
WARN_SOFT = colors.HexColor("#fdf3e0")
INK = colors.HexColor("#1c211d")
MUTED = colors.HexColor("#5d6b62")
RULE = colors.HexColor("#d6ded8")

OUT = Path(__file__).resolve().parent.parent / "docs" / "guides" / "stocktake-first-time-ipad.pdf"

MARGIN = 16 * mm

body = ParagraphStyle(
    "body", fontName="Helvetica", fontSize=10.2, leading=14.6, textColor=INK, alignment=TA_LEFT
)
body_tight = ParagraphStyle("body_tight", parent=body, spaceBefore=2, spaceAfter=2)
bullet = ParagraphStyle("bullet", parent=body, leftIndent=10, bulletIndent=0, spaceAfter=3.5)
step_head = ParagraphStyle(
    "step_head", fontName="Helvetica-Bold", fontSize=12.4, leading=15, textColor=INK, spaceAfter=3
)
section_head = ParagraphStyle(
    "section_head",
    fontName="Helvetica-Bold",
    fontSize=13,
    leading=16,
    textColor=ACCENT,
    spaceBefore=4,
    spaceAfter=6,
)
title = ParagraphStyle("title", fontName="Helvetica-Bold", fontSize=23, leading=26, textColor=INK)
subtitle = ParagraphStyle(
    "subtitle", fontName="Helvetica", fontSize=11, leading=15, textColor=MUTED, spaceBefore=3
)
callout_head = ParagraphStyle(
    "callout_head", fontName="Helvetica-Bold", fontSize=11, leading=14, textColor=ACCENT, spaceAfter=4
)
callout_head_warn = ParagraphStyle("callout_head_warn", parent=callout_head, textColor=WARN)
callout_body = ParagraphStyle("callout_body", parent=body, fontSize=10, leading=14)
step_num = ParagraphStyle(
    "step_num", fontName="Helvetica-Bold", fontSize=15, leading=17, textColor=colors.white
)

CONTENT_W = A4[0] - 2 * MARGIN


def li(text, style=bullet):
    return Paragraph(text, style, bulletText="•")


def callout(heading, flowables, tone="accent"):
    """A tinted, padded box with a coloured left edge."""
    fill, edge = (ACCENT_SOFT, ACCENT) if tone == "accent" else (WARN_SOFT, WARN)
    head_style = callout_head if tone == "accent" else callout_head_warn
    inner = [Paragraph(heading, head_style)] + list(flowables)
    t = Table([[inner]], colWidths=[CONTENT_W])
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), fill),
                ("LEFTPADDING", (0, 0), (-1, -1), 11),
                ("RIGHTPADDING", (0, 0), (-1, -1), 11),
                ("TOPPADDING", (0, 0), (-1, -1), 9),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
                ("LINEBEFORE", (0, 0), (0, -1), 3, edge),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ]
        )
    )
    return t


def step(number, heading, flowables):
    """Numbered step: a green square with the number, then the copy beside it."""
    badge = Table([[Paragraph(str(number), step_num)]], colWidths=[9 * mm], rowHeights=[9 * mm])
    badge.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), ACCENT),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
            ]
        )
    )
    right = [Paragraph(heading, step_head)] + list(flowables)
    t = Table([[badge, right]], colWidths=[13 * mm, CONTENT_W - 13 * mm])
    t.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (0, -1), 4 * mm),
                ("RIGHTPADDING", (1, 0), (1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
            ]
        )
    )
    return KeepTogether([t, Spacer(1, 9)])


def fix_table(rows):
    """Two-column 'if this / do this' table for the troubleshooting page."""
    data = [
        [Paragraph(f"<b>{a}</b>", callout_body), Paragraph(b, callout_body)] for a, b in rows
    ]
    t = Table(data, colWidths=[CONTENT_W * 0.36, CONTENT_W * 0.64])
    t.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (0, -1), 0),
                ("RIGHTPADDING", (0, 0), (0, -1), 6),
                ("LEFTPADDING", (1, 0), (1, -1), 6),
                ("RIGHTPADDING", (1, 0), (1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
                ("LINEBELOW", (0, 0), (-1, -2), 0.5, RULE),
            ]
        )
    )
    return t


def page_furniture(canvas, doc):
    canvas.saveState()
    # Accent rule across the top of every page.
    canvas.setFillColor(ACCENT)
    canvas.rect(0, A4[1] - 6 * mm, A4[0], 6 * mm, stroke=0, fill=1)
    # Footer.
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(MUTED)
    canvas.drawString(MARGIN, 11 * mm, "Alma · Stocktake on the venue iPad")
    canvas.drawRightString(A4[0] - MARGIN, 11 * mm, f"Page {doc.page}")
    canvas.restoreState()


def build():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    doc = BaseDocTemplate(
        str(OUT),
        pagesize=A4,
        leftMargin=MARGIN,
        rightMargin=MARGIN,
        topMargin=MARGIN,
        bottomMargin=18 * mm,
        title="Stocktake on the venue iPad",
        author="Alma Group",
        subject="First-time staff guide to running a stocktake on the venue iPad",
    )
    frame = Frame(MARGIN, 18 * mm, CONTENT_W, A4[1] - MARGIN - 18 * mm, id="main")
    doc.addPageTemplates([PageTemplate(id="all", frames=[frame], onPage=page_furniture)])

    s = []

    # ---- Title -------------------------------------------------------------
    s.append(Paragraph("Stocktake on the venue iPad", title))
    s.append(
        Paragraph(
            "Your first count — what to tap, in order. Read it once, then keep counting.",
            subtitle,
        )
    )
    s.append(Spacer(1, 12))

    s.append(
        callout(
            "Before you pick up the iPad",
            [
                li(
                    "The iPad stays signed in as the <b>venue’s</b> device. If you see "
                    "<b>“Sign in this device”</b>, stop and grab a manager — that "
                    "login is theirs, not yours.",
                    ParagraphStyle("c1", parent=bullet, fontSize=10, leading=14),
                ),
                li(
                    "You need your own <b>4–6 digit PIN</b>. A manager sets it for you in Alma "
                    "Staff. Without one you can’t count.",
                    ParagraphStyle("c2", parent=bullet, fontSize=10, leading=14),
                ),
                li(
                    "A manager <b>creates</b> the count in Alma Stock and <b>submits</b> it "
                    "afterwards. Your job is the bit in the middle: count it and save it.",
                    ParagraphStyle("c3", parent=bullet, fontSize=10, leading=14),
                ),
            ],
        )
    )
    s.append(Spacer(1, 14))

    # ---- Steps -------------------------------------------------------------
    s.append(
        step(
            1,
            "Open Stocktake",
            [
                Paragraph(
                    "Tap <b>Stocktake</b> in the menu down the left of the iPad, or the "
                    "<b>Stocktake</b> tile on the venue screen.",
                    body_tight,
                )
            ],
        )
    )

    s.append(
        step(
            2,
            "Say who you are",
            [
                Paragraph(
                    "You’ll get <b>“Who is using the iPad?”</b> — tap your name, "
                    "type your PIN, tap <b>Sign in</b>.",
                    body_tight,
                ),
                Spacer(1, 4),
                li(
                    "Your name is greyed out saying <i>“PIN not set”</i> → a manager "
                    "needs to set your PIN in Alma Staff."
                ),
                li(
                    "Nobody is listed at all → a brand new PIN takes a minute or two to reach "
                    "the iPad. Tap <b>Refresh</b> and try again."
                ),
                Spacer(1, 3),
                Paragraph(
                    "Your name then sits in the top right corner. Tapping it "
                    "(<b>Switch →</b>) is how you hand the iPad to the next person.",
                    body_tight,
                ),
            ],
        )
    )

    s.append(
        step(
            3,
            "Open today’s count",
            [
                Paragraph(
                    "Under <b>Open → Resume a count</b>, tap the count you’ve been asked "
                    "to do.",
                    body_tight,
                ),
                Spacer(1, 4),
                Paragraph(
                    "If it says <i>“No open stocktakes. Ask a manager to start a new one”</i>, "
                    "the count hasn’t been created yet. That’s a manager job in Alma Stock — "
                    "there’s nothing you can fix from the iPad.",
                    body_tight,
                ),
            ],
        )
    )

    s.append(
        step(
            4,
            "Pick an area",
            [
                Paragraph(
                    "You get one card per area — Bar, Cool room, Kitchen — each showing "
                    "something like <b>“0/24 counted”</b>. Tap one and work through it. "
                    "Finish the area, save, then come back for the next one.",
                    body_tight,
                )
            ],
        )
    )

    s.append(
        step(
            5,
            "Count each line",
            [
                Paragraph(
                    "Every row shows the item, its unit, and what the system currently thinks is "
                    "on hand.",
                    body_tight,
                ),
                Spacer(1, 4),
                li("Use the <b>–</b> and <b>+</b> buttons for small adjustments."),
                li(
                    "Tap the number to type. It highlights what’s already there, so you type "
                    "straight over the top of it."
                ),
                li("Halves are fine — type <b>0.5</b> for half a bottle."),
            ],
        )
    )

    s.append(Spacer(1, 2))
    s.append(
        callout(
            "Important — blank is not the same as zero",
            [
                Paragraph(
                    "<b>“Not counted yet”</b> means nobody has looked at that line. "
                    "<b>0</b> means you looked and the shelf was empty. To the manager reviewing "
                    "your count those are completely different answers — one is a gap, the "
                    "other is a result.",
                    callout_body,
                ),
                Spacer(1, 4),
                Paragraph(
                    "<b>If it’s empty, put in 0.</b> Don’t leave it blank.",
                    callout_body,
                ),
            ],
            tone="warn",
        )
    )
    s.append(Spacer(1, 14))

    s.append(
        step(
            6,
            "Save before you move on",
            [
                Paragraph(
                    "Tap <b>Save draft (12)</b> — the number in brackets is how many lines "
                    "you’ve changed. Greyed out means there’s nothing new to save. "
                    "You’ll see <b>“Saved · drafts updated”</b> flash up.",
                    body_tight,
                ),
                Spacer(1, 4),
                Paragraph(
                    "<b>Save at the end of every area</b>, and always before you put the iPad "
                    "down or hand it to someone else.",
                    body_tight,
                ),
            ],
        )
    )

    s.append(
        step(
            7,
            "That’s your part done",
            [
                Paragraph(
                    "You can’t submit the count, and you’re not meant to. A manager "
                    "checks it against what was expected and locks it in from Alma Stock. Tap "
                    "<b>Areas</b> to go back, or just leave it — your saved numbers are "
                    "waiting for them.",
                    body_tight,
                )
            ],
        )
    )

    # ---- Troubleshooting ---------------------------------------------------
    s.append(Spacer(1, 6))
    s.append(Paragraph("When something looks wrong", section_head))
    s.append(
        fix_table(
            [
                (
                    "Everything says “Not counted yet” again",
                    "That tag and the progress bar only track <i>this</i> sitting on <i>this</i> iPad. "
                    "Reload the page or come back later and they reset to zero. <b>Your saved "
                    "numbers are still there</b> — open a line and you’ll see them. Where "
                    "you can, finish an area in one go.",
                ),
                (
                    "Two people, two iPads, same count",
                    "Don’t. Saving sends the <i>whole</i> count back, not just your area, so "
                    "the last iPad to save overwrites the other one’s work. One iPad per "
                    "count — split by count, not by area.",
                ),
                (
                    "You typed 300 instead of 3",
                    "Just retype it and save again. Nothing is final until a manager applies the "
                    "count.",
                ),
                (
                    "A red error line with a Retry button",
                    "Tap <b>Retry</b>. If it keeps failing, check the iPad is on the venue wifi.",
                ),
                (
                    "“Sign out device”",
                    "Never do this mid-count. It warns you that unsaved drafts will be lost, and "
                    "it means it. To change person, use <b>Switch →</b> in the top right "
                    "instead.",
                ),
            ]
        )
    )

    # ---- Manager half ------------------------------------------------------
    s.append(Spacer(1, 14))
    s.append(
        callout(
            "For the manager — the other half, in Alma Stock",
            [
                Paragraph(
                    "Staff count on the iPads; everything else happens on a laptop in Alma Stock "
                    "→ <b>Stocktake</b>.",
                    callout_body,
                ),
                Spacer(1, 4),
                li(
                    "<b>New stocktake</b> — name it, set the venue and date, and either start "
                    "from a template or take the full count of every active item.",
                    ParagraphStyle("m1", parent=bullet, fontSize=10, leading=14),
                ),
                li(
                    "Staff count it on the iPads and save drafts against that same count.",
                    ParagraphStyle("m2", parent=bullet, fontSize=10, leading=14),
                ),
                li(
                    "<b>Submit for review</b> — this does <i>not</i> move stock. It just marks "
                    "the count ready.",
                    ParagraphStyle("m3", parent=bullet, fontSize=10, leading=14),
                ),
                li(
                    "<b>Apply count to stock</b> — the one that counts. It asks you to type "
                    "<b>APPLY COUNT</b>, then updates on-hand balances and writes the movements. "
                    "It can’t be run twice and isn’t bulk-reversible.",
                    ParagraphStyle("m4", parent=bullet, fontSize=10, leading=14),
                ),
                Spacer(1, 3),
                Paragraph(
                    "Only Admin and Manager accounts see those buttons — anyone else gets "
                    "<i>“Manager required”</i> and <i>“View only”</i>.",
                    callout_body,
                ),
            ],
        )
    )

    s.append(Spacer(1, 10))
    s.append(
        Paragraph(
            f"Stuck on something this page doesn’t cover? Ask your venue manager. "
            f"<font color='#8a9990'>Guide updated {date.today().strftime('%-d %B %Y')}.</font>",
            ParagraphStyle("foot", parent=body, fontSize=9, textColor=MUTED),
        )
    )

    doc.build(s)
    print(f"wrote {OUT}")


if __name__ == "__main__":
    build()
