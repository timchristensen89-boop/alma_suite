#!/usr/bin/env python3
"""
Builds the staff-facing "how to run your first stocktake" guides as PDFs.

Two of them, because there are two ways in and they are not the same flow:

  stocktake-first-time-ipad.pdf   the venue iPad — device account + staff PIN
  stocktake-first-time-login.pdf  Alma Stock on your own email and password

Every screen name, button label and error message quoted in the guide is the
real string from the app, so this script lives next to the code it documents:
when the iPad stocktake screens change, change the copy here and re-run it.

  Source screens
    apps/venue-ipad-dashboard/src/pages/StocktakePage.tsx  (list / areas / count)
    apps/venue-ipad-dashboard/src/auth.tsx                 (device sign-in, PIN)
    apps/stock-web/src/pages/StocktakePage.tsx             (the Alma Stock flow)
    apps/stock-api/src/lib/stock-permissions.ts            (who may do what)

  Run:  python3 scripts/build-stocktake-guide.py
  Out:  docs/guides/stocktake-first-time-{ipad,login}.pdf

Note for the login guide: it describes the permission split as it stands after
`assertMayEnterCounts` (apps/stock-api/src/lib/stock-permissions.ts) — anyone
signed in may write counts to a stocktake that is open for counting, while
creating, submitting, reviewing, locking and applying stay manager-only. If
that guard ever moves, this copy has to move with it.
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

GUIDES = Path(__file__).resolve().parent.parent / "docs" / "guides"
OUT_IPAD = GUIDES / "stocktake-first-time-ipad.pdf"
OUT_LOGIN = GUIDES / "stocktake-first-time-login.pdf"

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
    """Numbered step: a green square with the number, then the copy beside it.

    Each step is kept whole, so keep them short enough not to strand half a
    page — the troubleshooting table is the place for the long explanations.
    """
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


def furniture(footer_text):
    """Accent rule along the top, footer along the bottom, on every page."""

    def draw(canvas, doc):
        canvas.saveState()
        canvas.setFillColor(ACCENT)
        canvas.rect(0, A4[1] - 6 * mm, A4[0], 6 * mm, stroke=0, fill=1)
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(MUTED)
        canvas.drawString(MARGIN, 11 * mm, footer_text)
        canvas.drawRightString(A4[0] - MARGIN, 11 * mm, f"Page {doc.page}")
        canvas.restoreState()

    return draw


def make_doc(out, doc_title, subject):
    out.parent.mkdir(parents=True, exist_ok=True)
    return BaseDocTemplate(
        str(out),
        pagesize=A4,
        leftMargin=MARGIN,
        rightMargin=MARGIN,
        topMargin=MARGIN,
        bottomMargin=18 * mm,
        title=doc_title,
        author="Alma Group",
        subject=subject,
    )


def build_ipad():
    doc = make_doc(
        OUT_IPAD,
        "Stocktake on the venue iPad",
        "First-time staff guide to running a stocktake on the venue iPad",
    )
    frame = Frame(MARGIN, 18 * mm, CONTENT_W, A4[1] - MARGIN - 18 * mm, id="main")
    doc.addPageTemplates(
        [PageTemplate(id="all", frames=[frame], onPage=furniture("Alma · Stocktake on the venue iPad"))]
    )

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
            "You don’t have to type zeros",
            [
                Paragraph(
                    "<b>If there is none of something, leave it blank.</b> Only type a number "
                    "for what you actually have. Anything still blank when the manager submits "
                    "the count is recorded as zero.",
                    callout_body,
                ),
                Spacer(1, 4),
                Paragraph(
                    "“Not counted yet” on screen is just your own progress marker while "
                    "you work — it is there so you can see what you have already walked past, "
                    "not so you have to go back and fill it in.",
                    callout_body,
                ),
            ],
            tone="accent",
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
    print(f"wrote {OUT_IPAD}")


def build_login():
    """The Alma Stock web flow, for counting on your own email and password."""
    doc = make_doc(
        OUT_LOGIN,
        "Stocktake on your own login",
        "First-time staff guide to counting a stocktake in Alma Stock on a personal login",
    )
    frame = Frame(MARGIN, 18 * mm, CONTENT_W, A4[1] - MARGIN - 18 * mm, id="main")
    doc.addPageTemplates(
        [PageTemplate(id="all", frames=[frame], onPage=furniture("Alma · Stocktake on your own login"))]
    )

    cb = ParagraphStyle("cb", parent=bullet, fontSize=10, leading=14)
    s = []

    s.append(Paragraph("Stocktake on your own login", title))
    s.append(
        Paragraph(
            "Counting in Alma Stock from your own account — what to tap, in order.",
            subtitle,
        )
    )
    s.append(Spacer(1, 12))

    s.append(
        callout(
            "Before you start",
            [
                li(
                    "Sign in at <b>alma-stock-v18.web.app</b> with your own Alma email and the "
                    "password your manager gives you.",
                    cb,
                ),
                li(
                    "A laptop or an iPad browser is far easier than a phone for a long count — "
                    "it all works, but you’ll be scrolling a lot on a phone.",
                    cb,
                ),
                li(
                    "<b>A manager starts the count; you count it.</b> Starting a stocktake, "
                    "submitting it and applying it to stock are all manager jobs — your part is "
                    "entering the numbers and saving them.",
                    cb,
                ),
            ],
        )
    )
    s.append(Spacer(1, 14))

    s.append(
        step(
            1,
            "Sign in",
            [
                Paragraph(
                    "Go to <b>alma-stock-v18.web.app</b>, enter your <b>Email</b> and "
                    "<b>Password</b>, tap <b>Sign in</b>. If it won’t let you in, "
                    "<b>Forgot password?</b> emails the office.",
                    body_tight,
                )
            ],
        )
    )

    s.append(
        step(
            2,
            "Open today’s count",
            [
                Paragraph(
                    "Tap <b>Stocktake</b> in the menu, then find today’s count in the list and "
                    "press <b>Count</b>.",
                    body_tight,
                ),
                Spacer(1, 4),
                li(
                    "No count in the list → a manager hasn’t started one yet. Ask them to; "
                    "you can’t start it yourself."
                ),
                li(
                    "The button says <b>View only</b> → that count has already been submitted or "
                    "locked, so it’s closed for counting. A manager can reopen it."
                ),
            ],
        )
    )

    s.append(
        step(
            3,
            "Set the screen up before you count",
            [
                Paragraph("Two toggles sit above the count lines. Both are worth using.", body_tight),
                Spacer(1, 4),
                li(
                    "<b>Blind count</b> — hides what the system expects to be on the shelf, so "
                    "you write down what’s actually there."
                ),
                li(
                    "<b>Walk by area</b> — orders the lines by location, so you do the bar, then "
                    "the cool room, then the kitchen, instead of criss-crossing the venue."
                ),
                Spacer(1, 3),
                Paragraph(
                    "Categories start closed. Tap a heading to open it — each one shows "
                    "<b>“4 of 28 counted”</b> so you can see what’s left.",
                    body_tight,
                ),
            ],
        )
    )

    s.append(
        step(
            4,
            "Count each line",
            [
                Paragraph(
                    "Each row is <b>Item · Label · Qty · Unit · Location</b>. Type the count into "
                    "<b>Qty</b>. The <b>Unit</b> beside it is what you’re counting in — bottles, "
                    "kg, each.",
                    body_tight,
                ),
                Spacer(1, 4),
                Paragraph(
                    "Underneath the row the screen prices your line as you go. If it warns you "
                    "about the unit, or says one line is most of the whole count, take it "
                    "seriously — it’s catching a units mistake while you’re still standing in "
                    "front of the shelf.",
                    body_tight,
                ),
            ],
        )
    )

    s.append(Spacer(1, 2))
    s.append(
        callout(
            "You don’t have to type zeros",
            [
                Paragraph(
                    "<b>If the shelf is empty, leave the Qty blank.</b> Only type a number for "
                    "what you actually have — counting three hundred lines is slow enough "
                    "without typing a zero next to half of them.",
                    callout_body,
                ),
                Spacer(1, 4),
                Paragraph(
                    "Every line still blank when the count is submitted is recorded as zero. "
                    "Until then blank just means you have not got to it yet, so saving a "
                    "half-finished count can never wipe a shelf.",
                    callout_body,
                ),
            ],
            tone="accent",
        )
    )
    s.append(Spacer(1, 14))

    s.append(
        step(
            5,
            "Save as you go",
            [
                Paragraph(
                    "Tap <b>Save draft</b> at the end of every area, and any time you stop. "
                    "Nothing is kept until you do — close the tab without saving and that "
                    "stretch of counting is gone.",
                    body_tight,
                )
            ],
        )
    )

    s.append(
        step(
            6,
            "Tell your manager when it’s done",
            [
                Paragraph(
                    "That’s your part. You won’t see a submit button — the screen says "
                    "<i>“Save draft keeps your counts. A manager submits the count and applies "
                    "it to stock.”</i> Save one last time and let them know the count is "
                    "finished.",
                    body_tight,
                )
            ],
        )
    )

    s.append(Spacer(1, 6))
    s.append(Paragraph("When something looks wrong", section_head))
    s.append(
        fix_table(
            [
                (
                    "The button says “View only”",
                    "That count has been submitted, reviewed or locked, so it’s closed for "
                    "counting. A manager can reopen it if there’s more to add.",
                ),
                (
                    "“Manager required” on New stocktake",
                    "Expected — starting a count is a manager job. Ask them to create it and it "
                    "will appear in your list.",
                ),
                (
                    "Two people on one count",
                    "Don’t. Saving sends the <i>whole</i> count back, not just the lines you "
                    "touched, so the second person to save overwrites the first one’s work. One "
                    "person per count — if you want to split the job, make it two counts.",
                ),
                (
                    "You closed the tab mid-count",
                    "Everything since your last <b>Save draft</b> is gone. It’s the only thing "
                    "that keeps your numbers, so save often.",
                ),
                (
                    "“Applied stocktakes cannot be edited”",
                    "A manager has already applied that count to stock, so it’s locked. Start a "
                    "new count, or ask them to reverse it.",
                ),
                (
                    "An item isn’t in the list",
                    "<b>Add line</b> at the top right of the count, then pick the item from the "
                    "picker.",
                ),
                (
                    "“unit ‘ml’ ≠ bottle”",
                    "You’ve typed a different unit from the one the item is costed in. Check it "
                    "against the parent product before you move on.",
                ),
                (
                    "“$12,400.00 — 62% of this whole count”",
                    "Almost always a units mistake rather than a real number. The message even "
                    "tells you what your count would come to if you meant the other unit.",
                ),
            ]
        )
    )

    s.append(Spacer(1, 14))
    s.append(
        callout(
            "For the manager — finishing the count",
            [
                li(
                    "<b>Submit for review</b> only marks the count ready. It does not move "
                    "stock.",
                    cb,
                ),
                li(
                    "<b>Apply count to stock</b> is the one that counts. It asks you to type "
                    "<b>APPLY COUNT</b>, then updates on-hand balances and writes the movements. "
                    "It can’t be run twice and isn’t bulk-reversible.",
                    cb,
                ),
                li(
                    "<b>Export CSV</b> on any row downloads counted-vs-expected variance if you "
                    "want to check it outside the app.",
                    cb,
                ),
                Spacer(1, 3),
                Paragraph(
                    "Only Admin and Manager accounts see those buttons, and only they can start "
                    "a count. Anyone signed in can enter counts on a count that is open — once "
                    "you submit it, it closes to them until you reopen it.",
                    callout_body,
                ),
            ],
        )
    )

    s.append(Spacer(1, 10))
    s.append(
        Paragraph(
            "Stuck on something this page doesn’t cover? Ask your venue manager. "
            f"<font color='#8a9990'>Guide updated {date.today().strftime('%-d %B %Y')}.</font>",
            ParagraphStyle("foot2", parent=body, fontSize=9, textColor=MUTED),
        )
    )

    doc.build(s)
    print(f"wrote {OUT_LOGIN}")


if __name__ == "__main__":
    build_ipad()
    build_login()
