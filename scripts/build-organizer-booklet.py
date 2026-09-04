from __future__ import annotations

import argparse
import os
from pathlib import Path
from urllib.parse import urlparse

from reportlab.graphics import renderPDF
from reportlab.graphics.barcode import qr
from reportlab.graphics.shapes import Drawing
from reportlab.lib.colors import HexColor
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
from reportlab.platypus import Paragraph
from reportlab.lib.styles import ParagraphStyle


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "public" / "assets"
GUIDE = ASSETS / "guide"
DEFAULT_OUTPUT = ROOT / "output" / "pdf" / "boxtier-organizer-booklet.pdf"

PAPER = HexColor("#F7F0E4")
INK = HexColor("#171717")
ORANGE = HexColor("#EC4A32")
BLUE = HexColor("#315A88")
MUTED = HexColor("#6F6961")
RULE = HexColor("#D3C8B8")
WHITE = HexColor("#FFFFFF")

PAGE_W, PAGE_H = A4
MARGIN = 18 * mm
CONTENT_W = PAGE_W - 2 * MARGIN


def register_fonts() -> None:
    windows_dir = os.environ.get("WINDIR")
    if not windows_dir:
        raise FileNotFoundError("Windows 폰트 경로를 찾을 수 없습니다.")
    font_dir = Path(windows_dir) / "Fonts"
    regular_candidates = [
        font_dir / "malgun.ttf",
        font_dir / "NanumGothic.ttf",
    ]
    bold_candidates = [
        font_dir / "malgunbd.ttf",
        font_dir / "NanumGothicBold.ttf",
    ]
    regular = next((path for path in regular_candidates if path.exists()), None)
    bold = next((path for path in bold_candidates if path.exists()), None)
    if not regular or not bold:
        raise FileNotFoundError("한글 PDF 폰트를 찾을 수 없습니다.")
    pdfmetrics.registerFont(TTFont("BoxTier", str(regular)))
    pdfmetrics.registerFont(TTFont("BoxTier-Bold", str(bold)))


def paragraph(
    c: canvas.Canvas,
    text: str,
    x: float,
    top: float,
    width: float,
    *,
    font: str = "BoxTier",
    size: float = 10,
    leading: float | None = None,
    color=INK,
) -> float:
    style = ParagraphStyle(
        "body",
        fontName=font,
        fontSize=size,
        leading=leading or size * 1.55,
        textColor=color,
        alignment=TA_LEFT,
        wordWrap="CJK",
        splitLongWords=True,
        spaceAfter=0,
    )
    item = Paragraph(text.replace("\n", "<br/>"), style)
    _, height = item.wrap(width, PAGE_H)
    item.drawOn(c, x, top - height)
    return top - height


def lines(
    c: canvas.Canvas,
    text: str,
    x: float,
    top: float,
    *,
    font: str = "BoxTier-Bold",
    size: float = 30,
    leading: float | None = None,
    color=INK,
) -> float:
    c.setFillColor(color)
    c.setFont(font, size)
    step = leading or size * 1.18
    baseline = top - size
    for line in text.split("\n"):
        c.drawString(x, baseline, line)
        baseline -= step
    return baseline


def fit_image(
    c: canvas.Canvas,
    path: Path,
    x: float,
    y: float,
    width: float,
    height: float,
    *,
    background=WHITE,
    border=RULE,
) -> None:
    image = ImageReader(str(path))
    image_w, image_h = image.getSize()
    scale = min(width / image_w, height / image_h)
    draw_w = image_w * scale
    draw_h = image_h * scale
    draw_x = x + (width - draw_w) / 2
    draw_y = y + (height - draw_h) / 2
    c.setFillColor(background)
    c.rect(x, y, width, height, stroke=0, fill=1)
    c.drawImage(image, draw_x, draw_y, draw_w, draw_h, preserveAspectRatio=True, mask="auto")
    c.setStrokeColor(border)
    c.setLineWidth(0.6)
    c.rect(x, y, width, height, stroke=1, fill=0)


def page_frame(c: canvas.Canvas, page_no: int, label: str, *, dark: bool = False) -> None:
    background = INK if dark else PAPER
    foreground = WHITE if dark else INK
    secondary = HexColor("#C9C3BA") if dark else MUTED
    c.setFillColor(background)
    c.rect(0, 0, PAGE_W, PAGE_H, stroke=0, fill=1)
    c.setFillColor(ORANGE)
    c.setFont("BoxTier-Bold", 7.5)
    c.drawString(MARGIN, PAGE_H - 15 * mm, "BOXTIER / ORGANIZER GUIDE")
    c.setFillColor(secondary)
    c.setFont("BoxTier", 7.5)
    c.drawRightString(PAGE_W - MARGIN, PAGE_H - 15 * mm, label)
    c.setStrokeColor(HexColor("#4D4D4D") if dark else RULE)
    c.setLineWidth(0.7)
    c.line(MARGIN, 13 * mm, PAGE_W - MARGIN, 13 * mm)
    c.setFillColor(foreground)
    c.setFont("BoxTier-Bold", 7)
    c.drawString(MARGIN, 8.5 * mm, "BOXTIER")
    c.setFillColor(secondary)
    c.setFont("BoxTier", 7)
    c.drawRightString(PAGE_W - MARGIN, 8.5 * mm, f"{page_no:02d} / 06")

def normalize_public_url(value: str | None) -> str:
    candidate = (value or "").strip().rstrip("/")
    parsed = urlparse(candidate)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc or "your-domain" in parsed.netloc:
        raise ValueError("--public-url에 실제 공개 웹 주소를 입력해야 합니다.")
    return candidate


def resolve_create_url(value: str | None) -> str:
    public_url = normalize_public_url(value)
    parsed = urlparse(public_url)
    normalized_path = parsed.path.rstrip("/")
    if normalized_path.endswith("/app/create"):
        return public_url
    return f"{public_url}/app/create"


def draw_qr(c: canvas.Canvas, value: str, x: float, y: float, size: float) -> None:
    widget = qr.QrCodeWidget(value)
    x1, y1, x2, y2 = widget.getBounds()
    width = x2 - x1
    height = y2 - y1
    drawing = Drawing(
        size,
        size,
        transform=[size / width, 0, 0, size / height, 0, 0],
    )
    drawing.add(widget)
    renderPDF.draw(drawing, c, x, y)
    c.linkURL(value, (x, y, x + size, y + size), relative=0, thickness=0)


def draw_source_link(c: canvas.Canvas, label: str, url: str, x: float, y: float) -> float:
    c.setFillColor(MUTED)
    c.setFont("BoxTier", 5.4)
    c.drawString(x, y, label)
    width = pdfmetrics.stringWidth(label, "BoxTier", 5.4)
    c.linkURL(url, (x, y - 1.2 * mm, x + width, y + 1.8 * mm), relative=0, thickness=0)
    return x + width


def page_1(c: canvas.Canvas) -> None:
    page_frame(c, 1, "첫 경기")
    wordmark = ImageReader(str(ASSETS / "boxtier_letter_dark.png"))
    c.drawImage(wordmark, MARGIN, PAGE_H - 39 * mm, 70 * mm, 15 * mm, preserveAspectRatio=True, mask="auto")
    c.setFillColor(ORANGE)
    c.setFont("BoxTier-Bold", 8)
    c.drawString(MARGIN, PAGE_H - 48 * mm, "운영자를 위한 경기 운영 안내")
    lines(c, "경기 운영,\n링크 하나로.", MARGIN, PAGE_H - 54 * mm, size=31, leading=36)
    paragraph(
        c,
        "앱 설치 없이 모바일과 PC 웹에서.<br/>Google 로그인 후 참가 승인부터 출석·진행·결과까지 이어집니다.",
        MARGIN,
        PAGE_H - 133 * mm,
        CONTENT_W,
        size=11,
        leading=17,
    )
    c.setFillColor(INK)
    c.setFont("BoxTier-Bold", 8.5)
    c.drawString(MARGIN, PAGE_H - 158 * mm, "GOOGLE 로그인")
    c.setFillColor(ORANGE)
    c.drawString(MARGIN + 41 * mm, PAGE_H - 158 * mm, "·")
    c.setFillColor(INK)
    c.drawString(MARGIN + 47 * mm, PAGE_H - 158 * mm, "주최자 승인")
    c.setFillColor(ORANGE)
    c.drawString(MARGIN + 78 * mm, PAGE_H - 158 * mm, "·")
    c.setFillColor(INK)
    c.drawString(MARGIN + 84 * mm, PAGE_H - 158 * mm, "경기방 운영")
    fit_image(
        c,
        GUIDE / "matching-create.jpg",
        MARGIN,
        38 * mm,
        CONTENT_W,
        93 * mm,
    )
    c.setFillColor(MUTED)
    c.setFont("BoxTier", 6.8)
    c.drawString(MARGIN, 33 * mm, "BOXTIER 경기 만들기 화면 예시")


def page_2(c: canvas.Canvas) -> None:
    page_frame(c, 2, "참가")
    lines(c, "설명보다 먼저\n링크를 엽니다.", MARGIN, PAGE_H - 30 * mm, size=30, leading=35)
    paragraph(
        c,
        "모바일과 PC에서 같은 경기 주소를 엽니다. Google 로그인으로 시작하고, 참가 신청은 주최자가 확인합니다.",
        MARGIN,
        PAGE_H - 102 * mm,
        128 * mm,
        size=10.5,
        leading=16,
    )
    c.setFillColor(INK)
    c.rect(MARGIN, 75 * mm, CONTENT_W, 85 * mm, stroke=0, fill=1)
    statements = [
        ("열기", "단체방의 경기 링크", ORANGE),
        ("들어오기", "Google 로그인", WHITE),
        ("확정", "참가 신청 · 주최자 승인", HexColor("#B9CBE0")),
    ]
    for index, (verb, detail, color) in enumerate(statements):
        y = 139 * mm - index * 26 * mm
        if index:
            c.setStrokeColor(HexColor("#484848"))
            c.setLineWidth(0.7)
            c.line(MARGIN + 7 * mm, y + 11 * mm, PAGE_W - MARGIN - 7 * mm, y + 11 * mm)
        c.setFillColor(color)
        c.setFont("BoxTier-Bold", 20)
        c.drawString(MARGIN + 7 * mm, y, verb)
        c.setFillColor(WHITE)
        c.setFont("BoxTier-Bold", 11)
        c.drawRightString(PAGE_W - MARGIN - 7 * mm, y + 1.5 * mm, detail)
    c.setFillColor(BLUE)
    c.rect(MARGIN, 28 * mm, CONTENT_W, 31 * mm, stroke=0, fill=1)
    c.setFillColor(WHITE)
    c.setFont("BoxTier-Bold", 7.5)
    c.drawString(MARGIN + 6 * mm, 50 * mm, "단체방 안내 문구")
    c.setFont("BoxTier", 9)
    c.drawString(MARGIN + 6 * mm, 38 * mm, "“다음 경기 링크입니다. 웹에서 Google 로그인 후 참가 신청해 주세요.”")


def page_3(c: canvas.Canvas) -> None:
    page_frame(c, 3, "운영센터")
    lines(c, "오늘 할 일이\n먼저 보입니다.", MARGIN, PAGE_H - 31 * mm, size=30, leading=35)
    paragraph(
        c,
        "운영센터는 새 관리자 권한을 만드는 곳이 아닙니다. 기존 주최자·심판 권한으로 처리할 다음 행동만 모읍니다.",
        MARGIN,
        PAGE_H - 103 * mm,
        CONTENT_W,
        size=10.5,
        leading=16,
    )
    c.setFillColor(INK)
    c.rect(0, 66 * mm, PAGE_W, 103 * mm, stroke=0, fill=1)
    rows = [
        ("지금", "승인 · 체크인 · 진행 · 경기 후 확인", ORANGE),
        ("다음", "예정된 주최 경기 · 배정된 심판 경기", HexColor("#B9CBE0")),
        ("지난", "완료 · 취소 · 무효 경기 확인", WHITE),
    ]
    for index, (name, description, color) in enumerate(rows):
        y = 143 * mm - index * 29 * mm
        c.setFillColor(color)
        c.setFont("BoxTier-Bold", 26)
        c.drawString(MARGIN, y, name)
        c.setFillColor(WHITE)
        c.setFont("BoxTier", 9)
        c.drawString(MARGIN + 49 * mm, y + 2 * mm, description)
        if index < 2:
            c.setStrokeColor(HexColor("#4A4A4A"))
            c.line(MARGIN, y - 11 * mm, PAGE_W - MARGIN, y - 11 * mm)
    c.setFillColor(MUTED)
    c.setFont("BoxTier", 6.8)
    c.drawString(MARGIN, 60 * mm, "운영 업무 구조 · 실제 경기 상태와 기존 주최자·심판 권한을 그대로 사용")
    c.setFillColor(ORANGE)
    c.setFont("BoxTier-Bold", 21)
    c.drawString(MARGIN, 39 * mm, "메뉴보다 할 일부터.")
    c.setFillColor(INK)
    c.setFont("BoxTier", 8.5)
    c.drawString(MARGIN, 28.5 * mm, "항목을 누르면 해당 경기방의 기존 작업으로 바로 이어집니다.")


def page_4(c: canvas.Canvas, create_url: str) -> None:
    page_frame(c, 4, "체크인")
    lines(c, "경기 전,\n출석을 엽니다.", MARGIN, PAGE_H - 31 * mm, size=30, leading=35)
    paragraph(
        c,
        "경기 링크와 QR로 현장 진입을 단순하게 만듭니다. 모바일과 데스크탑에서 같은 웹 주소를 사용합니다.",
        MARGIN,
        PAGE_H - 103 * mm,
        CONTENT_W,
        size=10.5,
        leading=16,
    )
    qr_size = 55 * mm
    qr_x = PAGE_W - MARGIN - qr_size
    qr_y = 90 * mm
    c.setFillColor(WHITE)
    c.rect(qr_x - 4 * mm, qr_y - 4 * mm, qr_size + 8 * mm, qr_size + 8 * mm, stroke=0, fill=1)
    draw_qr(c, create_url, qr_x, qr_y, qr_size)
    c.setFillColor(ORANGE)
    c.setFont("BoxTier-Bold", 8)
    c.drawString(MARGIN, 149 * mm, "첫 경기 만들기")
    c.setFillColor(INK)
    c.setFont("BoxTier-Bold", 18)
    c.drawString(MARGIN, 133 * mm, "QR을 찍으면")
    c.drawString(MARGIN, 116 * mm, "실제 웹이 열립니다.")
    paragraph(
        c,
        "이 책자의 QR은 경기 만들기 페이지로 이동합니다. 경기별 출석 QR은 실제 경기 생성 후 경기방에서 발급됩니다.",
        MARGIN,
        101 * mm,
        82 * mm,
        size=8.5,
        leading=13,
        color=MUTED,
    )
    c.setFillColor(BLUE)
    c.rect(MARGIN, 45 * mm, CONTENT_W, 25 * mm, stroke=0, fill=1)
    c.setFillColor(WHITE)
    c.setFont("BoxTier-Bold", 12)
    c.drawString(MARGIN + 6 * mm, 59 * mm, create_url.replace("https://", ""))
    c.setFont("BoxTier", 7.5)
    c.drawRightString(PAGE_W - MARGIN - 6 * mm, 50 * mm, "모바일 · 데스크탑 웹")
    c.linkURL(create_url, (MARGIN, 45 * mm, PAGE_W - MARGIN, 70 * mm), relative=0, thickness=0)
    c.setFillColor(MUTED)
    c.setFont("BoxTier", 7)
    c.drawString(MARGIN, 31 * mm, "정적 책자에는 특정 경기의 출석 QR을 싣지 않습니다.")


def page_5(c: canvas.Canvas) -> None:
    page_frame(c, 5, "라이브 경기", dark=True)
    lines(c, "점수 입력 권한은\n역할대로.", MARGIN, PAGE_H - 31 * mm, size=30, leading=35, color=WHITE)
    paragraph(
        c,
        "같은 화면을 보여 주더라도 누가 무엇을 조작하는지는 경기의 심판 배정 여부에 따라 달라집니다.",
        MARGIN,
        PAGE_H - 103 * mm,
        CONTENT_W,
        size=10.5,
        leading=16,
        color=HexColor("#D7D2CA"),
    )
    col_gap = 10 * mm
    col_w = (CONTENT_W - col_gap) / 2
    c.setStrokeColor(HexColor("#4C4C4C"))
    c.setLineWidth(0.8)
    c.line(MARGIN + col_w + col_gap / 2, 83 * mm, MARGIN + col_w + col_gap / 2, 165 * mm)
    role_blocks = [
        (
            MARGIN,
            "무심판 경기",
            "모바일 전광판 담당자가 경기시간·샷클락·점수를 조작합니다.",
        ),
        (
            MARGIN + col_w + col_gap,
            "심판 경기",
            "배정 심판이 개인 득점을 기록해 팀 점수를 확정합니다.",
        ),
    ]
    for x, title, description in role_blocks:
        c.setFillColor(ORANGE)
        c.setFont("BoxTier-Bold", 8)
        c.drawString(x, 157 * mm, "OPERATING ROLE")
        c.setFillColor(WHITE)
        c.setFont("BoxTier-Bold", 20)
        c.drawString(x, 139 * mm, title)
        paragraph(
            c,
            description,
            x,
            123 * mm,
            col_w,
            size=10,
            leading=16,
            color=HexColor("#D7D2CA"),
        )
    c.setFillColor(BLUE)
    c.rect(MARGIN, 43 * mm, CONTENT_W, 27 * mm, stroke=0, fill=1)
    c.setFillColor(WHITE)
    c.setFont("BoxTier-Bold", 10)
    c.drawString(MARGIN + 6 * mm, 59 * mm, "모바일 전광판 담당자")
    c.setFont("BoxTier", 8.5)
    c.drawRightString(PAGE_W - MARGIN - 6 * mm, 49.5 * mm, "심판 경기에서도 경기시간·샷클락을 조작")
    c.setFillColor(HexColor("#BDB7AE"))
    c.setFont("BoxTier", 6.8)
    c.drawString(MARGIN, 31 * mm, "운영 화면은 배정 역할에 따라 다르게 열립니다.")


def page_6(c: canvas.Canvas, create_url: str) -> None:
    page_frame(c, 6, "결과와 시작")
    lines(c, "첫 경기는\n한 건만 끝냅니다.", MARGIN, PAGE_H - 31 * mm, size=30, leading=35)
    paragraph(
        c,
        "회원 수를 늘리는 실험이 아닙니다. 운영자 한 명이 실제 경기 한 건을 만들고, 공유하고, 승인하고, 결과까지 확인하는 실험입니다.",
        MARGIN,
        PAGE_H - 103 * mm,
        CONTENT_W,
        size=10.5,
        leading=16,
    )
    c.setStrokeColor(RULE)
    c.setLineWidth(0.8)
    c.line(MARGIN, 159 * mm, PAGE_W - MARGIN, 159 * mm)
    c.setFillColor(ORANGE)
    c.setFont("BoxTier-Bold", 9)
    c.drawString(MARGIN, 149 * mm, "운영자")
    paragraph(
        c,
        "Google 로그인 · 경기 정보 확인 · 단체방 공유 · 참가 승인 · 결과 최종 확인",
        MARGIN,
        141 * mm,
        CONTENT_W,
        size=10,
        leading=15,
    )
    c.setStrokeColor(RULE)
    c.line(MARGIN, 116 * mm, PAGE_W - MARGIN, 116 * mm)
    c.setFillColor(BLUE)
    c.setFont("BoxTier-Bold", 9)
    c.drawString(MARGIN, 106 * mm, "BOXTIER")
    paragraph(
        c,
        "경기 링크 · 출석 QR · 진행 체크리스트 · 결과 안내 준비",
        MARGIN,
        98 * mm,
        CONTENT_W,
        size=10,
        leading=15,
    )
    c.setFillColor(ORANGE)
    c.rect(MARGIN, 43 * mm, CONTENT_W, 35 * mm, stroke=0, fill=1)
    c.setFillColor(WHITE)
    c.setFont("BoxTier-Bold", 17)
    c.drawString(MARGIN + 7 * mm, 64 * mm, "첫 경기 만들기")
    c.setFont("BoxTier-Bold", 9)
    c.drawString(MARGIN + 7 * mm, 51 * mm, create_url.replace("https://", ""))
    c.drawRightString(PAGE_W - MARGIN - 7 * mm, 51 * mm, "열기 →")
    c.linkURL(create_url, (MARGIN, 43 * mm, PAGE_W - MARGIN, 78 * mm), relative=0, thickness=0)
    source_y = 32 * mm
    x = draw_source_link(
        c,
        "OpenSports 창업 회고 · opensports.net",
        "https://opensports.net/blog/growing-a-startup-is-a-remarkable-saga-heres-some-insights-two-years-in",
        MARGIN,
        source_y,
    )
    draw_source_link(c, "  /  TeamSnap Coach Toolkit · teamsnap.com", "https://www.teamsnap.com/teams/coach-toolkit", x, source_y)
    x = draw_source_link(c, "Partiful Invitations · partiful.com", "https://partiful.com/invitations/make-invitations", MARGIN, 24 * mm)
    draw_source_link(c, "  /  Spond Events · help.spond.com  · 확인 2026-09-04", "https://help.spond.com/app/en/articles/129730-features-in-events", x, 24 * mm)


def build(output: Path, public_url: str) -> None:
    register_fonts()
    create_url = resolve_create_url(public_url)
    output.parent.mkdir(parents=True, exist_ok=True)
    pdf = canvas.Canvas(str(output), pagesize=A4, pageCompression=1)
    pdf.setTitle("BOXTIER 운영자 안내")
    pdf.setAuthor("BOXTIER")
    pdf.setCreator("BOXTIER")
    pdf.setSubject("첫 경기 운영 세팅 안내")
    draw_pages = (
        page_1,
        page_2,
        page_3,
        lambda current: page_4(current, create_url),
        page_5,
        lambda current: page_6(current, create_url),
    )
    for draw_page in draw_pages:
        draw_page(pdf)
        pdf.showPage()
    pdf.save()


def main() -> None:
    parser = argparse.ArgumentParser(description="BOXTIER 운영자 홍보 책자 PDF 생성")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--public-url", default=os.environ.get("VITE_PUBLIC_APP_URL"))
    args = parser.parse_args()
    try:
        public_url = normalize_public_url(args.public_url)
    except ValueError as error:
        parser.error(str(error))
    build(args.output.resolve(), public_url)
    print(args.output.resolve())


if __name__ == "__main__":
    main()
