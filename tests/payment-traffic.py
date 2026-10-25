"""Real PostgreSQL ledger integration; no OP Stack throughput claims or L1 writes."""
import concurrent.futures
import importlib.util
import json
import uuid
import urllib.request
import urllib.error

spec = importlib.util.spec_from_file_location('custody_smoke', 'tests/custody-smoke.py')
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)
a, merchant = smoke.Client(), smoke.Client()
state, target = a.register(), merchant.register()
a.buy(state, '100')
request = {'requestKey': str(uuid.uuid4()), 'recipientAddress': target['address'], 'ethAmount': '0.0001', 'count': 20}
result = a.call('traffic', request)
assert result['payments'] == 20 and result['scope'] == 'APPLICATION_LEDGER_AND_ZLIB'
assert result['processingMs'] > 0 and result['processingTps'] > 0
assert result['compressedBytes'] < result['rawBytes']
assert result['l1Status'] == 'NOT_SUBMITTED'
assert a.call('me')['cryptoWei'] == '38000000000000000'
assert merchant.call('me')['cryptoWei'] == '2000000000000000'
assert a.call('traffic', request)['replayed']
assert a.call('traffic', request)['id'] == result['id']
a.call('traffic', {**request, 'count': 21}, expected=409)
# Same request concurrent retry applies once and returns a single persistent batch.
next_request = {**request, 'requestKey': str(uuid.uuid4())}
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    receipts = list(pool.map(lambda _: a.call('traffic', next_request), range(2)))
assert receipts[0]['id'] == receipts[1]['id']
assert a.call('me')['cryptoWei'] == '36000000000000000'
# Fails partway through run: all payments and the application batch roll back.
before = a.call('me')['cryptoWei']
a.call('traffic', {**request, 'requestKey': str(uuid.uuid4()), 'ethAmount': '0.01', 'count': 20}, expected=400)
assert a.call('me')['cryptoWei'] == before
assert len(a.call('traffic')) == 2
for count in [0, 201]:
    a.call('traffic', {**request, 'requestKey': str(uuid.uuid4()), 'count': count}, expected=400)
assert not smoke.Client().call('capabilities')['normalEnabled']
smoke.Client().call('traffic', expected=401)
assert merchant.call('traffic') == []
# Backend enforces unavailable normal mode even if the browser is bypassed.
req = urllib.request.Request(smoke.BASE + '/api/custody/send', data=json.dumps({
    'requestKey': str(uuid.uuid4()), 'recipientAddress': target['address'], 'ethAmount': '0.001'
}).encode(), headers={'Origin': smoke.BASE, 'Content-Type': 'application/json', 'X-Wallet-Mode': 'normal'})
try:
    a.opener.open(req)
    raise AssertionError('normal mode accepted')
except urllib.error.HTTPError as error:
    assert error.code == 409
metrics = a.call('appchain-metrics')
assert metrics['batcherTps'] is None
print(json.dumps({'result':'PASS','scope':result['scope'],'payments':20,'applicationProcessingTps':round(result['processingTps'],2),
                  'rawBytes':result['rawBytes'],'compressedBytes':result['compressedBytes'],
                  'actualOpSequencerAvailable':metrics['sequencerAvailable'],'actualOpBatcherTps':metrics['batcherTps']}))
