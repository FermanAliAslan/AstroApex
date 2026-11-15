"""Pack the whole site into ONE file: dist/AstroApex.html.

Why: e-mail services such as Gmail refuse attachments that contain .js or .bat files, even inside a
zip. A single .html file passes, and the recipient only has to double-click it.

Run:  python tools/build_single.py
"""
import io
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(rel):
    with io.open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return f.read()


def main():
    html = read("index.html")

    def css(m):
        return "<style>\n" + read(m.group(1)) + "\n</style>"

    def js(m):
        code = read(m.group(1)).replace("</script", "<\\/script")
        return "<script>\n/* " + m.group(1) + " */\n" + code + "\n</script>"

    html, n_css = re.subn(r'<link rel="stylesheet" href="([^"?:]+)(?:\?[^"]*)?">', css, html)
    html, n_js = re.subn(r'<script src="([^"?:]+)(?:\?[^"]*)?"></script>', js, html)
    assert n_css == 1 and n_js >= 6, (n_css, n_js)
    assert 'src="js/' not in html and 'src="data/' not in html

    out = os.path.join(ROOT, "dist", "AstroApex.html")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with io.open(out, "w", encoding="utf-8", newline="\n") as f:
        f.write(html)
    print("wrote %s (%.2f MB, %d scripts inlined)" % (out, os.path.getsize(out) / 1e6, n_js))

    # Web-page variant for hosts that wrap the file in their own <html>/<head>/<body> skeleton.
    head = html[html.index("<head>") + 6:html.index("</head>")]
    body = html[html.index("<body>") + 6:html.rindex("</body>")]
    head = re.sub(r"<meta[^>]*>\s*", "", head)
    head = re.sub(r"<title>.*?</title>", "<title>AstroApex Lunar Navigator</title>", head, flags=re.S)
    # the PDF download is hidden there, so the copy that promises a PDF talks about the on-screen report
    for a, b in [("“Görev raporu” tuşu her şeyi iki sayfalık bir PDF’te toplar.", "“Görev raporu” tuşu her şeyi iki sayfalık bir raporda toplar."),
                 ("The “Mission report” button gathers everything into a two-page PDF.", "The “Mission report” button gathers everything into a two-page report."),
                 ("“Görev raporu” — iki sayfalık PDF özeti", "“Görev raporu” — iki sayfalık özet"),
                 ("“Mission report” — a two-page PDF summary", "“Mission report” — a two-page summary")]:
        assert body.count(a) == 1, a
        body = body.replace(a, b)
    web = os.path.join(ROOT, "dist", "astroapex-web.html")
    with io.open(web, "w", encoding="utf-8", newline="\n") as f:
        # such hosts block file downloads, and their address is not shareable, so CSV export, PDF download and copy-link are hidden there (the report itself still opens on screen)
        f.write(head.strip() + "\n<style>[data-csv], #share, #pdf-dl, .table-actions { display: none; }</style>\n" + body.strip() + "\n")
    print("wrote %s (%.2f MB)" % (web, os.path.getsize(web) / 1e6))


if __name__ == "__main__":
    main()
