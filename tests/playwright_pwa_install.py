#!/usr/bin/env python3
"""PWA installability: manifest, icons, SW, CDP Page.getInstallabilityErrors.
Default target is the live GitHub Pages app. Uses a persistent Chrome profile
so the audit is not the incognito-only error."""
import json, os, tempfile, time
from pathlib import Path
from urllib.parse import urljoin, urlparse
from playwright.sync_api import sync_playwright

BASE = os.environ.get("VEZU_BASE", "https://avtomaster24bot-lab.github.io/vezu/").rstrip("/") + "/"
CHROME = os.environ.get("CHROME", "/usr/bin/google-chrome")
PAGES = ["", "app.html", "card.html?u=vezu", "index.html"]


def absurl(path):
    return urljoin(BASE, path)


def main():
    errors = []
    with sync_playwright() as p:
        tmp = tempfile.mkdtemp(prefix="vezu-pwa-")
        ctx = p.chromium.launch_persistent_context(
            tmp,
            executable_path=CHROME,
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage"],
            locale="ru-RU",
            service_workers="allow",
            viewport={"width": 390, "height": 844},
            device_scale_factor=2,
            is_mobile=True,
            has_touch=True,
        )
        page = ctx.new_page()
        page.set_default_timeout(45000)

        # --- manifest + assets ---
        page.goto(absurl("app.html"), wait_until="domcontentloaded")
        man_href, man, status, ctype = page.evaluate(
            """async () => {
              const link = document.querySelector('link[rel=manifest]');
              const href = link && link.href;
              const r = await fetch(href);
              return [href, await r.json(), r.status, r.headers.get('content-type')];
            }"""
        )
        print("MANIFEST", man_href, status, ctype)
        if status != 200:
            errors.append("manifest status %s" % status)
        if not ctype or "manifest" not in ctype and "json" not in ctype:
            errors.append("unexpected manifest content-type: %s" % ctype)
        for field in ("name", "short_name", "start_url", "scope", "display", "id", "background_color", "theme_color"):
            if not man.get(field):
                errors.append("manifest missing " + field)
        if man.get("display") != "standalone":
            errors.append("display is %s" % man.get("display"))
        # start_url / scope inside /vezu/
        start = urljoin(man_href, man["start_url"])
        scope = urljoin(man_href, man["scope"])
        print("START", start, "SCOPE", scope)
        if "/vezu/" not in urlparse(start).path and not urlparse(start).path.endswith("/vezu"):
            errors.append("start_url outside /vezu/: " + start)
        if not start.startswith(scope):
            errors.append("start_url not in scope")
        if not start.endswith("app.html") and "app.html" not in start:
            errors.append("start_url should be app.html, got " + start)

        # no redirect on start_url
        redir = page.evaluate(
            """async (u) => {
              const r = await fetch(u, { redirect: 'manual' });
              return {status: r.status, loc: r.headers.get('location'), type: r.type};
            }""",
            start,
        )
        print("START_FETCH", redir)
        if redir["status"] in (301, 302, 303, 307, 308):
            errors.append("start_url redirects: " + str(redir))
        if redir["status"] != 200:
            errors.append("start_url status " + str(redir["status"]))

        icons = man.get("icons") or []
        purposes = {}
        for ic in icons:
            src = urljoin(man_href, ic["src"])
            st = page.evaluate(
                """async (u) => { const r = await fetch(u); const b = await r.arrayBuffer();
                  return {status: r.status, type: r.headers.get('content-type'), len: b.byteLength}; }""",
                src,
            )
            print("ICON", ic.get("sizes"), ic.get("purpose"), st)
            if st["status"] != 200 or st["len"] < 100 or (st["type"] and "png" not in st["type"]):
                errors.append("bad icon %s %s" % (ic.get("sizes"), st))
            for pr in (ic.get("purpose") or "any").split():
                purposes.setdefault(pr, set()).add(ic.get("sizes"))
        if "192x192" not in purposes.get("any", set()):
            errors.append("missing 192 any icon")
        if "512x512" not in purposes.get("any", set()):
            errors.append("missing 512 any icon")
        if "192x192" not in purposes.get("maskable", set()) or "512x512" not in purposes.get("maskable", set()):
            errors.append("missing maskable 192 or 512: %s" % purposes.get("maskable"))

        shots = man.get("screenshots") or []
        forms = {s.get("form_factor") for s in shots}
        if "narrow" not in forms or "wide" not in forms:
            errors.append("need narrow+wide screenshots, got " + str(forms))
        for s in shots:
            src = urljoin(man_href, s["src"])
            st = page.evaluate(
                """async (u) => { const r = await fetch(u); return {status: r.status, type: r.headers.get('content-type')}; }""",
                src,
            )
            print("SHOT", s.get("form_factor"), s.get("sizes"), st)
            if st["status"] != 200:
                errors.append("screenshot missing " + s["src"])

        # --- SW + installability on key pages ---
        for rel in PAGES:
            url = absurl(rel)
            page.goto(url, wait_until="networkidle")
            page.wait_for_timeout(2000)
            # wait until SW controls if possible
            try:
                page.wait_for_function(
                    "() => !!(navigator.serviceWorker && navigator.serviceWorker.controller)",
                    timeout=15000,
                )
            except Exception:
                pass
            info = page.evaluate(
                """async () => {
                  const link = document.querySelector('link[rel=manifest]');
                  const href = link && link.href || '';
                  const regs = await navigator.serviceWorker.getRegistrations();
                  return {
                    href,
                    isBlob: href.indexOf('blob:') === 0,
                    sw: regs.map(r => ({scope: r.scope, script: r.active && r.active.scriptURL, state: r.active && r.active.state})),
                    ctrl: navigator.serviceWorker.controller && navigator.serviceWorker.controller.scriptURL
                  };
                }"""
            )
            print("PAGE", url, "manifest", info["href"], "blob", info["isBlob"], "sw", info["sw"], "ctrl", info["ctrl"])
            if info["isBlob"]:
                errors.append(url + " uses blob manifest")
            if "manifest.webmanifest" not in (info["href"] or "") and rel != "":
                # bounce/short pages may use /vezu/manifest.webmanifest — still the platform file
                if not (info["href"] or "").endswith("manifest.webmanifest"):
                    errors.append(url + " unexpected manifest " + info["href"])
            if "vezu.webmanifest" in (info["href"] or "") or ".webmanifest" in (info["href"] or "").split("/")[-1] and "manifest.webmanifest" not in (info["href"] or ""):
                errors.append(url + " swapped to per-card manifest " + info["href"])
            if not info["sw"]:
                errors.append(url + " no service worker registration")
            else:
                sc = info["sw"][0]["scope"]
                if not start.startswith(sc):
                    errors.append("SW scope %s does not cover start_url %s" % (sc, start))

            cdp = ctx.new_cdp_session(page)
            inst = cdp.send("Page.getInstallabilityErrors")
            print("INSTALLABILITY", url, json.dumps(inst, ensure_ascii=False))
            bad = [e.get("errorId") for e in inst.get("installabilityErrors") or [] if e.get("errorId") != "in-incognito"]
            if bad:
                errors.append(url + " installability: " + ", ".join(bad))
            cdp.detach()

        ctx.close()

    if errors:
        print("PWA_FAIL")
        for e in errors:
            print(" -", e)
        raise SystemExit(1)
    print("PWA_OK", BASE)
    return 0


if __name__ == "__main__":
    main()
