#!/usr/bin/env python3
"""390px E2E: simplified card wizard → pending → admin approve → driver sees Одобрена.
Test data only. Never prints the admin key. Never touches slug=vezu."""
import os
from datetime import datetime
from zoneinfo import ZoneInfo
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = os.environ.get("VEZU_BASE", "https://avtomaster24bot-lab.github.io/vezu/")
OUT = os.environ.get("VEZU_SHOTS", "/workspace/vezu/tests/screenshots")
IMG = os.environ.get("VEZU_TEST_IMG", "/workspace/vezu/tests/test-car.jpg")
ADMIN_KEY_FILE = os.environ.get("VEZU_ADMIN_KEY_FILE", "/workspace/secrets/vezu-admin-key.txt")
TZ = ZoneInfo("Asia/Almaty")
os.makedirs(OUT, exist_ok=True)
stamp = datetime.now(TZ).strftime("%Y%m%d-%H%M")
PHONE = "77000910233"
NAME = "Тест ВЕЗУ"
CITY = "Тестополь-ВЕЗУ"


def admin_key():
    v = Path(ADMIN_KEY_FILE).read_text(encoding="utf-8")
    return "".join(ch for ch in v if ch.isalnum() or ch in "-_")


def shot(page, name, full=True):
    path = os.path.join(OUT, f"{stamp}-{name}.png")
    page.screenshot(path=path, full_page=full)
    print("SHOT", path)
    return path


def launch(p, storage=None, extras=None):
    br = p.chromium.launch(
        executable_path="/usr/bin/google-chrome",
        headless=True,
        args=["--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars"],
    )
    context = br.new_context(
        viewport={"width": 390, "height": 844},
        device_scale_factor=2,
        is_mobile=True,
        has_touch=True,
        locale="ru-RU",
        service_workers="block",
    )
    script = """
        window.open = function(){ return null; };
        try{
          sessionStorage.setItem('vezu_city_prompted','1');
          localStorage.setItem('vezu_city', %r);
          localStorage.setItem('vezu-city', %r);
          localStorage.setItem('vezu-onb','1');
        }catch(e){}
    """ % (CITY, CITY)
    if extras:
        script += extras
    context.add_init_script(script)
    if storage:
        # applied after but init already ran... set via init
        pass
    page = context.new_page()
    page.set_default_timeout(30000)
    return br, context, page


def goto(page, path):
    page.goto(BASE.rstrip("/") + "/" + path.lstrip("/"), wait_until="domcontentloaded")
    page.wait_for_timeout(600)


def main():
    shots = []
    driver_js_key = None
    with sync_playwright() as p:
        br, context, page = launch(p)
        goto(page, "new.html")
        page.wait_for_selector("#photo-gal", timeout=20000)
        page.wait_for_timeout(400)
        shots.append(shot(page, "wizard-photo"))

        page.locator("#photo-gal").set_input_files(IMG)
        page.wait_for_selector("#phav img", timeout=10000)
        page.wait_for_timeout(300)
        page.locator('section[data-step="1"] [data-next="2"]').click()
        page.wait_for_selector('input[name=n]', timeout=8000)
        page.fill('input[name=n]', NAME)
        page.locator('section[data-step="2"] [data-next="3"]').click()
        page.wait_for_selector('input[name=p]', timeout=8000)
        page.fill('input[name=p]', "+7 700 091 02 33")
        page.locator('section[data-step="3"] [data-next="4"]').click()
        page.wait_for_selector("#veh", timeout=8000)
        page.locator('#veh [data-k="gazel"]').click()
        page.wait_for_timeout(200)
        if page.locator('input[name=plate]').count():
            page.fill('input[name=plate]', "123ABC02")
        page.locator('section[data-step="4"] [data-next="5"]').click()
        page.wait_for_selector("#svc", timeout=8000)
        page.locator('#svc .qchip').first.click()
        page.locator('section[data-step="5"] [data-next="6"]').click()
        page.wait_for_timeout(400)
        city = page.locator("[data-city-label]").first.inner_text().strip()
        if CITY not in city:
            raise SystemExit("city not prefilled: " + city)
        page.locator('section[data-step="6"] [data-next="7"]').click()
        page.wait_for_selector("#sendcard", timeout=8000)
        # consent
        page.locator('#consbox [data-consent="driver"]').check()
        page.wait_for_timeout(200)
        page.locator("#sendcard").click()
        page.wait_for_selector(".st-badge.pending, .sent-st.st-pending", timeout=25000)
        page.wait_for_timeout(500)
        body = page.inner_text("#sentbox")
        if "На проверке" not in body and "на проверку" not in body.lower():
            raise SystemExit("expected pending status, got: " + body[:400])
        shots.append(shot(page, "status-pending"))
        driver_js_key = page.evaluate("() => { try { return localStorage.getItem('vezu-key') || ''; } catch(e){ return ''; } }")
        keyfile = Path("/tmp/vezu-e2e-driver-key")
        if driver_js_key:
            keyfile.write_text(driver_js_key, encoding="utf-8")
            keyfile.chmod(0o600)
            print("driver key saved to /tmp/vezu-e2e-driver-key, len", len(driver_js_key))
        else:
            print("WARN no driver key in localStorage")
        context.close(); br.close()

        # --- admin panel ---
        key = admin_key()
        if not (32 <= len(key) <= 64):
            raise SystemExit("admin key file looks wrong (len hidden)")
        br, context, page = launch(p)
        goto(page, "admin.html")
        page.wait_for_selector("#ak", timeout=20000)
        page.fill("#ak", key)
        page.locator("#go").click()
        page.wait_for_selector("#vfy", timeout=20000)
        page.wait_for_timeout(1500)
        vfy = page.locator("#vfy").inner_text()
        if NAME not in vfy and "На проверку" not in vfy:
            # maybe still loading
            page.wait_for_timeout(2000)
            vfy = page.locator("#vfy").inner_text()
        if NAME not in vfy:
            raise SystemExit("test card not in admin pending list")
        shots.append(shot(page, "admin-pending"))
        # approve the test row only
        row = page.locator("#vfy article.vf-adm", has_text=NAME)
        if row.count() != 1:
            raise SystemExit("expected exactly one test row, got %s" % row.count())
        row.scroll_into_view_if_needed()
        page.wait_for_timeout(200)
        row.locator("button[data-vok]").click()
        page.wait_for_function(
            "name => { const el=document.getElementById('vfy'); return !!(el && el.innerText.indexOf(name) < 0); }",
            arg=NAME,
            timeout=20000,
        )
        context.close(); br.close()

        # --- driver sees Одобрена ---
        # localStorage vezu-key may be JSON-stringified by C.ls
        extras = """
        try{
          var k = %r;
          if (k) {
            if (k.charAt(0) !== '"') k = JSON.stringify(k);
            localStorage.setItem('vezu-key', k);
          }
        }catch(e){}
        """ % (page.evaluate("1") if False else "")
        # pass raw stored value via evaluate result saved earlier
        stored = driver_js_key
        extras = (
            "try{ if(%r){ localStorage.setItem('vezu-key', %r); } }catch(e){}\n"
        ) % (stored, stored)
        br, context, page = launch(p, extras=extras)
        goto(page, "app.html#mycard")
        page.evaluate("document.body.classList.add('is-driver')")
        page.wait_for_selector("#mycardb", timeout=20000)
        page.wait_for_selector("#mycardb .st-badge, #mycardb .empty, #mycardb .err-msg", timeout=20000)
        page.wait_for_timeout(400)
        text = page.locator("#mycardb").inner_text()
        if "Одобрена" not in text:
            # try new.html status
            goto(page, "new.html")
            page.wait_for_timeout(2000)
            text = page.inner_text("body")
            if "Одобрена" not in text:
                raise SystemExit("driver did not see Одобрена: " + text[:500])
            shots.append(shot(page, "driver-approved-new"))
        else:
            shots.append(shot(page, "driver-approved-mycard"))
        # bottom nav with Моя визитка
        # ensure class and screenshot app mycard
        if "mycard" not in page.url or "Одобрена" not in page.inner_text("body"):
            goto(page, "app.html#mycard")
            page.evaluate("document.body.classList.add('is-driver')")
            page.wait_for_selector("#mycardb .st-badge, #mycardb .empty", timeout=20000)
            page.wait_for_timeout(400)
        nav = page.locator(".bnav").inner_text()
        if "Моя визитка" not in nav:
            raise SystemExit("driver nav missing Моя визитка: " + nav)
        shots.append(shot(page, "driver-bnav-mycard", full=False))
        context.close(); br.close()

    print("E2E_OK", stamp, "phone", PHONE, "shots", len(shots))
    return shots


if __name__ == "__main__":
    main()
