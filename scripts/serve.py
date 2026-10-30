#!/usr/bin/env python3
"""Local static server for testing.

`python3 -m http.server` reads os.getcwd() while building its argument parser, which
fails outright when the process inherits a working directory it is not allowed to stat.
This chdirs into the repo first, so the cwd is always one we can read.

Usage: python3 scripts/serve.py [port]
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCache(SimpleHTTPRequestHandler):
    """The local page caches too, which has cost real debugging time before: a stale
    app.js looks exactly like a change that did not work. Tell the browser not to."""

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.address_string(), fmt % args))


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8766
    httpd = ThreadingHTTPServer(("127.0.0.1", port), NoCache)
    print(f"serving {ROOT} on http://127.0.0.1:{port}/", flush=True)
    httpd.serve_forever()
