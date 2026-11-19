"""Add web assets to an unsigned APK using Android-compatible ZIP entry names."""
from html.parser import HTMLParser
from pathlib import Path
from sys import argv
from zipfile import ZIP_DEFLATED, ZipFile


class EntryPoints(HTMLParser):
    def __init__(self):
        super().__init__()
        self.paths = []

    def handle_starttag(self, tag, attrs):
        props = dict(attrs)
        if tag == "script" and props.get("src"):
            self.paths.append(props["src"])
        if tag == "link" and props.get("rel") == "stylesheet":
            self.paths.append(props["href"])


apk, directory = Path(argv[1]), Path(argv[2])
with ZipFile(apk, "a", compression=ZIP_DEFLATED) as archive:
    if any(name.startswith("assets/") for name in archive.namelist()):
        raise ValueError("Start with a freshly linked APK without -A")
    for source in directory.rglob("*"):
        if source.is_file():
            archive.writestr("assets/" + source.relative_to(directory).as_posix(), source.read_bytes())
    html = EntryPoints()
    html.feed(archive.read("assets/index.html").decode("utf-8"))
    if not html.paths or not all(archive.read("assets/" + url.lstrip("/")) for url in html.paths):
        raise ValueError("Missing startup assets")

