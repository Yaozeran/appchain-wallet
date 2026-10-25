"""Integration test against the running Docker app and real PostgreSQL.

Creates isolated test accounts and retains their ledger records for inspection.
No external payment provider, on-chain transaction, or real payment is used.
Usage: python3 tests/custody-smoke.py [http://localhost:3000]
"""
import concurrent.futures
import http.cookiejar
import json
import sys
import urllib.error
import urllib.request
import uuid

BASE = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else "http://localhost:3000"
PASSWORD = "IntegrationTest!2026"


class Client:
    def __init__(self):
        self.cookies = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cookies))

    def call(self, path, body=None, origin=BASE, expected=200):
        headers = {"Origin": origin}
        data = None if body is None else json.dumps(body).encode()
        if data is not None:
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(BASE + "/api/custody/" + path, data=data, headers=headers)
        try:
            response = self.opener.open(request, timeout=30)
        except urllib.error.HTTPError as error:
            response = error
        result = json.loads(response.read())
        assert response.code == expected, (path, response.code, result)
        assert "no-store" in response.headers.get("Cache-Control", "")
        return result

    def register(self):
        self.email = "integration-" + uuid.uuid4().hex + "@wallet.test"
        return self.call("register", {"email": self.email, "password": PASSWORD})

    def buy(self, state, amount, key=None, expected=200):
        return self.call("buy", {"requestKey": key or str(uuid.uuid4()), "cardId": state["card"]["id"], "fiatAmount": amount}, expected=expected)


def check():
    a, b, anonymous = Client(), Client(), Client()
    anonymous.call("me", expected=401)
    anonymous.call("demo", {}, origin="https://untrusted.example", expected=403)
    sa, sb = a.register(), b.register()
    assert sa["card"]["fiatCents"] == "100000" and sa["cryptoWei"] == "0"
    assert sa["mode"] == "simulation" and sa["address"] != sb["address"]
    cookie = next(iter(a.cookies))
    assert cookie.has_nonstandard_attr("HttpOnly") and cookie.get_nonstandard_attr("SameSite") == "Strict"
    a.call("register", {"email": a.email, "password": PASSWORD}, expected=409)
    anonymous.call("login", {"email": a.email, "password": "wrong-password"}, expected=401)
    # An account can never debit another user's card, or submit real card fields.
    a.buy(sb, "10", expected=400)
    a.call("buy", {"requestKey": str(uuid.uuid4()), "cardId": sa["card"]["id"], "fiatAmount": "10", "cardNumber": "fake-only"}, expected=400)
    key = str(uuid.uuid4())
    first = a.buy(sa, "100.00", key)
    replay = a.buy(sa, "100", key)
    assert replay["replayed"] and first["id"] == replay["id"]
    a.buy(sa, "101", key, expected=409)
    sa = a.call("me")
    assert sa["card"]["fiatCents"] == "90000" and sa["cryptoWei"] == "40000000000000000"
    for amount in ["-1", "0", "1.001", "1e2", "1001"]:
        a.buy(sa, amount, expected=400)
    a.buy(sa, "901", expected=400)
    send_key = str(uuid.uuid4())
    payment = {"requestKey": send_key, "recipientAddress": sb["address"], "ethAmount": "0.01"}
    receipt = a.call("send", payment)
    assert receipt["status"] == "INTERNAL_COMPLETED"
    assert a.call("send", payment)["id"] == receipt["id"]
    assert b.call("me")["cryptoWei"] == "10000000000000000"
    assert b.call("me")["activity"][0]["kind"] == "RECEIVE"
    external = a.call("send", {"requestKey": str(uuid.uuid4()), "recipientAddress": "0x1111111111111111111111111111111111111111", "ethAmount": "0.005"})
    assert external["status"] == "EXTERNAL_SIMULATED" and "hash" not in external
    before = a.call("me")
    a.call("send", {"requestKey": str(uuid.uuid4()), "recipientAddress": sb["address"], "ethAmount": "1"}, expected=400)
    assert a.call("me")["cryptoWei"] == before["cryptoWei"]
    a.call("send", {"requestKey": str(uuid.uuid4()), "recipientAddress": sa["address"], "ethAmount": "0.001"}, expected=400)
    # Use independent clients with the same session, as concurrent browser requests would.
    cookie_header = "; ".join(c.name + "=" + c.value for c in a.cookies)

    def parallel_buy(key, amount):
        req = urllib.request.Request(BASE + "/api/custody/buy", data=json.dumps({
            "requestKey": key, "cardId": sa["card"]["id"], "fiatAmount": amount}).encode(), headers={
            "Origin": BASE, "Content-Type": "application/json", "Cookie": cookie_header})
        try:
            r = urllib.request.urlopen(req, timeout=30)
        except urllib.error.HTTPError as error:
            r = error
        return r.code, json.loads(r.read())

    same_key = str(uuid.uuid4())
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda _: parallel_buy(same_key, "10"), range(4)))
    assert all(status == 200 for status, _ in results)
    assert len({body["id"] for _, body in results}) == 1
    assert a.call("me")["card"]["fiatCents"] == "89000"
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: parallel_buy(str(uuid.uuid4()), "600"), range(2)))
    assert sorted(status for status, _ in results) == [200, 400]
    assert a.call("me")["card"]["fiatCents"] == "29000"
    # Relogin must not issue a second $1,000 or reset the address/balance.
    a.call("logout", {})
    a.call("me", expected=401)
    state = a.call("login", {"email": a.email, "password": PASSWORD})
    assert state["card"]["fiatCents"] == "29000" and state["address"] == sa["address"]
    print("PASS: registration, login/logout, session cookie, origin checks, card ownership, strict inputs,")
    print("exact conversion, replay/conflict, concurrent duplicate/overspend protection, internal credit,")
    print("external simulation, rollback, and persisted account balances.")


if __name__ == "__main__":
    check()
